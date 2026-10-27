/* ============ BharatApp Chat prototype — all data stays in this browser ============ */
'use strict';
const APP_VERSION='v0.5';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t==='light'?'light':'dark');
  const meta=document.querySelector('meta[name=theme-color]'); if(meta)meta.setAttribute('content', t==='light'?'#F4F5FA':'#0D1120');
  S=S||{}; S.set=S.set||{}; S.set.theme=t; if(localStorage.getItem(LS_KEY))save();
}
const LS_KEY='kalisi_v1';
const COLORS=['#06BA70','#7FA8F5','#59C98D','#E4739A','#B58CF0','#5FC9C9','#E4A05F'];
let S=null;                 // app state
let curChat=null;           // open contact id
let replyTo=null;
let burnOn=false;
let inviteTimer=null;

/* ---------- helpers ---------- */
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>Math.random().toString(36).slice(2,10);
const now=()=>Date.now();
function kalId(){const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';const p=n=>Array.from({length:n},()=>A[Math.floor(Math.random()*A.length)]).join('');return `KAL-${p(4)}-${p(4)}`;}
function fmtTime(ts){return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function fmtDay(ts){const d=new Date(ts),t=new Date();if(d.toDateString()===t.toDateString())return 'Today';const y=new Date(t-864e5);if(d.toDateString()===y.toDateString())return 'Yesterday';return d.toLocaleDateString([],{day:'numeric',month:'short',year:'numeric'});}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');clearTimeout(t._x);t._x=setTimeout(()=>t.classList.remove('on'),2400);}
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function save(){localStorage.setItem(LS_KEY,JSON.stringify(S));}
function load(){try{S=JSON.parse(localStorage.getItem(LS_KEY));}catch(e){S=null;}}
function me(){return S.identities.find(i=>i.id===S.active);}
function handleOf(o){return o.username?'@'+o.username:o.kalId;}
function D(){return S.data[S.active];}
function contact(id){return D().contacts.find(c=>c.id===id);}
function chat(id){if(!D().chats[id])D().chats[id]={msgs:[],timer:0,unread:0};return D().chats[id];}
function initials(n){return n.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();}
function avatarHTML(o,cls){return `<div class="avatar ${cls||''}" style="background:${o.color}">${esc(initials(o.name))}</div>`;}

/* ---------- bot brains ---------- */
const BOT_LINES={
 ravi:["Cheppu bro, whats the plan? 😄","Ha ok ok, correct point.","BharatApp Chat lo unnam kabatti freega matladachu 😎","Sare, evening call cheddam.","👍👍","Nenu kuda adhe anukunna!","Send me the location once ready.","Deal cheseddam, no problem."],
 priya:["Got it! Will check and tell you.","Nice! BharatApp Chat feels so smooth 😍","Ok done ✅","Hmm let me think about it.","Perfect, thank you!","Sending you the details in a bit.","Haha true! 😂","That burn message feature is crazy 🔥"],
 team:["Tip: tap 🔥 before sending to make a message burn after reading.","Your messages are relayed and instantly deleted from our server — long-press any delivered message to see its deletion receipt.","Try the Connect tab to see your QR code. Friends scan it in person — no numbers exchanged.","You can create a second persona from your avatar (top-left). Separate ID, separate chats."]
};
function botReply(c){
  const pool=BOT_LINES[c.brain]||BOT_LINES.priya;
  return pool[Math.floor(Math.random()*pool.length)];
}

/* ---------- first run ---------- */
function seedIdentity(name,reg,withDemos=true){
  const id=uid();
  const ident={id,name,kalId:reg?reg.kalId:kalId(),color:COLORS[0],created:now()};
  if(reg){ident.username=reg.username;ident.token=reg.token;ident.pub=reg.pub;ident.priv=reg.priv;}
  S={v:1,identities:[ident],active:id,data:{}};
  S.data[id]=freshData(withDemos);
  save();
  return ident;
}
function freshData(withDemos){
  const d={contacts:[],chats:{}};
  if(withDemos){
    const team={id:uid(),name:'BharatApp Chat Team',kalId:'KAL-TEAM-0001',color:'#06BA70',bot:true,brain:'team',verified:true};
    const ravi={id:uid(),name:'Ravi · Demo',kalId:kalId(),color:'#7FA8F5',bot:true,brain:'ravi'};
    const priya={id:uid(),name:'Priya · Demo',kalId:kalId(),color:'#E4739A',bot:true,brain:'priya'};
    d.contacts.push(team,ravi,priya);
    const t=now();
    d.chats[team.id]={timer:0,unread:2,msgs:[
      {id:uid(),from:'them',kind:'text',text:'Welcome to BharatApp Chat 🙏 Everything you send here stays on your phone. Our server only relays — then forgets.',ts:t-3600e3,status:'read'},
      {id:uid(),from:'them',kind:'text',text:'This is a burn-on-read message. Tap it — it can be viewed exactly once.',ts:t-3500e3,status:'read',burn:true},
    ]};
    d.chats[ravi.id]={timer:0,unread:1,msgs:[
      {id:uid(),from:'them',kind:'text',text:'Bro app super undhi! Number ivvakunda chat 🔥',ts:t-1800e3,status:'read'},
    ]};
    d.chats[priya.id]={timer:0,unread:0,msgs:[
      {id:uid(),from:'me',kind:'text',text:'Hi Priya, testing BharatApp Chat',ts:t-7200e3,status:'read',receipt:'pending'},
      {id:uid(),from:'them',kind:'text',text:'Hey! Yes it works great 😍',ts:t-7100e3,status:'read'},
    ]};
  }
  return d;
}

/* ---------- onboarding ---------- */
async function obSendCode(){
  const email=($('ob-email').value||'').trim();
  if(!/^[^@\s]+@(gmail|googlemail)\.com$/i.test(email)){toast('Enter a Gmail address');return;}
  const b=$('ob-send-code'); b.disabled=true;
  try{
    await api('email_otp_send',{email});
    $('ob-code-field').classList.remove('hide'); $('ob-code').focus();
    toast('Code sent — check your Gmail');
  }catch(e){
    toast({bad_email:'Enter a valid Gmail address',too_soon:'Wait '+(e.wait||60)+'s before asking again',
           too_many:'Too many codes — try again in an hour',email_send_failed:'Could not send the email — try again'}[e.message]||'Could not send code');
  }
  setTimeout(()=>{b.disabled=false;},30000);
}
async function obCreate(){
  const n=$('ob-name').value.trim();
  if(!n){toast('Enter a name first');return;}
  const un=($('ob-user').value||'').trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_]{3,20}$/.test(un)){toast('Username: 3–20 letters, numbers or _');return;}
  const email=($('ob-email').value||'').trim(), code=($('ob-code').value||'').trim();
  if(!email){toast('Enter your Gmail and tap Send code');return;}
  if(!/^\d{6}$/.test(code)){toast('Enter the 6-digit code from your email');return;}
  const pass=$('ob-pass').value||'';
  if(pass.length<8){toast('Password must be at least 8 characters');return;}
  toast('Creating @'+un+'…');
  let reg=null;
  try{
    // the key comes from the password, exactly as in the Android app, so the
    // same account opens on the phone and in any browser
    const salt=newSalt();
    const keys=await keyFromPassword(un,pass,salt);
    const verifier=await verifierFor(un,pass,salt);
    const r=await api('register',{name:n,username:un,pubkey:keys.pub,email,email_code:code,salt,verifier});
    reg={kalId:r.kal_id,username:r.username,token:r.token,pub:keys.pub,priv:keys.priv};
  }catch(e){
    if(e.message==='username_taken'){toast('@'+un+' is taken — try another');return;}
    if(e.message==='bad_username'){toast('Username: 3–20 letters, numbers or _');return;}
    const emailErr={bad_email:'Enter a valid Gmail address',email_required:'Verify your Gmail first',
      wrong_code:'Wrong code — check your email',code_expired:'Code expired — tap Send code again',
      too_many:'Too many tries — ask for a new code',email_limit:'This Gmail already has 5 accounts'}[e.message];
    if(emailErr){toast(emailErr);return;}
    const demo=await kConfirm({title:'Server unreachable',message:'A real account cannot be created right now. Continue in offline demo mode? (demo bots only — no real chatting, no @username reserved)',okText:'Demo mode',cancelText:'Cancel'});
    if(!demo)return;
  }
  const ident=seedIdentity(n,reg);
  $('ob-card-id').textContent=ident.username?'@'+ident.username:ident.kalId;
  $('ob-card-name').textContent=n+' · '+ident.kalId;
  window._keySaved=false;
  // No backup prompt for anyone. Account is created → mark backed-up (app auto-saves silently) and enter.
  if(me()){ me().backedUp=true; save(); }
  // brief confirmation card, then straight into the app
  $('ob-step1').classList.add('hide');
  $('ob-step2').classList.remove('hide');
  $('ob-backup-block')?.classList.add('hide');
  const webBtn=$('ob-enter-web'); if(webBtn){ webBtn.classList.remove('hide'); }
}
async function obSaveKey(){
  await backupData();
  if(window._lastBackupOk){
    const m=me(); if(m){m.backedUp=true; save();}
    toast('✅ Backup saved');
  }
}
function obSkipKey(){ obEnter(); }
function obEnter(){
  showApp();
  // silent auto-backup in the app (saves to Downloads via native channel, no dialog)
  if(typeof isNativeApp==='function'&&isNativeApp()){ setTimeout(()=>{ if(typeof autoBackup==='function')autoBackup(true); },1500); }
}

