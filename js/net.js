/* Unified file save: native app → Downloads via channel; browser → <a download> */
function saveFile(name, textData){
  if(typeof isNativeApp==='function' && isNativeApp() && window.KalisiDownload){
    try{ window.KalisiDownload.postMessage(JSON.stringify({name:name, data:textData})); return true; }catch(e){}
  }
  // browser fallback
  const blob=new Blob([textData],{type:'application/octet-stream'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  return true;
}

/* Kalisi network + E2E crypto */
/* ============ Kalisi network + E2E crypto layer ============ */
// When the app is bundled (loaded from file:// or the app asset host), use the
// absolute server URL. On the website it stays relative.
const API_SERVER='https://bharatapp.chat';
const API=(location.protocol==='file:'||location.protocol==='https:'&&location.hostname==='appassets.androidplatform.net'||window.KalisiBundled)
  ? API_SERVER+'/api/index.php'
  : 'api/index.php';
const POLL_MS=2500;
let pollTimer=null;

async function api(action,body){
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...body})});
  let j; try{ j=await r.json(); }catch(e){ throw new Error('bad_response'); }
  if(!j.ok){ const err=new Error(j.error||'api_error'); Object.assign(err,j); throw err; }
  return j;
}
function authBody(){const m=me();return{kal_id:m.kalId,token:m.token};}

/* ---- keys: ECDH P-256, generated per persona, stored only in this browser ---- */
async function genKeys(){
  const kp=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);
  const pub=await crypto.subtle.exportKey('jwk',kp.publicKey);
  const priv=await crypto.subtle.exportKey('jwk',kp.privateKey);
  return{pub,priv};
}
async function sharedKey(myPrivJwk,theirPubJwk){
  const priv=await crypto.subtle.importKey('jwk',myPrivJwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);
  const pub=await crypto.subtle.importKey('jwk',theirPubJwk,{name:'ECDH',namedCurve:'P-256'},false,[]);
  return crypto.subtle.deriveKey({name:'ECDH',public:pub},priv,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const _keyCache={};
async function keyFor(c){
  const ck=S.active+':'+c.kalId;
  if(!_keyCache[ck])_keyCache[ck]=await sharedKey(me().priv,c.pubkey);
  return _keyCache[ck];
}
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
async function encryptFor(c,obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},await keyFor(c),new TextEncoder().encode(JSON.stringify(obj)));
  return{iv:b64(iv),blob:b64(ct)};
}
async function decryptFrom(c,iv,blob){
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv)},await keyFor(c),unb64(blob));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---- real contacts ---- */
async function connectReal(handle){
  const {user}=await api('lookup',{handle});
  let c=D().contacts.find(x=>x.kalId===user.kal_id);
  // impersonation guard: same username, different underlying identity
  const old=user.username?D().contacts.find(x=>x.username===user.username&&x.kalId!==user.kal_id):null;
  if(old&&!c){
    old.name=old.name+' (old)'; old.username=''; old.idChanged=true;
    kAlert({title:'⚠️ Identity changed',message:'@'+user.username+' is now a different person. The previous owner let the name expire and someone new registered it — their key does not match. Do not share anything private until you verify who this is.',okText:'Understood',danger:true});
  }
  if(!c){
    c={id:uid(),name:user.name,username:user.username||'',kalId:user.kal_id,color:COLORS[Math.floor(Math.random()*COLORS.length)],real:true,pubkey:user.pubkey};
    D().contacts.push(c); chat(c.id); save(); renderChats();
  }
  return c;
}

/* ---- outgoing ---- */
async function netSend(c,m){
  const body={kind:m.kind,text:m.text,img:m.img||null,audio:m.audio||null,wave:m.wave||null,dur:m.dur||0,burn:!!m.burn,replyTo:m.replyTo||null,cid:m.id,ts:m.ts,timer:chat(c.id).timer||0};
  const enc=await encryptFor(c,body);
  await api('send',{...authBody(),to:c.kalId,client_id:m.id,...enc,echo:1});
}
async function netSendCtl(c,obj){ // control messages: read receipts, burn acks — also encrypted
  const enc=await encryptFor(c,obj);
  await api('send',{...authBody(),to:c.kalId,client_id:'ctl'+uid(),...enc}).catch(()=>{});
}

