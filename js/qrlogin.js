/* ---- Log in on the web by scanning a QR with the phone app (like WhatsApp Web).
   This browser makes a one-time ECDH key pair; the QR carries its public key.
   The app seals the account's keys to it (ECDH -> AES-GCM, the same scheme as
   chats) and approves; we collect the new device login and open the keys.
   Nothing secret ever passes the server in readable form. ---- */
const PLAY_URL_QR='https://play.google.com/store/apps/details?id=chat.bharatappchat.app';
let _qr=null;   // {pid, secret, priv (CryptoKey), timer, until}

function _b64uQ(buf){ return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function _unb64Q(s){ s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; return Uint8Array.from(atob(s),c=>c.charCodeAt(0)); }

async function qrStart(){
  qrStop();
  const box=$('qr-login'), msg=$('qr-msg');
  msg.textContent=''; box.classList.remove('qr-dim');
  $('qr-code').innerHTML='<div class="qr-wait">Loading…</div>';
  try{
    const kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
    const pub=await crypto.subtle.exportKey('jwk',kp.publicKey);
    const secret=_b64uQ(crypto.getRandomValues(new Uint8Array(24)));
    const r=await api('qr_start',{web_pub:{x:pub.x,y:pub.y},secret});
    _qr={pid:r.pid,secret,priv:kp.privateKey,until:Date.now()+(r.ttl||180)*1000};
    const text='https://bharatapp.chat/link.html#'+r.pid+'.'+pub.x+'.'+pub.y;
    _qr.text=text;
    const q=qrcode(0,'L'); q.addData(text); q.make();
    $('qr-code').innerHTML=q.createSvgTag({cellSize:5,margin:2,scalable:true});
    _qr.timer=setInterval(qrPoll,2000);
  }catch(e){
    $('qr-code').innerHTML='';
    msg.textContent=e.message==='too_many'?'Too many tries — wait a few minutes':'Could not load the QR — check your internet';
    qrShowReload();
  }
}
function qrStop(){ if(_qr&&_qr.timer)clearInterval(_qr.timer); _qr=null; }
function qrShowReload(){
  $('qr-login').classList.add('qr-dim');
  $('qr-code').insertAdjacentHTML('beforeend','<button class="qr-reload" onclick="qrStart()">↻ Get a new QR code</button>');
}
let _qrPolling=false;
async function qrPoll(){
  if(!_qr||_qrPolling)return;
  if(Date.now()>_qr.until){ qrStop(); qrShowReload(); return; }
  _qrPolling=true;
  const q=_qr;
  try{
    const r=await api('qr_poll',{pid:q.pid,secret:q.secret});
    if(r.status!=='approved')return;
    qrStop();
    $('qr-msg').textContent='Logging in…';
    // open the sealed keys with this browser's one-time key
    const appPub=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:r.sealed.pub.x,y:r.sealed.pub.y,ext:true},{name:'ECDH',namedCurve:'P-256'},false,[]);
    const bits=await crypto.subtle.deriveBits({name:'ECDH',public:appPub},q.priv,256);
    const key=await crypto.subtle.importKey('raw',bits,'AES-GCM',false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:_unb64Q(r.sealed.iv)},key,_unb64Q(r.sealed.blob));
    const acc=JSON.parse(new TextDecoder().decode(plain));
    const s=r.session;
    if(!acc.priv||!acc.pub||acc.kal_id!==s.kal_id) throw new Error('mismatch');
    const ident=seedIdentity(s.name||acc.name||s.username,{kalId:s.kal_id,username:s.username,token:s.token,pub:acc.pub,priv:acc.priv});
    ident.device=true; save();
    $('qr-msg').textContent='';
    showApp();
    loadContactsAfterLogin().then(()=>{ if(typeof renderAll==='function')renderAll(); });
  }catch(e){
    if(e.message==='expired'){ qrStop(); qrShowReload(); }
    else if(e.message==='mismatch'||e.name==='OperationError'){ qrStop(); $('qr-msg').textContent='That didn\'t work — try again'; qrShowReload(); }
    // network blips: keep trying
  }finally{ _qrPolling=false; }
}