/* ---------- main shell ---------- */
function switchTab(btn){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('.tabpane').forEach(p=>p.classList.remove('on'));
  btn.classList.add('on'); $(btn.dataset.pane).classList.add('on');
  if(btn.dataset.pane==='pane-connect'){ renderConnect(); if(typeof refreshRequests==='function')refreshRequests(); }
  if(btn.dataset.pane==='pane-privacy')renderPrivacy();
  if(btn.dataset.pane==='pane-status')openStatusTab();
}
function renderAll(){
  const m=me();
  const av=$('me-avatar'); av.textContent=initials(m.name); av.style.background=m.color; av.style.color='#141A2E';
  renderChats(); renderConnect(); renderPrivacy(); renderPersonas();
}

/* ---------- chats list ---------- */
function lastMsgPreview(msgs){
  if(!msgs.length)return 'Say hello 👋';
  const m=msgs[msgs.length-1];
  if(m.burned)return '🔥 Message burned';
  if(m.burn&&!m.burned)return '🔥 Burn-on-read message';
  if(m.kind==='img')return '🖼 Photo';
  if(m.kind==='voice')return '🎙 Voice message';
  return (m.from==='me'?'You: ':'')+m.text;
}
function renderChats(){
  const nag=$('backup-nag'); if(nag){ const m=me(); const isApp=(typeof isNativeApp==='function'&&isNativeApp()); nag.classList.toggle('hide', !isApp||!m||!m.token||!!m.backedUp); }
  const q=($('chat-search').value||'').toLowerCase();
  const list=$('chat-list'); list.innerHTML='';
  const rows=D().contacts
    .map(c=>({c,ch:chat(c.id)}))
    .filter(({c})=>!isBlocked(c.kalId))
    .filter(({c})=>c.name.toLowerCase().includes(q))
    .sort((a,b)=>(b.ch.msgs.at(-1)?.ts||0)-(a.ch.msgs.at(-1)?.ts||0));
  if(!rows.length){list.innerHTML=`<div class="empty"><b>No chats yet.</b><br>Go to <b>Connect</b> to add a friend by QR or BharatApp Chat ID.</div>`;return;}
  for(const {c,ch} of rows){
    const last=ch.msgs.at(-1);
    const row=document.createElement('div'); row.className='chat-row'+(c.id===curChat?' active':'');
    row.innerHTML=`${avatarHTML(c)}
      <div class="chat-mid">
        <div class="chat-name">${esc(c.name)} ${c.verified?'<span class="vtag">TEAM</span>':''}${c.idChanged?'<span class="vtag" style="color:var(--ember);border-color:rgba(228,87,63,.45)">ID CHANGED</span>':''}</div>
        <div class="chat-last">${esc(lastMsgPreview(ch.msgs))}</div>
      </div>
      <div class="chat-side">
        <div class="chat-time">${last?fmtTime(last.ts):''}</div>
        ${ch.unread?`<div class="badge">${ch.unread}</div>`:''}
      </div>`;
    row.onclick=()=>openChat(c.id);
    // long-press / right-click to manage the chat without opening it
    let _lp; row.addEventListener('touchstart',()=>{ _lp=setTimeout(()=>openChatMenu(c.id),480); },{passive:true});
    row.addEventListener('touchend',()=>clearTimeout(_lp));
    row.addEventListener('touchmove',()=>clearTimeout(_lp));
    row.addEventListener('contextmenu',e=>{ e.preventDefault(); openChatMenu(c.id); });
    list.appendChild(row);
  }
}

