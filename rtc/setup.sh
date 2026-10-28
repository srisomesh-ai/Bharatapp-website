#!/usr/bin/env bash
# BharatApp Chat call relay (TURN) - run once on the VPS from the hPanel browser terminal:
#   curl -fsSL https://bharatapp.chat/rtc/setup.sh | SECRET=<secret from admin -> Call relay> bash
# (the exact line, with the secret, is shown in the BharatApp admin panel -> Call relay)
# Safe to run again. It installs only its own service (bharatapp-turn) and never touches nginx,
# ScanPlay or anything else on this server. CPU and memory are capped so other services stay fast.
set -euo pipefail
SITE=https://bharatapp.chat
CONF=/etc/bharatapp-turn.conf
[ "$(id -u)" = 0 ] || { echo "Please run as root (the hPanel terminal logs in as root)."; exit 1; }
case "${SECRET:-}" in ''|*[!a-f0-9]*) echo "!! SECRET missing or wrong - copy the whole line from the admin panel -> Call relay"; exit 1;; esac
[ ${#SECRET} -ge 32 ] || { echo "!! SECRET too short - copy the whole line"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

echo "== 1/5 Installing coturn (a minute the first time)"
apt-get update -qq
apt-get install -y -qq coturn curl openssl >/dev/null
# the package's own service stays off; ours runs with its own settings file
systemctl disable --now coturn >/dev/null 2>&1 || true

echo "== 2/5 Finding this server's public address"
PUB=$(curl -fsS4 --max-time 8 https://api.ipify.org || true)
[ -n "$PUB" ] || PUB=$(hostname -I | tr ' ' '\n' | grep -vE '^(10\.|127\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|$)' | head -1)
[ -n "$PUB" ] || { echo "!! Could not find the public address - send a screenshot to Claude"; exit 1; }
LOCAL=$(hostname -I | awk '{print $1}')
echo "   $PUB"

echo "== 3/5 Relay settings"
install -m 640 -o root -g turnserver /dev/null "$CONF"
cat > "$CONF" <<CFG
# BharatApp Chat call relay - written by rtc/setup.sh
listening-port=3478
min-port=49160
max-port=49400
$( [ "$PUB" != "$LOCAL" ] && echo "external-ip=$PUB/$LOCAL" || echo "external-ip=$PUB" )
realm=bharatapp.chat
use-auth-secret
static-auth-secret=$SECRET
fingerprint
no-tls
no-dtls
no-cli
no-multicast-peers
no-rfc5780
no-stun-backward-compatibility
response-origin-only-with-rfc5780
# never relay into private networks or this machine's own loopback (keeps ScanPlay and other local services unreachable)
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=100.64.0.0-100.127.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.0.0.0-192.0.0.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=198.18.0.0-198.19.255.255
denied-peer-ip=224.0.0.0-255.255.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff
$( [ -n "$LOCAL" ] && [ "$LOCAL" != "$PUB" ] && echo "denied-peer-ip=$LOCAL" )
# limits: voice needs ~50 kbit/s, so 512 kbit/s per session leaves room for video later
user-quota=20
total-quota=400
max-bps=512000
stale-nonce=600
simple-log
log-file=stdout
pidfile=/run/bharatapp-turn/turnserver.pid
CFG

cat > /etc/systemd/system/bharatapp-turn.service <<'UNIT'
[Unit]
Description=BharatApp Chat call relay (TURN)
After=network-online.target
Wants=network-online.target

[Service]
User=turnserver
Group=turnserver
ExecStart=/usr/bin/turnserver -c /etc/bharatapp-turn.conf
Restart=always
RestartSec=3
# keep other services on this server (ScanPlay recognition) fast
CPUQuota=60%
MemoryMax=512M
LimitNOFILE=65536
RuntimeDirectory=bharatapp-turn
StateDirectory=bharatapp-turn
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable bharatapp-turn >/dev/null 2>&1
systemctl restart bharatapp-turn

echo "== 4/5 Firewall"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 3478/udp >/dev/null; ufw allow 3478/tcp >/dev/null; ufw allow 49160:49400/udp >/dev/null
  echo "   opened 3478 (udp+tcp) and 49160-49400 (udp) in ufw"
else
  echo "   ufw is off (nothing to open here)"
fi
echo "   If hPanel -> VPS -> Firewall has rules, add: UDP 3478, TCP 3478, UDP 49160-49400"

echo "== 5/5 Telling bharatapp.chat where the relay is"
TS=$(date +%s)
SIG=$(printf '%s|%s' "$PUB" "$TS" | openssl dgst -sha256 -hmac "$SECRET" -r | cut -d' ' -f1)
ANS=$(curl -fsS --max-time 15 -H 'Content-Type: application/json' \
  -d "{\"action\":\"rtc_hello\",\"host\":\"$PUB\",\"ts\":$TS,\"sig\":\"$SIG\"}" "$SITE/api/index.php" || true)
echo "   $ANS"

sleep 3
echo
echo "== Result"
systemctl is-active bharatapp-turn && (ss -lun | grep -q ':3478 ' && echo "listening on 3478") || echo "!! relay not running - send a screenshot to Claude"
case "$ANS" in *'"ok":true'*) echo "bharatapp.chat knows the relay: $PUB";; *) echo "!! bharatapp.chat did not accept it - send a screenshot to Claude";; esac
echo "Done. Send a screenshot of this screen to Claude."