/* ---- polling ---- */
function startPoll(){ stopPoll(); pollTimer=setInterval(pollOnce,POLL_MS); pollOnce(); }
function stopPoll(){ if(pollTimer)clearInterval(pollTimer); pollTimer=null; }

/* ---- encrypted backup & restore ---- */
async function pbkey(pass,salt){
  const km=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:200000,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function backupData(){
  window._lastBackupOk=false;
  const pass=await kPrompt({title:'Set a backup passphrase',message:'You will need this to restore your account. Keep it safe.',placeholder:'Choose a passphrase',password:true,okText:'Save backup'});
  if(!pass)return;
  if(pass.length<4){toast('Passphrase too short — try again');return;}
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const key=await pbkey(pass,salt);
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(S)));
  const pack={kalisi_backup:1,ts:now(),salt:b64(salt),iv:b64(iv),data:b64(ct)};
  saveFile('kalisi-backup-'+new Date().toISOString().slice(0,10)+'.kbk', JSON.stringify(pack));
  window._lastBackupOk=true;
  if(S){ S.lastBackup=now(); const m=me(); if(m)m.backedUp=true; save(); }
  toast('Backup saved 🔐 Keep the file + passphrase safe');
  const nag=$('backup-nag'); if(nag)nag.classList.add('hide');
}
function restorePick(){ document.getElementById('restore-in').click(); }
async function restoreFile(input){
  const f=input.files[0]; input.value='';
  if(!f)return;
  let pack;
  try{ pack=JSON.parse(await f.text()); }catch(e){ toast('Not a Kalisi backup file'); return; }
  if(!pack||pack.kalisi_backup!==1||!pack.data){ toast('Not a Kalisi backup file'); return; }
  const pass=await kPrompt({title:'Enter backup passphrase',message:'The passphrase you set when creating this backup.',placeholder:'Passphrase',password:true,okText:'Restore'});
  if(!pass)return;
  try{
    const key=await pbkey(pass,new Uint8Array(unb64(pack.salt)));
    const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(unb64(pack.iv))},key,unb64(pack.data));
    const st=JSON.parse(new TextDecoder().decode(pt));
    if(!st||!st.identities||!st.data)throw 0;
    localStorage.setItem(LS_KEY,JSON.stringify(st));
    toast('Restored ✅ Welcome back'); setTimeout(()=>location.reload(),900);
  }catch(e){ toast('Wrong passphrase or corrupted file'); }
}

