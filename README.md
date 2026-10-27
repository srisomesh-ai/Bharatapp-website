# BharatApp Chat — Private messenger. No phone number.

**Always together, always private.** BharatApp Chat — a WhatsApp-class messenger where identity is a @username, never a phone number. End-to-end encrypted; chats live only on your phone. Domain: bharatapp.chat

## Project structure
```
index.html            Shell: links CSS + JS modules, holds all screen markup
css/
  app.css             Core app styles (onboarding, chat, sheets, privacy)
  landing-voice.css   Landing page + voice message styles
js/
  qrcode.js           QR generation library (vendored)
  net.js              Server API + E2E crypto (ECDH/AES-GCM) + polling + backup/restore + group receive
  voice.js            Voice message record & playback
  landing.js          Landing page routing + login (restore) entry
  settings.js         User settings page
  block.js            Block / unblock users
  status.js           Status / stories (text, photo, voice, 24h)
  groups.js           Group chats (server-relayed)
  app.js              Main app logic (chats, contacts, personas, burn, etc.)
panel-x7k9/           Admin panel at obfuscated URL (see below)
  index.html          Admin panel (own login)
  api.php             Admin API: stats, list/enable/disable/delete users, groups
admin/                Decoy 404 (real panel is at /panel-x7k9/)
api/
  index.php           Relay-and-delete backend (register/lookup/send/fetch/check/ping)
  config.php          Loads DB_PASS from config.local.php (git-ignored)
  config.local.example.php   Template for the server-only password file
```

## Features
No-phone @username identity · true E2E encryption · relay-and-delete with real deletion receipts · burn-on-read (text, photo, voice) · **voice messages** · personas · QR / add-by-username · disappearing messages · encrypted backup & restore (= login on new device) · 90-day username reclaim · impersonation protection · attractive landing page.

## Sign-up verification & forward tracing (India IT Rules)
- **Gmail + OTP at sign-up.** `email_otp_send` emails a 6-digit code (10 min, 5 tries, rate limited); `register` needs `email` + `email_code`. The Gmail is stored server-side only — `lookup`, `contacts_profiles`, status and request lists never return it. A persona made while signed in passes `parent_kal_id`/`parent_token` and inherits the email. Set `REQUIRE_EMAIL` false in `config.local.php` while older apps are still out there; set `MAIL_FROM` to a real mailbox on the domain.
- **Forwarded messages only.** When a message is forwarded the app sends `fwd_hash` (SHA-256 of `kalisi-fwd-v1\n<kind>\n<content>`, text whitespace-normalised) and `fwd_from` (who it came from). Content stays end-to-end encrypted; ordinary messages are never fingerprinted. Rows expire after `FWD_RETENTION_DAYS` (180).
- **Admin → Trace forward** takes the text or fingerprint and shows the earliest known originator (username, KAL-ID, email).

## Icons
`favicon.ico`, `icons/` and `site.webmanifest` are made from the app logo (`kalisi-native/ci/icon.png`).

## Run
Open `index.html` via the web server (needs the css/ and js/ folders alongside). Deploy via Hostinger hPanel → Git.
Server password: create `api/config.local.php` on the server with `<?php define('DB_PASS','...');`

## Roadmap
1. ✅ Web prototype — modular, landing, voice
2. Flutter Android app (real E2E, phone storage, push)
3. Calls, groups, screenshot detection


## Admin panel URL
The admin panel lives at an obfuscated path for security: **/panel-x7k9/**
(the plain /admin/ is a decoy 404). Change the folder name anytime by renaming it;
robots.txt hides it from crawlers. Default login someswara / Kalisi@Admin2026 — change it.