/* ---------- connect tab ---------- */
function renderConnect(){
  const m=me();
  $('connect-body').innerHTML=`
    <div id="req-inbox"></div>
    <h3>My code</h3>
    <div class="qr-card">
      <div class="myid">${esc(handleOf(m))}</div>
      <div class="qr-wrap" id="qr-slot"></div>
      <div class="qr-sub">Friends type <b style="color:var(--gold)">${esc(handleOf(m))}</b> or scan this to connect.<br>No phone number is exchanged — ever.</div>
      <div class="row2">
        <button class="btn ghost" onclick="copyText('${esc(handleOf(m))}','Copied — share it anywhere')">Copy</button>
        <button class="btn ghost" onclick="simulateScan()">Simulate a friend scanning</button>
      </div>
    </div>
    <h3>Add a friend</h3>
    <div class="addrow">
      <input id="add-id" placeholder="@username" maxlength="20" autocapitalize="none">
      <button class="btn" onclick="addById()">Send request</button>
    </div>
    <h3>One-time invite link</h3>
    <p class="qr-sub" style="text-align:left;margin:0 0 4px">Expires in 10 minutes, works exactly once, then dies. No spam possible.</p>
    <button class="btn ghost" onclick="makeInvite()">Generate invite link</button>
    <div class="invite-box hide" id="invite-box">
      <div class="lnk" id="invite-link"></div>
      <div class="ttl" id="invite-ttl">10:00</div>
    </div>`;
  drawQR('qr-slot',m.username?inviteLink(m.username):handleOf(m));
  renderRequestsInbox();
}
function drawQR(slotId,text){
  try{
    const qr=qrcode(0,'M'); qr.addData(text); qr.make();
    $(slotId).innerHTML=qr.createSvgTag({cellSize:4,margin:0,scalable:true});
  }catch(e){ $(slotId).innerHTML='<div style="color:#999;font-size:12px;padding:60px 20px">QR unavailable</div>'; }
}
function openMyQR(){
  const m=me();
  $('qr-body').innerHTML=`
    <h2>My BharatApp Chat ID</h2>
    <p class="sub">Show this to a friend. They scan → you're connected. Your number stays yours.</p>
    <div class="qr-card">
      <div class="myid">${esc(handleOf(m))}</div>
      <div class="qr-wrap" id="qr-slot2"></div>
      <div class="qr-sub">${esc(m.name)} · persona created ${fmtDay(m.created)}</div>
    </div>`;
  // a link: opens the app and connects — or the Play Store if it isn't installed
  openSheet('sheet-qr'); drawQR('qr-slot2',m.username?inviteLink(m.username):handleOf(m));
}
function simulateScan(){
  const names=[['Anil K','#5FC9C9','priya'],['Suresh V','#B58CF0','ravi'],['Deepika','#E4A05F','priya'],['Karthik','#59C98D','ravi']];
  const pick=names[Math.floor(Math.random()*names.length)];
  const c={id:uid(),name:pick[0],kalId:kalId(),color:pick[1],bot:true,brain:pick[2]};
  D().contacts.push(c); chat(c.id); save();
  toast(`${c.name} connected via QR ✅`); renderChats();
  switchTab(document.querySelector('.tab[data-pane="pane-chats"]')); openChat(c.id);
  setTimeout(()=>{ botSend(c.id,'Hey! Scanned your QR, we are connected on BharatApp Chat now 🙌'); },1200);
}
async function addById(){
  if(!me().token){toast('⚠️ This account was created offline and cannot chat. Log out (Privacy tab) and sign up again.');return;}
  let v=$('add-id').value.trim();
  if(!v){toast('Type a @username');return;}
  const isKal=/^KAL-/i.test(v);
  if(isKal)v=v.toUpperCase(); else v=v.replace(/^@/,'').toLowerCase();
  if(v===me().kalId||v===me().username){toast("That's you 🙂");return;}
  try{
    const c=await sendRequest(v);
    if(!c)return;
    $('add-id').value='';
    if(isAccepted(c.kalId)){ switchTab(document.querySelector('.tab[data-pane="pane-chats"]')); openChat(c.id); }
    renderConnect();
  }catch(e){ toast(e.message==='not_found'?'No BharatApp Chat user with that name':(e.message==='bad_id'?'Invalid username':'Could not reach server')); }
}
function makeInvite(){
  const code=Math.random().toString(36).slice(2,8).toUpperCase();
  $('invite-box').classList.remove('hide');
  $('invite-link').textContent=`bharatapp.chat/i/${code}`;
  let left=600; clearInterval(inviteTimer);
  const tick=()=>{ left--; const mm=String(Math.floor(left/60)).padStart(2,'0'),ss=String(left%60).padStart(2,'0');
    const el=$('invite-ttl'); if(!el){clearInterval(inviteTimer);return;}
    el.textContent=`${mm}:${ss}`;
    if(left<=0){clearInterval(inviteTimer);$('invite-link').textContent='Link expired · generate a new one';el.textContent='☠';}};
  inviteTimer=setInterval(tick,1000);
  copyText(`bharatapp.chat/i/${code}`,'Invite link copied — expires in 10 min');
}
function copyText(t,msg){ navigator.clipboard?.writeText(t).then(()=>toast(msg)).catch(()=>toast(t)); }