async function pollOnce(){
  if(!me()?.token)return;
  let res; try{ res=await api('fetch',authBody()); }catch(e){ return; }
  let changed=false;
  for(const r of res.receipts){ // relay deleted its copy of my sent message
    for(const cid in D().chats){ const m=D().chats[cid].msgs.find(x=>x.id===r.client_id);
      if(m){ if(m.status==='sent')m.status='delivered'; m.receipt=r.receipt.slice(0,16); changed=true; } }
  }
  for(const pkt of res.messages){
    // something I sent from my phone / another browser — show it here too
    if(pkt.to){ if(await handleMyEcho(pkt))changed=true; continue; }
    // group message? (relayed blob, base64 JSON with gid)
    if(pkt.iv==='grp'){
      try{
        const gb=JSON.parse(decodeURIComponent(escape(atob(pkt.blob))));
        handleGroupIncoming(gb);
      }catch(e){}
      changed=true; continue;
    }
    let c=D().contacts.find(x=>x.kalId===pkt.from);
    if(!c){ try{ c=await connectReal(pkt.from); }catch(e){ continue; } }
    if(isBlocked&&isBlocked(pkt.from)){ continue; }
    if(c._pkCheck===undefined){
      try{ const {user}=await api('lookup',{handle:c.kalId});
        c._pkCheck=JSON.stringify(user.pubkey)===JSON.stringify(c.pubkey);
        if(!c._pkCheck){ c.idChanged=true; save();
          kAlert({title:'⚠️ Key changed',message:'The encryption key for '+(c.username?'@'+c.username:c.name)+' has changed. This should never happen normally. Verify their identity in person before sharing anything sensitive.',okText:'Understood',danger:true}); }
      }catch(e){}
    }
    let body; try{ body=await decryptFrom(c,pkt.iv,pkt.blob); }catch(e){ continue; }
    changed=true;
    if(body.kind==='read'){ // peer read my messages
      const ch=chat(c.id);
      for(const id of body.ids||[]){ const m=ch.msgs.find(x=>x.id===id); if(m)m.status='read'; }
      continue;
    }
    if(body.kind==='burned'){ // peer viewed my burn message
      const ch=chat(c.id); const m=ch.msgs.find(x=>x.id===body.id);
      if(m){ m.status='read'; m.burned=true; m.text=''; m.img=null; }
      continue;
    }
    if(body.kind==='delete'){ // peer deleted a message for everyone
      const ch=chat(c.id); const i=ch.msgs.findIndex(x=>x.id===body.id);
      if(i>=0){ ch.msgs.splice(i,1); }
      continue;
    }
    if(body.kind==='react'){ // peer reacted to a message
      const ch=chat(c.id); const m=ch.msgs.find(x=>x.id===body.id);
      if(m){ m.reactions=m.reactions||{}; if(body.emoji)m.reactions.them=body.emoji; else delete m.reactions.them; }
      continue;
    }
    const ch=chat(c.id);
    const m={id:body.cid||uid(),from:'them',kind:body.kind,text:body.text||'',img:body.img||null,
             audio:body.audio||null,wave:body.wave||null,dur:body.dur||0,
             ts:body.ts||pkt.ts,status:'read',burn:!!body.burn,replyTo:body.replyTo||null};
    if(body.timer)m.expireAt=now()+body.timer*1000;
    ch.msgs.push(m);
    const activeInThisChat = (curChat===c.id) && !document.hidden;
    if(activeInThisChat){ netSendCtl(c,{kind:'read',ids:[m.id]}); }
    else { ch.unread=(ch.unread||0)+1;
      if(typeof notifyIncoming==='function') notifyIncoming(c,m);
    }
    if(m.expireAt)scheduleExpiry(m,c.id);
  }
  if(changed){ save(); if(curChat)renderMsgs(true); renderChats(); }
  // periodically refresh contact requests (every ~4th poll)
  refreshRequests();
  if(typeof autoBackup==='function')autoBackup();  // throttled to once/30min, app only
  // refresh chat-header presence (online/last seen) while a chat is open
  if(curChat && typeof fetchPresence==='function'){ const cc=contact(curChat); if(cc && cc.real && !cc.isGroup)fetchPresence(cc); }
}

/* ---- a message I sent from another of my devices ---- */
async function handleMyEcho(pkt){
  if(pkt.from!==me().kalId||!/^KAL-/.test(pkt.to))return false;   // app groups use their own scheme
  let c=D().contacts.find(x=>x.kalId===pkt.to);
  if(!c){ try{ c=await connectReal(pkt.to); }catch(e){ return false; } }
  // same shared key both ways: my key + their public key
  let body; try{ body=await decryptFrom(c,pkt.iv,pkt.blob); }catch(e){ return false; }
  if(!['text','img','voice'].includes(body.kind))return false;
  const ch=chat(c.id);
  if(ch.msgs.some(x=>x.id===body.cid))return false;
  ch.msgs.push({id:body.cid||uid(),from:'me',kind:body.kind,text:body.text||'',img:body.img||null,
    audio:body.audio||null,wave:body.wave||null,dur:body.dur||0,ts:body.ts||pkt.ts,status:'sent',
    burn:!!body.burn,replyTo:body.replyTo||null});
  ch.msgs.sort((a,b)=>a.ts-b.ts);
  return true;
}