/* ---------- privacy tab ---------- */
async function renderPrivacy(){
  const m=me();
  const fp=(await sha(m.kalId+':'+m.id)).slice(0,32).match(/.{4}/g).join(' ');
  const ic={
    shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    key:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="4"/><path d="M11 11l7 7M16 16l2-2M14 18l2-2"/></svg>',
    backup:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v10m0 0l-4-4m4 4l4-4"/><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/></svg>',
    restore:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21V11m0 0l-4 4m4-4l4 4"/><path d="M5 9V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/></svg>',
    export:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M5 3h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M9 13h6M9 17h4"/></svg>',
    trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/></svg>',
    info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    logout:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 12H4m0 0l4-4m-4 4l4 4"/><path d="M9 4h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9"/></svg>'
  };
  $('privacy-body').innerHTML=`
    <div class="priv-hero">
      <div class="priv-hero-ic">${ic.shield}</div>
      <div><div class="priv-hero-t">You're protected</div>
      <div class="priv-hero-s">End-to-end encrypted. No phone number. Nothing readable leaves your device.</div></div>
    </div>

    <button class="collapse-hd" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">
      <span class="ch-ic">🛡️</span>
      <span class="ch-tx"><b>What our server can see</b><span class="ch-sub">Spoiler: almost nothing</span></span>
      <span class="ch-ar">›</span>
    </button>
    <div class="collapse-bd">
      <div class="pcard" style="margin-top:0">
        <div class="prow"><span class="k">Phone number</span><span class="pill no">Never asked</span></div>
        <div class="prow"><span class="k">Contacts list</span><span class="pill no">Never uploaded</span></div>
        <div class="prow"><span class="k">Message content</span><span class="pill no">Unreadable</span></div>
        <div class="prow"><span class="k">Stored messages</span><span class="pill rel">Deleted on delivery</span></div>
        <div class="prow"><span class="k">Your @username</span><span class="pill rel">Needed to route</span></div>
      </div>
    </div>

    <div class="sec-label">Chat defaults</div>
    <div class="pcard">
      <div class="prow"><span class="k">Disappearing messages</span>
        <select class="mini-select" onchange="S.defTimer=+this.value;save();toast('Default updated')">${timerOptions(S.defTimer||0)}</select></div>
      <div class="prow"><span class="k">Read receipts</span>${toggle('set_readReceipts',S.set?.readReceipts!==false)}</div>
      <div class="prow"><span class="k">Screenshot protection</span><span class="pill rel">Off</span></div>
    </div>

    <div class="sec-label">Encryption key</div>
    <div class="pcard">
      <div class="ph">${ic.key}<span>Device key fingerprint</span></div>
      <div class="ps">Generated and stored only on this phone. Compare it with a contact in person to verify no one is in the middle.</div>
      <div class="fp-box">${fp}</div>
    </div>

    <div class="sec-label">Backup &amp; data</div>
    <div class="pcard tight">
      <div class="ps" style="padding:14px 16px 4px">Changing phones? Save an encrypted backup, then restore it — your identity, contacts and chats come back exactly as they are.</div>
      <button class="row-btn" onclick="backupData()"><span class="row-ic ok">${ic.backup}</span><span class="row-tx">Save encrypted backup</span><span class="row-ar">›</span></button>
      <button class="row-btn" onclick="restorePick()"><span class="row-ic">${ic.restore}</span><span class="row-tx">Restore from backup</span><span class="row-ar">›</span></button>
      <button class="row-btn" onclick="exportData()"><span class="row-ic">${ic.export}</span><span class="row-tx">Export readable data</span><span class="row-ar">›</span></button>
      <button class="row-btn danger" onclick="wipeAll()"><span class="row-ic dz">${ic.trash}</span><span class="row-tx">Wipe everything from this phone</span><span class="row-ar">›</span></button>
    </div>

    <div class="sec-label">Account</div>
    <div class="pcard tight">
      <button class="row-btn" onclick="openSheet('sheet-about')"><span class="row-ic">${ic.info}</span><span class="row-tx">About BharatApp Chat · how it works</span><span class="row-ar">›</span></button>
      <button class="row-btn danger" onclick="logout()"><span class="row-ic dz">${ic.logout}</span><span class="row-tx">Log out from this phone</span><span class="row-ar">›</span></button>
    </div>
    <p class="priv-foot">BharatApp Chat · your privacy, respected<br>All data lives on this device only</p>`;
}
function timerOptions(sel){
  const o=[[0,'Off'],[21600,'6 hours'],[43200,'12 hours'],[86400,'24 hours'],[604800,'7 days'],[2592000,'30 days']];
  return o.map(([v,l])=>`<option value="${v}" ${v===sel?'selected':''}>${l}</option>`).join('');
}
function exportData(){
  saveFile('kalisi-export.json', JSON.stringify(S,null,2));
  toast('Exported — this is ALL the data that exists.');
}
async function logout(){
  const ok=await kConfirm({title:'Log out?',message:'Your account exists only on this phone. Without a backup, logging out deletes it permanently — your @username, keys and chats. Auto-backup keeps a copy in Downloads.',okText:'Log out',cancelText:'Stay',danger:true});
  if(!ok)return;
  localStorage.removeItem(LS_KEY); location.reload();
}
async function wipeAll(){
  if(!await kConfirm({title:'Wipe everything?',message:'Delete every persona, contact and message from this phone? This cannot be undone.',okText:'Wipe all',danger:true}))return;
  localStorage.removeItem(LS_KEY); location.reload();
}

/* ---------- personas ---------- */
function renderPersonas(){
  const list=$('persona-list'); list.innerHTML='';
  for(const p of S.identities){
    const row=document.createElement('div'); row.className='p-row';
    row.innerHTML=`${avatarHTML(p)}
      <div class="pm"><div class="pn">${esc(p.name)}</div><div class="pid">${esc(handleOf(p))}</div></div>
      ${p.id===S.active?'<div class="cur">ACTIVE</div>':''}`;
    row.onclick=()=>{ if(p.id!==S.active){S.active=p.id;save();closeSheets();renderAll();toast('Switched to '+p.name);} };
    list.appendChild(row);
  }
}
async function addPersona(){
  const n=$('new-persona').value.trim();
  if(!n){toast('Give the persona a name');return;}
  if(S.identities.length>=5){toast('Max 5 personas in prototype');return;}
  let un=n.toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,14)||'user';
  un=un+Math.floor(100+Math.random()*900);
  let reg=null;
  try{
    const keys=await genKeys();
    const parent=me()&&me().token?{parent_kal_id:me().kalId,parent_token:me().token}:{};
    const r=await api('register',{name:n,username:un,pubkey:keys.pub,...parent});
    reg={kalId:r.kal_id,username:r.username,token:r.token,pub:keys.pub,priv:keys.priv};
  }catch(e){ toast('Server unreachable — offline persona'); }
  const id=uid();
  const np={id,name:n,kalId:reg?reg.kalId:kalId(),color:COLORS[S.identities.length%COLORS.length],created:now()};
  if(reg){np.username=reg.username;np.token=reg.token;np.pub=reg.pub;np.priv=reg.priv;}
  S.identities.push(np);
  S.data[id]=freshData(false);
  S.active=id; save();
  $('new-persona').value=''; closeSheets(); renderAll();
  toast('New persona created — fresh ID, fresh chats');
}