/* ---- incoming group message ---- */
function handleGroupIncoming(gb){
  if(!gb.gid)return;
  let g=D().contacts.find(x=>x.kalId===gb.gid&&x.isGroup);
  if(!g){
    // joined a group we don't have locally yet — create shell
    g={id:uid(),name:gb.gname||'Group',kalId:gb.gid,isGroup:true,members:[],memberNames:{},
       color:COLORS[Math.floor(Math.random()*COLORS.length)],real:true};
    D().contacts.push(g); chat(g.id);
  }
  if(gb.fromKal&&gb.fromName){ g.memberNames=g.memberNames||{}; g.memberNames[gb.fromKal]=gb.fromName;
    if(!g.members.includes(gb.fromKal))g.members.push(gb.fromKal); }
  const ch=chat(g.id);
  if(ch.msgs.some(x=>x.id===gb.cid))return; // dedup
  const m={id:gb.cid||uid(),from:'them',senderName:gb.fromName||'',kind:gb.kind,text:gb.text||'',
           img:gb.img||null,audio:gb.audio||null,wave:gb.wave||null,dur:gb.dur||0,
           ts:gb.ts||now(),status:'read'};
  ch.msgs.push(m);
  if(curChat!==g.id){ ch.unread=(ch.unread||0)+1; if(typeof notifyIncoming==='function')notifyIncoming(g,m); }
  save();
  if(curChat===g.id)renderMsgs(true); else renderChats();
}

/* #10 auto-backup (app): silently save an encrypted backup to Downloads, no prompt */
async function autoBackup(force){
  if(!(typeof isNativeApp==='function'&&isNativeApp()))return; // app only
  if(!S||!S.identities?.length)return;
  // throttle: at most once every 30 min unless forced
  if(!force){ const last=+localStorage.getItem('kalisi_autobackup_ts')||0; if(Date.now()-last<30*60*1000)return; }
  localStorage.setItem('kalisi_autobackup_ts',String(Date.now()));
  try{
    // device-bound passphrase stored locally so restore is automatic on same device family
    let pass=localStorage.getItem('kalisi_autopass');
    if(!pass){ pass=crypto.getRandomValues(new Uint8Array(16)).reduce((a,b)=>a+b.toString(16).padStart(2,'0'),''); localStorage.setItem('kalisi_autopass',pass); }
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const key=await pbkey(pass,salt);
    const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(S)));
    const pack={kalisi_backup:1,auto:1,ts:now(),salt:b64(salt),iv:b64(iv),data:b64(ct)};
    saveFile('Kalisi-backup.kbk', JSON.stringify(pack));
    if(S){ S.lastBackup=now(); const m=me(); if(m)m.backedUp=true; save(); }
  }catch(e){}
}

/* ---- FCM push registration (native app supplies the token) ---- */
async function registerFCM(){
  if(!(typeof isNativeApp==='function'&&isNativeApp()))return;
  if(!me()?.token)return;
  // native app sets window.KalisiFCMToken after Firebase init; may arrive async
  const send=async(fcmToken)=>{
    if(!fcmToken)return;
    try{ await api('fcm_register',{...authBody(),fcm_token:fcmToken}); }catch(e){}
  };
  if(window.KalisiFCMToken){ send(window.KalisiFCMToken); }
  // native calls this global when the token is ready/refreshed
  window.onKalisiFCMToken=(t)=>{ window.KalisiFCMToken=t; send(t); };
  // ask native to fetch/register the token
  try{ if(window.KalisiFCM) window.KalisiFCM.postMessage('register'); }catch(e){}
}

/* ---- FCM: register device token with server (called by native app) ---- */
window.onKalisiFCMToken=function(token){
  window._kalisiFCMToken=token;
  registerFCM();
};
async function registerFCM(){
  const token=window._kalisiFCMToken||window.KalisiFCMToken;
  if(!token||!me()?.token)return;
  try{ await api('fcm_register',{...authBody(),fcm_token:token}); }catch(e){}
}