/* ---------- chat screen ---------- */
function openChat(cid){
  curChat=cid; replyTo=null; burnOn=false; clearReply(); setBurnUI();
  const c=contact(cid), ch=chat(cid);
  // pending (request not yet accepted) → lock composer
  const pending = c.real && !c.isGroup && !isAccepted(c.kalId) && isPendingOut(c.kalId);
  setTimeout(()=>{ const comp=$('composer'); if(comp) comp.style.display = pending ? 'none' : '';
    let pb=$('pending-bar'); if(pending){ if(!pb){ pb=document.createElement('div'); pb.id='pending-bar';
        pb.style.cssText='padding:14px;text-align:center;color:var(--muted);font-size:13.5px;background:var(--panel);border-top:1px solid var(--line)';
        $('scr-chat').appendChild(pb);} pb.textContent='⏳ Request sent — you can chat once '+handleOf(c)+' accepts.'; pb.style.display='block';
      } else if(pb){ pb.style.display='none'; } },0);
  if(c.real&&ch.unread>0){
    const ids=ch.msgs.filter(x=>x.from==='them').slice(-30).map(x=>x.id);
    if(ids.length)netSendCtl(c,{kind:'read',ids});
  }
  ch.unread=0; save();
  $('chat-name').textContent=c.name;
  const av=$('chat-avatar'); av.textContent=initials(c.name); av.style.background=c.color; av.style.color='#141A2E';
  if(c.isGroup){ $('chat-sub-t').textContent=groupMsgLabel(c); }
  else { setSub(); fetchPresence(c); }
  // header menu button
  const hm=$('chat-header-menu'); if(hm)hm.onclick=()=>openChatMenu(cid);
  $('scr-main').classList.remove('on'); $('scr-chat').classList.add('on');
  renderChats();   // highlight the open chat in the side list (PC layout)
  renderMsgs(true);
}
function setSub(txt,typing){
  const s=$('chat-sub'); s.classList.toggle('typing',!!typing);
  // default subtitle is empty until presence loads (no encryption text)
  $('chat-sub-t').textContent=txt||'';
}
async function fetchPresence(c){
  if(!c.real||c.isGroup||!me().token){ $('chat-sub-t').textContent=''; return; }
  try{
    const r=await api('presence',{...authBody(),kal_id:c.kalId});
    if(curChat!==c.id)return;
    if(typeof _typingFrom!=='undefined' && _typingFrom===c.id)return; // don't overwrite "typing…"
    const t=r.last_seen;
    const diff=(Date.now()-t)/1000;
    let s;
    if(diff<70) s='online';
    else if(diff<3600){ const m=Math.max(1,Math.floor(diff/60)); s='last seen '+m+' min ago'; }
    else if(diff<86400){ const h=Math.floor(diff/3600); s='last seen '+h+' hour'+(h>1?'s':'')+' ago'; }
    else if(diff<7*86400){ const d=Math.floor(diff/86400); s='last seen '+d+' day'+(d>1?'s':'')+' ago'; }
    else s='last seen recently';
    const sub=$('chat-sub'); if(sub)sub.classList.toggle('online', s==='online');
    $('chat-sub-t').textContent=s;
  }catch(e){ $('chat-sub-t').textContent=''; }
}
function timerLabel(t){return {21600:'6h',43200:'12h',86400:'24h',604800:'7d',2592000:'30d'}[t]||'off';}
function openChatMenu(cid){
  const c=contact(cid);
  let items='';
  if(c.isGroup){
    items=`<div class="menu-it" onclick="closeSheets();showGroupInfo('${cid}')">👥 &nbsp;Group info</div>`;
  }else{
    const blocked=isBlocked(c.kalId);
    items=blocked
      ? `<div class="menu-it" onclick="unblockContact('${c.kalId}');closeSheets()">✅ &nbsp;Unblock ${esc(handleOf(c))}</div>`
      : `<div class="menu-it red" onclick="blockContact('${cid}')">🚫 &nbsp;Block ${esc(handleOf(c))}</div>`;
  }
  items+=`<div class="menu-it" onclick="clearChatMsgs('${cid}')">🧹 &nbsp;Clear messages</div>`;
  items+=`<div class="menu-it red" onclick="deleteChat('${cid}')">🗑 &nbsp;Delete chat</div>`;
  $('msgmenu-body').innerHTML=items+`<div class="menu-it" onclick="closeSheets()">Cancel</div>`;
  openSheet('sheet-msgmenu');
}
async function clearChatMsgs(cid){
  const c=contact(cid); if(!c)return;
  closeSheets();
  if(!await kConfirm({title:'Clear messages?',message:'This empties the conversation on your phone only. The chat and contact stay.',okText:'Clear',cancelText:'Cancel'}))return;
  const ch=chat(cid); ch.msgs=[]; ch.unread=0; save();
  closeSheets(); if(curChat===cid)renderMsgs(false); renderChats();
  toast('Messages cleared');
}
async function deleteChat(cid){
  const c=contact(cid); if(!c)return;
  const name=c.name||handleOf(c)||'this chat';
  closeSheets();
  if(!await kConfirm({title:'Delete '+name+'?',message:'This removes the conversation and the contact from your phone. You can add them again later with their @username. Their copy is not affected.',okText:'Delete',danger:true}))return;
  // remove the chat's messages (chats is an object keyed by id)
  if(D().chats[cid])delete D().chats[cid];
  // remove the contact from the list
  const pi=D().contacts.findIndex(x=>x.id===cid);
  if(pi>=0)D().contacts.splice(pi,1);
  save();
  closeSheets();
  if(curChat===cid)closeChat();
  renderChats();
  toast(name+' deleted');
}
function showGroupInfo(cid){
  const c=contact(cid);
  const names=Object.entries(c.memberNames||{}).map(([k,n])=>`<div class="prow"><span class="k">${esc(n)}</span></div>`).join('');
  $('msginfo-body').innerHTML=`<h2>${esc(c.name)}</h2><p class="sub">${(c.members||[]).length} members</p><div class="pcard">${names}</div>`;
  openSheet('sheet-msginfo');
}
function closeChat(){ $('scr-chat').classList.remove('on'); $('scr-main').classList.add('on'); curChat=null; renderChats(); }
function ticks(m){
  if(m.from!=='me')return '';
  const t=m.status==='sent'?'✓':'✓✓';
  return `<span class="tick ${m.status==='read'?'read':''}">${t}</span>`;
}
function renderMsgs(scroll){
  const box=$('msgs'); const ch=chat(curChat); const c=contact(curChat);
  box.innerHTML = ch.msgs.length<=6 ? `<div class="enc-note">🔒 Messages are end-to-end encrypted and stored only on your phones. BharatApp Chat's server relays them, then deletes its copy.</div>` : '';
  let lastDay='';
  for(const m of ch.msgs){
    const day=fmtDay(m.ts);
    if(day!==lastDay){ lastDay=day; box.insertAdjacentHTML('beforeend',`<div class="daychip">${day}</div>`); }
    box.insertAdjacentHTML('beforeend',msgHTML(m,c));
  }
  box.querySelectorAll('[data-mid]').forEach(el=>{
    el.addEventListener('click',()=>onBubbleTap(el.dataset.mid));
    let t; el.addEventListener('touchstart',()=>{t=setTimeout(()=>openMsgMenu(el.dataset.mid),480);},{passive:true});
    el.addEventListener('touchend',()=>clearTimeout(t));
    el.addEventListener('contextmenu',e=>{e.preventDefault();openMsgMenu(el.dataset.mid);});
  });
  if(scroll)box.scrollTop=box.scrollHeight;
}
function reactionChips(m){
  if(!m.reactions)return '';
  const set=[];
  if(m.reactions.me)set.push(m.reactions.me);
  if(m.reactions.them&&m.reactions.them!==m.reactions.me)set.push(m.reactions.them);
  if(!set.length)return '';
  return `<div class="msg-reacts">${set.map(e=>`<span>${e}</span>`).join('')}</div>`;
}
function msgHTML(m,c){
  const side=m.from==='me'?'mine':'theirs';
  if(m.burned) return `<div class="brow ${side}"><div class="bub"><div class="burned-stub">🔥 ${m.from==='me'?'Burned after being read':'This message was burned'}</div></div></div>`;
  let inner='';
  if(m.burn && !m.revealed){
    inner=`<div class="burn-cover">🔥 ${m.from==='me'?'Burn message · waiting to be read':'Tap to view once'}</div>`;
    return `<div class="brow ${side}"><div class="bub burnable" data-mid="${m.id}">${inner}<div class="meta">${fmtTime(m.ts)} ${ticks(m)}</div></div></div>`;
  }
  if(c.isGroup&&m.from==='them'&&m.senderName) inner+=`<div class="grp-sender">${esc(m.senderName)}</div>`;
  if(m.replyTo) inner+=`<div class="quote"><b>${m.replyTo.from==='me'?'You':esc(c.name)}</b>${esc(m.replyTo.text)}</div>`;
  if(m.kind==='img') inner+=`<img src="${m.img}" alt="photo">`;
  if(m.kind==='voice') inner+=voiceBubbleHTML(m);
  if(m.text) inner+=esc(m.text);
  const burnCls=m.burn?' burnable':'';
  const burnBar=m.burn&&m.revealed?`<div class="burn-bar"><i style="animation:burnbar ${BURN_VIEW_S}s linear forwards"></i></div>`:'';
  const reacts=reactionChips(m);
  return `<div class="brow ${side}"><div class="bub-wrap"><div class="bub${burnCls}" data-mid="${m.id}">${inner}${burnBar}<div class="meta">${m.expireAt?'⌛ ':''}${fmtTime(m.ts)} ${ticks(m)}</div></div>${reacts}</div></div>`;
}
const BURN_VIEW_S=6;
function onBubbleTap(mid){
  const ch=chat(curChat); const m=ch.msgs.find(x=>x.id===mid);
  if(!m||!m.burn||m.burned||m.revealed)return;
  if(m.from==='me')return; // sender can't re-open own burn msg
  m.revealed=true; save(); renderMsgs(true);
  setTimeout(()=>burnMsg(mid),BURN_VIEW_S*1000);
}
function burnMsg(mid){
  if(!curChat)return; const ch=chat(curChat);
  const m=ch.msgs.find(x=>x.id===mid); if(!m||m.burned)return;
  const el=document.querySelector(`[data-mid="${mid}"]`);
  const done=()=>{ m.burned=true; m.text=''; m.img=null; m.audio=null; save(); if(curChat)renderMsgs(false); renderChats();
    const cc=contact(curChat); if(cc&&cc.real&&m.from==='them')netSendCtl(cc,{kind:'burned',id:mid}); };
  if(el){ el.classList.add('burning'); setTimeout(done,1100); } else done();
}

/* ---------- sending ---------- */
function toggleBurn(){ burnOn=!burnOn; setBurnUI(); }
function setBurnUI(){ $('burn-toggle').classList.toggle('on',burnOn); $('burn-hint').classList.toggle('on',burnOn); }
function clearReply(){ replyTo=null; $('reply-bar').classList.remove('on'); }
function setReply(m,c){ replyTo={id:m.id,text:m.kind==='img'?'🖼 Photo':m.text,from:m.from};
  $('reply-who').textContent=m.from==='me'?'You':c.name; $('reply-txt').textContent=replyTo.text;
  $('reply-bar').classList.add('on'); $('msg-in').focus(); }

function sendMsg(){
  const inp=$('msg-in'); const txt=inp.value.trim();
  if(!txt||!curChat)return;
  pushMine({kind:'text',text:txt});
  inp.value=''; inp.style.height='auto';
}
function sendImage(input){
  const f=input.files[0]; input.value='';
  if(!f||!curChat)return;
  const img=new Image(); const rd=new FileReader();
  rd.onload=()=>{ img.onload=()=>{
      const mx=800, k=Math.min(1,mx/Math.max(img.width,img.height));
      const cv=document.createElement('canvas'); cv.width=img.width*k; cv.height=img.height*k;
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      pushMine({kind:'img',img:cv.toDataURL('image/jpeg',.7),text:''});
    }; img.src=rd.result; };
  rd.readAsDataURL(f);
}
function pushMine(part){
  const ch=chat(curChat); const c=contact(curChat);
  const m={id:uid(),from:'me',ts:now(),status:'sent',burn:burnOn,...part};
  if(replyTo)m.replyTo=replyTo;
  if(ch.timer)m.expireAt=now()+ch.timer*1000;
  ch.msgs.push(m); clearReply(); burnOn=false; setBurnUI(); save(); renderMsgs(true);
  if(c.isGroup){
    netSendGroup(c,m).catch(()=>toast('Group message not sent — check internet'));
  } else if(c.real){
    netSend(c,m).catch(e=>{
      if(e.message==='auth_required'||e.message==='auth_failed')
        toast('⚠️ This account is not activated on the server — go to Privacy → Log out, then sign up fresh');
      else if(e.message==='recipient_not_found')
        toast('That account no longer exists on the server');
      else if(e.message==='account_disabled')
        toast('⚠️ This account has been disabled by the administrator');
      else toast('Not sent — check internet');
    });
  }
  if(c.bot){
    setTimeout(async()=>{ m.status='delivered'; m.receipt=(await sha(m.id+m.ts)).slice(0,16); save(); if(curChat)renderMsgs(false); },700);
    setTimeout(()=>{ if(curChat===c.id)setSub('typing…',true); },1400);
    setTimeout(()=>{
      m.status='read'; if(m.burn&&!m.burned){m.revealed=true; setTimeout(()=>burnMsg(m.id),1500);} save();
      botSend(c.id, botReply(c));
      if(curChat===c.id)setSub();
    },2600+Math.random()*1200);
  }
  scheduleExpiry(m,curChat);
}
function botSend(cid,text){
  const ch=chat(cid);
  const m={id:uid(),from:'them',kind:'text',text,ts:now(),status:'read'};
  if(ch.timer)m.expireAt=now()+ch.timer*1000;
  ch.msgs.push(m);
  if(curChat!==cid)ch.unread=(ch.unread||0)+1;
  save();
  if(curChat===cid)renderMsgs(true); else renderChats();
  scheduleExpiry(m,cid);
}

/* ---------- disappearing messages ---------- */
function scheduleExpiry(m,cid){
  if(!m.expireAt)return;
  const dt=m.expireAt-now();
  setTimeout(()=>{
    const ch=chat(cid); const i=ch.msgs.findIndex(x=>x.id===m.id);
    if(i<0)return; ch.msgs.splice(i,1); save();
    if(curChat===cid)renderMsgs(false); renderChats();
  },Math.max(0,dt));
}
function openTimerSheet(){
  const ch=chat(curChat);
  $('timer-opts').innerHTML=[[0,'Off'],[21600,'6 hours'],[43200,'12 hours'],[86400,'24 hours'],[604800,'7 days'],[2592000,'30 days']]
    .map(([v,l])=>`<div class="menu-it" onclick="setTimerVal(${v})">${v===ch.timer?'●':'○'} &nbsp;${l}</div>`).join('');
  openSheet('sheet-timer');
}
function setTimerVal(v){
  chat(curChat).timer=v; save(); closeSheets(); setSub();
  toast(v?`New messages auto-delete after ${timerLabel(v)}`:'Disappearing messages off');
}

/* ---------- message menu / info ---------- */
function openMsgMenu(mid){
  const ch=chat(curChat); const m=ch.msgs.find(x=>x.id===mid); if(!m||m.burned)return;
  const c=contact(curChat);
  const emojis=['❤️','😂','👍','😮','😢','🙏'];
  const reactBar=`<div class="react-bar">${emojis.map(e=>`<button class="react-emoji" onclick='reactMsg("${mid}","${e}")'>${e}</button>`).join('')}</div>`;
  $('msgmenu-body').innerHTML=reactBar+`
    <div class="menu-it" onclick='closeSheets();window._reply("${mid}")'>↩ &nbsp;Reply</div>
    <div class="menu-it" onclick='closeSheets();openMsgInfo("${mid}")'>ℹ &nbsp;Message info</div>
    <div class="menu-it red" onclick='delMsg("${mid}",false)'>🗑 &nbsp;Delete for me</div>
    ${m.from==='me'?`<div class="menu-it red" onclick='delMsg("${mid}",true)'>💥 &nbsp;Delete for everyone</div>`:''}`;
  window._reply=id=>{const mm=ch.msgs.find(x=>x.id===id); if(mm)setReply(mm,c);};
  openSheet('sheet-msgmenu');
}
function reactMsg(mid,emoji){
  const ch=chat(curChat); const c=contact(curChat); const m=ch.msgs.find(x=>x.id===mid);
  if(!m)return;
  // toggle my reaction
  m.reactions=m.reactions||{};
  if(m.reactions.me===emoji){ delete m.reactions.me; } else { m.reactions.me=emoji; }
  save();
  if(c&&c.real&&!c.isGroup){ netSendCtl(c,{kind:'react',id:mid,emoji:m.reactions.me||''}); }
  closeSheets(); renderMsgs(false);
}
function delMsg(mid,both){
  const ch=chat(curChat); const c=contact(curChat); const i=ch.msgs.findIndex(x=>x.id===mid);
  if(both && c && c.real && !c.isGroup){
    netSendCtl(c,{kind:'delete',id:mid});   // tell peer to remove it too
  }
  if(i>=0){ ch.msgs.splice(i,1); save(); }
  closeSheets(); renderMsgs(false); renderChats();
  toast(both?'Deleted for everyone':'Deleted for you');
}
function openMsgInfo(mid){
  const ch=chat(curChat); const m=ch.msgs.find(x=>x.id===mid); if(!m)return;
  const rows=[];
  rows.push(['Sent',fmtDay(m.ts)+' · '+fmtTime(m.ts)]);
  if(m.from==='me'){
    rows.push(['Delivered',m.status!=='sent'?'✓✓':'—']);
    rows.push(['Read',m.status==='read'?'✓✓ <span style="color:var(--gold)">read</span>':'—']);
  }
  rows.push(['Encryption','End-to-end · keys on both phones only']);
  if(m.receipt)rows.push(['Server copy','Deleted on delivery']);
  if(m.receipt)rows.push(['Deletion receipt','<span class="mono" style="font-size:12px">'+m.receipt+'</span>']);
  if(m.burn)rows.push(['Burn-on-read',m.burned?'Burned 🔥':'Armed']);
  if(m.expireAt)rows.push(['Auto-delete',fmtTime(m.expireAt)]);
  $('msginfo-body').innerHTML=`<h2>Message info</h2>
    <p class="sub">The deletion receipt is proof that the relay server destroyed its copy of this message the moment it was delivered.</p>
    ${rows.map(([k,v])=>`<div class="mi-row"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('')}`;
  openSheet('sheet-msginfo');
}

/* ---------- sheets ---------- */
function openSheet(id){ $('backdrop').classList.add('on'); $(id).classList.add('on'); }
function closeSheets(){ $('backdrop').classList.remove('on'); document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('on')); if(typeof statusViewerClosed==='function')statusViewerClosed(); }

/* ---------- boot ---------- */
/* #9 in-app back navigation */
function kalisiBack(){
  const openSheet=document.querySelector('.sheet.on');
  if(openSheet){ closeSheets(); return true; }
  if(document.getElementById('scr-chat')?.classList.contains('on')){ closeChat(); return true; }
  const chatsPane=document.getElementById('pane-chats');
  if(chatsPane && !chatsPane.classList.contains('on') && document.getElementById('scr-main')?.classList.contains('on')){
    switchTab(document.querySelector('.tab[data-pane="pane-chats"]')); return true;
  }
  return false;
}
window.kalisiBack=kalisiBack;
window.addEventListener('popstate',()=>{ if(kalisiBack()){ try{history.pushState(null,'');}catch(e){} } });
try{ history.pushState(null,''); }catch(e){}

(function(){
  load();
  const inp=$('msg-in');
  inp.addEventListener('input',()=>{inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,110)+'px';
    const has=inp.value.trim().length>0;
    document.getElementById('send-btn').classList.toggle('hide',!has);
    document.getElementById('mic-btn').classList.toggle('hide',has);});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}});
  if(S&&S.identities?.length){
    const d=S.data[S.active];for(const cid in d.chats){for(const m of d.chats[cid].msgs){if(m.expireAt)scheduleExpiry(m,cid);}}
    if(!me().token)setTimeout(()=>toast('⚠️ Offline demo account — sign up again to chat for real'),800);
  }
  applyTheme(S&&S.set&&S.set.theme?S.set.theme:'light');
  if(S&&S.set&&S.set.secureAll)secureOn();
  bootRoute();
})();
