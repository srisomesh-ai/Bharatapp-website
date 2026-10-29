/* ============ BharatApp Chat prototype — all data stays in this browser ============ */
'use strict';
const APP_VERSION='v0.5';
function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t==='light'?'light':'dark');
  const meta=document.querySelector('meta[name=theme-color]'); if(meta)meta.setAttribute('content', t==='light'?'#F4F5FA':'#0D1120');
  S=S||{}; S.set=S.set||{}; S.set.theme=t; if(localStorage.getItem(LS_KEY))save();
}
/* ?desk=1 is the support desk (opened from the admin panel): it signs in as
   @support and keeps its own storage, apart from anyone's personal account. */
const DESK=new URLSearchParams(location.search).get('desk')==='1';
const LS_KEY=DESK?'bharatapp_desk':'kalisi_v1';
const SUPPORT_HANDLE='@support';
const COLORS=['#06BA70','#7FA8F5','#59C98D','#E4739A','#B58CF0','#5FC9C9','#E4A05F'];
let S=null;                 // app state
let curChat=null;           // open contact id
let replyTo=null;
let burnOn=false;
let inviteTimer=null;

/* ---------- helpers ---------- */
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Photos, voice notes and files arrive from other people: only real base64
// data URLs may go into src/href (anything else could run code on this page).
const DATA_RE=/^data:(image|video|audio|application|text)\/[\w.+-]+(;[\w.+-]+=[\w.+-]+)*;base64,[A-Za-z0-9+\/=\s]*$/;
function safeData(u){ return typeof u==='string'&&DATA_RE.test(u)?u:null; }
function safeMid(id){ return typeof id==='string'&&/^[\w.-]{1,64}$/.test(id)?id:uid(); }
function safeEmoji(e){ return typeof e==='string'&&e.length<=16&&!/[<>"'&]/.test(e)?e:null; }
const uid=()=>Math.random().toString(36).slice(2,10);
const now=()=>Date.now();
function kalId(){const A='ABCDEFGHJKMNPQRSTUVWXYZ23456789';const p=n=>Array.from({length:n},()=>A[Math.floor(Math.random()*A.length)]).join('');return `KAL-${p(4)}-${p(4)}`;}
function fmtTime(ts){return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function fmtDay(ts){const d=new Date(ts),t=new Date();if(d.toDateString()===t.toDateString())return 'Today';const y=new Date(t-864e5);if(d.toDateString()===y.toDateString())return 'Yesterday';return d.toLocaleDateString([],{day:'numeric',month:'short',year:'numeric'});}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');clearTimeout(t._x);t._x=setTimeout(()=>t.classList.remove('on'),2400);}
async function sha(s){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');}
function save(){
  try{ localStorage.setItem(LS_KEY,JSON.stringify(S)); return true; }
  catch(e){
    // browser storage full (photos/videos fill it): drop the oldest media
    // on this browser, keep the words, and try again
    try{
      const all=[];
      for(const a of Object.values(S.data||{})) for(const ch of Object.values(a.chats||{}))
        for(const m of ch.msgs||[]) if(m.img||m.file||m.audio) all.push(m);
      all.sort((a,b)=>a.ts-b.ts);
      for(const m of all.slice(0,Math.max(5,Math.ceil(all.length/2)))){
        m.img=null; m.file=null; m.audio=null; m.mediaGone=true;
      }
      localStorage.setItem(LS_KEY,JSON.stringify(S));
      if(!save._warned){ save._warned=1; toast('Browser storage full — older photos and files removed from this browser'); }
      return true;
    }catch(e2){ return false; }
  }
}
function load(){try{S=JSON.parse(localStorage.getItem(LS_KEY));}catch(e){S=null;}}
function me(){return S.identities.find(i=>i.id===S.active);}
function handleOf(o){return o.username?'@'+o.username:o.kalId;}
function D(){return S.data[S.active];}
function contact(id){return D().contacts.find(c=>c.id===id);}
function chat(id){if(!D().chats[id])D().chats[id]={msgs:[],timer:0,unread:0};return D().chats[id];}
function initials(n){return n.trim().split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase();}
function avatarHTML(o,cls){return `<div class="avatar ${cls||''}" style="background:${o.color}">${esc(initials(o.name))}</div>`;}

/* Old sign-ups came with three made-up demo chats; clear them out. */
function dropDemoContacts(){
  if(!S||!S.data)return;
  let changed=false;
  for(const d of Object.values(S.data)){
    const gone=(d.contacts||[]).filter(c=>c.bot);
    for(const c of gone){ delete d.chats[c.id]; changed=true; }
    if(gone.length)d.contacts=d.contacts.filter(c=>!c.bot);
  }
  if(changed)save();
}

/* ---------- first run ---------- */
function seedIdentity(name,reg){
  const id=uid();
  const ident={id,name,kalId:reg?reg.kalId:kalId(),color:COLORS[0],created:now()};
  if(reg){ident.username=reg.username;ident.token=reg.token;ident.pub=reg.pub;ident.priv=reg.priv;}
  S={v:1,identities:[ident],active:id,data:{}};
  S.data[id]=freshData();
  save();
  return ident;
}
function freshData(){ return {contacts:[],chats:{}}; }

/* ---------- onboarding ---------- */
/* ---- sign-up: A) name, @username, Gmail → code sent; B) code + password → account → sign in ---- */
const USER_MSG={premium:'Names with only letters are for BharatApp Premium — add a number, or pick one below',
  rules:'Use 4 or more letters and at least 1 number (letters, numbers, _)',
  taken:'is taken — try one of these',invalid:'Only letters, numbers and _'};
let _obUserT=null,_obUserOk='';
function _obSugg(list){
  const box=$('ob-sugg'); box.innerHTML='';
  for(const u of list||[]){
    const b=document.createElement('button'); b.type='button'; b.textContent='@'+u;
    b.onclick=()=>{ $('ob-user').value=u; obCheckUser(); };
    box.appendChild(b);
  }
}
function obCheckUser(){
  const el=$('ob-user'), st=$('ob-user-status');
  const v=el.value.replace(/^@+/,'').toLowerCase().replace(/[^a-z0-9_]/g,'');
  if(v!==el.value)el.value=v;
  _obUserOk=''; clearTimeout(_obUserT); _obSugg([]);
  if(!v){ st.className='ob-why'; st.textContent='4 or more letters and at least 1 number, e.g. sri_in7 or jenny21'; return; }
  st.className='ob-why'; st.textContent='Checking @'+v+'…';
  _obUserT=setTimeout(async()=>{
    try{
      const r=await api('check',{username:v});
      if($('ob-user').value!==v)return;
      if(r.available){ _obUserOk=v; st.className='ob-why ok'; st.textContent='✓ @'+v+' is available'; return; }
      st.className='ob-why bad';
      st.textContent=r.reason==='taken'?'@'+v+' '+USER_MSG.taken:(USER_MSG[r.reason]||USER_MSG.rules);
      _obSugg(r.suggestions);
    }catch(e){ st.className='ob-why'; st.textContent='Could not check right now'; }
  },350);
}
const OB_ERR={bad_email:'Enter a valid Gmail address',email_required:'Verify your Gmail first',
  wrong_code:'Wrong code — check your Gmail',code_expired:'Code expired — go Back and tap Create again',
  too_soon:'Wait a minute before asking for another code',too_many:'Too many tries — try again in an hour',
  email_send_failed:'Could not send the email — try again',email_in_use:'This Gmail already has an account — log in instead',
  email_limit:'This Gmail already has an account — log in instead',username_taken:'That @username was just taken — go Back and pick another',
  bad_username:USER_MSG.rules,premium_username:USER_MSG.premium};
async function obStart(){
  const n=$('ob-name').value.trim(), un=$('ob-user').value.trim(), email=($('ob-email').value||'').trim();
  if(!n){toast('Enter your name');return;}
  if(!un){toast('Choose a @username');return;}
  if(_obUserOk!==un){ obCheckUser(); toast('Pick an available @username first'); return; }
  if(!/^[^@\s]+@(gmail|googlemail)\.com$/i.test(email)){toast('Enter your Gmail address');return;}
  const b=$('ob-create'); b.disabled=true;
  try{
    await api('email_otp_send',{email});
    $('ob-sent').innerHTML='We sent a 6-digit code to <b>'+esc(email)+'</b>.';
    $('ob-a').classList.add('hide'); $('ob-b').classList.remove('hide');
    setTimeout(()=>$('ob-code').focus(),150);
  }catch(e){ toast(OB_ERR[e.message]||'Could not send the code — check your internet'); }
  finally{ b.disabled=false; }
}
function obBack(){ $('ob-b').classList.add('hide'); $('ob-a').classList.remove('hide'); }
/* A guessable password would let someone rebuild the account key, so ask for
   a reasonable one: 8+ characters, letters and numbers, not the username. */
function passwordProblem(pass,username){
  if(pass.length<8)return 'Password must be at least 8 characters';
  if(!/[a-z]/i.test(pass)||!/[0-9]/.test(pass))return 'Use both letters and numbers in your password';
  const low=pass.toLowerCase();
  if(username&&low.includes(username))return "Your password can't contain your username";
  if(/^(password|qwerty|abc|bharat|india|12345)/.test(low))return 'That password is too easy to guess';
  return '';
}
async function obCreate(){
  const n=$('ob-name').value.trim(), un=$('ob-user').value.trim();
  const email=($('ob-email').value||'').trim(), code=($('ob-code').value||'').trim();
  const pass=$('ob-pass').value||'', pass2=$('ob-pass2').value||'';
  if(!/^\d{6}$/.test(code)){toast('Enter the 6-digit code from your Gmail');return;}
  const pwBad=passwordProblem(pass,un); if(pwBad){toast(pwBad);return;}
  if(pass!==pass2){toast("The two passwords don't match");return;}
  const b=$('ob-finish'); b.disabled=true; toast('Creating @'+un+'…');
  try{
    // the key comes from the password, exactly as in the Android app, so the
    // same account opens on the phone and in any browser
    const salt=newSalt();
    const keys=await keyFromPassword(un,pass,salt);
    const verifier=await verifierFor(un,pass,salt);
    const r=await api('register',{name:n,username:un,pubkey:keys.pub,email,email_code:code,salt,verifier});
    // this browser proved the Gmail, so the first sign-in needs no second code
    if(r.trust){ try{ localStorage.setItem('bharatapp_trust_'+r.username,r.trust); }catch(e){} }
    $('ob-pass').value=''; $('ob-pass2').value=''; $('ob-code').value='';
    obBack(); $('ob-user').value=''; _obUserOk='';
    showLogin();
    $('lg-user').value=r.username||un; setTimeout(()=>$('lg-pass').focus(),250);
    lgMsg('✓ Account created — sign in with your password.');
  }catch(e){ toast(OB_ERR[e.message]||'Could not create the account — check your internet'); }
  finally{ b.disabled=false; }
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
        <div class="chat-name">${esc(c.name)} ${handleOf(c)===SUPPORT_HANDLE?'<span class="vtag">OFFICIAL</span>':''}${c.idChanged?'<span class="vtag" style="color:var(--ember);border-color:rgba(228,87,63,.45)">ID CHANGED</span>':''}</div>
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
  S.data[id]=freshData();
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
    // read receipts off in Settings: none; view-once not opened yet: not read
    const ids=ch.msgs.filter(x=>x.from==='them'&&!(x.burn&&!x.revealed)).slice(-30).map(x=>x.id);
    if(ids.length&&S.set?.readReceipts!==false)netSendCtl(c,{kind:'read',ids});
  }
  if(c.real)clearPhoneAlerts(c);
  ch.unread=0; save();
  $('chat-name').textContent=c.name;
  const av=$('chat-avatar'); av.textContent=initials(c.name); av.style.background=c.color; av.style.color='#141A2E';
  if(c.isGroup){ $('chat-sub-t').textContent=groupMsgLabel(c); }
  else { setSub(); fetchPresence(c); }
  // header menu button
  const hm=$('chat-header-menu'); if(hm)hm.onclick=()=>openChatMenu(cid);
  // tap the name or photo for the info panel, as in WhatsApp
  for(const id of ['chat-avatar','chat-name']){ const el=$(id); if(el){ el.style.cursor='pointer'; el.onclick=()=>c.isGroup?showGroupInfo(cid):showContactInfo(cid); } }
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
    const r=await api('presence',{...authBody(),target:c.kalId});
    if(curChat!==c.id)return;
    if(typeof _typingFrom!=='undefined' && _typingFrom===c.id)return; // don't overwrite "typing…"
    if(r.hidden){ $('chat-sub-t').textContent=''; return; }   // they hide their last seen
    const t=r.last_seen;
    const diff=(Date.now()-t)/1000;
    let s;
    if(diff<70) s='online';
    else if(diff<3600){ const m=Math.max(1,Math.floor(diff/60)); s='last seen '+m+' min ago'; }
    else if(diff<86400){ const h=Math.floor(diff/3600); s='last seen '+h+' hour'+(h>1?'s':'')+' ago'; }
    else if(diff<7*86400){ const d=Math.floor(diff/86400); s='last seen '+d+' day'+(d>1?'s':'')+' ago'; }
    else s='last seen recently';
    const sub=$('chat-sub'); if(sub)sub.classList.toggle('online', s==='online');
    // my waiting messages are red while they're offline, light green while online
    const on=s==='online'; if(c._online!==on){ c._online=on; renderMsgs(false); }
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
    items=`<div class="menu-it" onclick="closeSheets();showContactInfo('${cid}')">👤 &nbsp;Contact info</div>`;
    items+=blocked
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
  if(c.isGroup){
    if(!await kConfirm({title:'Exit and delete '+name+'?',message:'You will leave the group and its messages will be removed from this browser.',okText:'Exit and delete',danger:true}))return;
    // leave on the server first, or the group comes back with its next message
    try{ await api('group_update',{...authBody(),gid:c.kalId,act:'leave'}); }
    catch(e){ if(e.message!=='group_not_found'&&e.message!=='not_a_member'){ toast('Could not leave the group — please try again'); return; } }
    D().leftGroups=D().leftGroups||[]; if(!D().leftGroups.includes(c.kalId))D().leftGroups.push(c.kalId);
  } else
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
/* Info panels, laid out like WhatsApp's: who, media, settings, then the red actions. */
function mediaSummary(cid){
  const msgs=(chat(cid).msgs||[]).filter(m=>!m.burn);
  const photos=msgs.filter(m=>m.kind==='img'&&m.img).reverse();
  const docs=msgs.filter(m=>m.kind==='file').length;
  const links=msgs.filter(m=>(!m.kind||m.kind==='text')&&/https?:\/\//.test(m.text||'')).length;
  const pl=(n,w)=>n+' '+w+(n===1?'':'s');
  const strip=photos.slice(0,12).map(m=>`<img class="info-ph" src="${esc(m.img)}" alt="">`).join('');
  return `<div class="pcard"><div class="ph">Media, links and docs</div>`+
    (strip?`<div class="info-strip">${strip}</div>`:'')+
    `<div class="ps">${pl(photos.length,'photo')} · ${pl(docs,'document')} · ${pl(links,'link')}</div></div>`;
}
const ENC_COPY='Messages are end-to-end encrypted. BharatApp Chat never saves your history.';
function showContactInfo(cid){
  const c=contact(cid); if(!c)return;
  const blocked=isBlocked(c.kalId);
  const groups=D().contacts.filter(g=>g.isGroup&&(g.members||[]).includes(c.kalId));
  $('msginfo-body').innerHTML=`<div class="info-head">${avatarHTML(c,'big')}<h2>${esc(c.name)}</h2>`+
    `<p class="sub">${esc(handleOf(c)||'')}</p></div>`+
    `<div class="pcard"><div class="ph">About</div>`+
      `<div class="prow"><span class="k">Username</span><span>${esc(handleOf(c)||'—')}</span></div>`+
      (c.kalId?`<div class="prow"><span class="k">BharatApp Chat ID</span><span>${esc(c.kalId)}</span></div>`:'')+`</div>`+
    mediaSummary(cid)+
    `<div class="pcard"><div class="ph">🔒 Encryption</div><div class="ps">${ENC_COPY}</div></div>`+
    (groups.length?`<div class="pcard"><div class="ph">${groups.length} group${groups.length===1?'':'s'} in common</div>`+
      groups.map(g=>`<div class="prow"><span>${esc(g.name)}</span></div>`).join('')+`</div>`:'')+
    `<div class="pcard">`+
      (blocked?`<div class="prow info-act" onclick="unblockContact('${c.kalId}');closeSheets()">✅ Unblock ${esc(handleOf(c))}</div>`
              :`<div class="prow info-act red" onclick="blockContact('${cid}')">🚫 Block ${esc(handleOf(c))}</div>`)+
      `<div class="prow info-act red" onclick="clearChatMsgs('${cid}')">🧹 Clear messages</div>`+
      `<div class="prow info-act red" onclick="deleteChat('${cid}')">🗑 Delete chat</div></div>`;
  openSheet('sheet-msginfo');
}
function showGroupInfo(cid){
  const c=contact(cid);
  const names=Object.entries(c.memberNames||{}).map(([k,n])=>`<div class="prow"><span>${esc(n)}</span></div>`).join('');
  $('msginfo-body').innerHTML=`<div class="info-head">${avatarHTML(c,'big')}<h2>${esc(c.name)}</h2>`+
    `<p class="sub">Group · ${(c.members||[]).length} members</p></div>`+
    mediaSummary(cid)+
    `<div class="pcard"><div class="ph">🔒 Encryption</div><div class="ps">Messages are end-to-end encrypted with a key shared by the members. BharatApp Chat never saves your history.</div></div>`+
    `<div class="pcard"><div class="ph">${(c.members||[]).length} members</div>${names}</div>`+
    `<div class="pcard"><div class="prow info-act red" onclick="clearChatMsgs('${cid}')">🧹 Clear messages</div>`+
    `<div class="prow info-act red" onclick="deleteChat('${cid}')">🗑 Delete chat</div></div>`;
  openSheet('sheet-msginfo');
}
function closeChat(){ $('scr-chat').classList.remove('on'); $('scr-main').classList.add('on'); curChat=null; renderChats(); }
/* how far my message got: ◌ sending, ○ sent, ● delivered, green ● + green
   bubble edge = read, ! = not sent (it is retried automatically) */
function ticks(m){
  if(m.from!=='me')return '';
  const st=m.status||'sent';
  if(st==='failed')return '<span class="st failed" title="Not sent yet — will retry">!</span>';
  const label={sending:'Sending',sent:'Sent',delivered:'Delivered',read:'Read'}[st]||'Sent';
  return `<span class="st ${st}" title="${label}"></span>`;
}
function fileHTML(m){
  const name=esc(m.fileName||'file'), kb=m.fileSize?Math.max(1,Math.round(m.fileSize/1024))+' KB':'';
  const f=safeData(m.file);
  if(m.mediaGone&&!f) return `<div class="file-card"><span class="fi">${esc(((m.fileName||'').split('.').pop()||'FILE').slice(0,4).toUpperCase())}</span><span>${name}<small>Removed from this browser</small></span></div>`;
  if(/^data:video\//.test(f||'')) return `<video src="${esc(f)}" controls preload="metadata"></video>`;
  const ext=(m.fileName||'').split('.').pop().slice(0,4).toUpperCase()||'FILE';
  return `<a class="file-card" href="${f?esc(f):'#'}" download="${name}"><span class="fi">${esc(ext)}</span><span>${name}<small>${kb} · tap to download</small></span></a>`;
}
function renderMsgs(scroll){
  const box=$('msgs'); const ch=chat(curChat); const c=contact(curChat);
  box.innerHTML = ch.msgs.length<=6 ? `<div class="enc-note">🔒 BharatApp Chat never saves your history.</div>` : '';
  let lastDay='';
  for(const m of ch.msgs){
    const day=fmtDay(m.ts);
    if(day!==lastDay){ lastDay=day; box.insertAdjacentHTML('beforeend',`<div class="daychip">${day}</div>`); }
    box.insertAdjacentHTML('beforeend',msgHTML(m,c));
  }
  // live typing: their words as they type them
  if(c&&c._draft) box.insertAdjacentHTML('beforeend',`<div class="brow theirs"><div class="bub draft-bub">${esc(c._draft)}<span class="dl">typing…</span></div></div>`);
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
  return `<div class="msg-reacts">${set.map(e=>`<span>${esc(e)}</span>`).join('')}</div>`;
}
function msgHTML(m,c){
  const side=m.from==='me'?'mine':'theirs';
  if(m.burned) return `<div class="brow ${side}"><div class="bub"><div class="burned-stub">🔥 ${m.from==='me'?'Burned after being read':'This message was burned'}</div></div></div>`;
  let inner='';
  if(m.burn && !m.revealed){
    inner=`<div class="burn-cover">🔥 ${m.from==='me'?'Burn message · waiting to be read':'Tap to view once'}</div>`;
    return `<div class="brow ${side}"><div class="bub burnable" data-mid="${esc(m.id)}">${inner}<div class="meta">${fmtTime(m.ts)} ${ticks(m)}</div></div></div>`;
  }
  if(c.isGroup&&m.from==='them'&&m.senderName) inner+=`<div class="grp-sender">${esc(m.senderName)}</div>`;
  if(m.replyTo) inner+=`<div class="quote"><b>${m.replyTo.from==='me'?'You':esc(c.name)}</b>${esc(m.replyTo.text)}</div>`;
  if(m.kind==='img') inner+=safeData(m.img)?`<img src="${esc(m.img)}" alt="photo">`:`<div class="burned-stub">📷 Photo${m.mediaGone?' · removed from this browser':''}</div>`;
  if(m.kind==='voice') inner+=voiceBubbleHTML(m);
  if(m.kind==='file') inner+=fileHTML(m);
  if(m.text) inner+=esc(m.text);
  const burnCls=m.burn?' burnable':'';
  const burnBar=m.burn&&m.revealed?`<div class="burn-bar"><i style="animation:burnbar ${BURN_VIEW_S}s linear forwards"></i></div>`:'';
  const reacts=reactionChips(m);
  // my bubbles: light red = not delivered yet, light green = delivered, green = read
  const peerOnline=!!(curChat&&contact(curChat)?._online);
  const readCls=m.from!=='me'?'':m.status==='read'?' is-read':m.status==='delivered'?'':
    (m.status==='failed'||!peerOnline)?' is-waiting':'';
  return `<div class="brow ${side}"><div class="bub-wrap"><div class="bub${burnCls}${readCls}" data-mid="${esc(m.id)}">${inner}${burnBar}<div class="meta">${m.expireAt?'⌛ ':''}${fmtTime(m.ts)} ${ticks(m)}</div></div>${reacts}</div></div>`;
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
/* ---- composer extras: attach menu, emoji, documents and videos ---- */
function toggleAttach(){ $('emoji-pop').classList.remove('on'); $('attach-pop').classList.toggle('on'); }
const EMOJI='😀 😂 🤣 😊 😍 😘 😎 🤔 😅 😭 😡 🥳 🙏 👍 👎 👏 🙌 💪 ❤️ 💔 🔥 ✨ 🎉 💯 👀 🤝 🌸 ☕ 🍛 🎂 ✅ ❌'.split(' ');
function toggleEmoji(){
  const p=$('emoji-pop'); $('attach-pop').classList.remove('on');
  if(!p.childElementCount) p.innerHTML=EMOJI.map(e=>`<button type="button" onclick="addEmoji('${e}')">${e}</button>`).join('');
  p.classList.toggle('on');
}
function addEmoji(e){
  const inp=$('msg-in'), at=inp.selectionStart??inp.value.length;
  inp.value=inp.value.slice(0,at)+e+inp.value.slice(inp.selectionEnd??at);
  inp.focus(); inp.selectionStart=inp.selectionEnd=at+e.length; inp.dispatchEvent(new Event('input'));
}
document.addEventListener('click',e=>{ if(!e.target.closest('#composer-main')){ $('attach-pop')?.classList.remove('on'); $('emoji-pop')?.classList.remove('on'); } });
const FILE_MAX=5*1024*1024;
function sendFile(input){
  const f=input.files&&input.files[0]; input.value='';
  if(!f)return;
  if(f.size>FILE_MAX){ toast('Files up to 5 MB can be sent'); return; }
  kConfirm({title:'Send this file?',message:f.name+' · '+Math.max(1,Math.round(f.size/1024))+' KB',okText:'Send',cancelText:'Cancel'}).then(ok=>{
    if(!ok)return;
    const rd=new FileReader();
    rd.onload=()=>pushMine({kind:'file',file:rd.result,fileName:f.name,fileSize:f.size,text:''});
    rd.readAsDataURL(f);
  });
}
/* ---- typing: tell them I'm typing, and (live typing) what I'm writing ---- */
let _typingAt=0,_draftT=null,_draftSent='';
function liveTypingOn(){ return !(S&&S.set&&S.set.liveTyping===false); }
function onComposeInput(){
  const c=curChat&&contact(curChat); if(!c||!c.real||c.isGroup)return;
  const v=$('msg-in').value;
  if(v.trim()&&Date.now()-_typingAt>4000){ _typingAt=Date.now(); netSendLive(c,{kind:'typing'}); }
  if(!liveTypingOn())return;
  clearTimeout(_draftT);
  _draftT=setTimeout(()=>{ if(v===_draftSent)return; _draftSent=v; netSendLive(c,{kind:'draft',text:v.slice(0,500)}); },350);
}
function stopDraft(c){ clearTimeout(_draftT); if(_draftSent){ _draftSent=''; netSendLive(c,{kind:'draft',text:''}); } }
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
  const m={id:uid(),from:'me',ts:now(),status:c.real&&!c.isGroup?'sending':'sent',burn:burnOn,...part};
  if(replyTo)m.replyTo=replyTo;
  if(ch.timer)m.expireAt=now()+ch.timer*1000;
  ch.msgs.push(m); clearReply(); burnOn=false; setBurnUI(); save(); renderMsgs(true);
  if(c.isGroup){
    netSendGroup(c,m).catch(()=>toast('Group message not sent — check internet'));
  } else if(c.real){
    stopDraft(c);
    _inflight.add(m.id);
    netSend(c,m).finally(()=>_inflight.delete(m.id)).then(()=>{ if(m.status==='sending'){ m.status='sent'; save(); if(curChat===c.id)renderMsgs(false); } }).catch(e=>{
      m.status='failed'; save(); if(curChat===c.id)renderMsgs(false);
      if(e.message==='auth_required'||e.message==='auth_failed')
        toast('⚠️ This account is not activated on the server — go to Privacy → Log out, then sign up fresh');
      else if(e.message==='recipient_not_found')
        toast('That account no longer exists on the server');
      else if(e.message==='account_disabled')
        toast('⚠️ This account has been disabled by the administrator');
      else if(e.message==='not_connected')
        toast('Not sent — you are not connected with this person any more');
      else toast('Not sent yet — it will send when you are back online');
    });
  }
  scheduleExpiry(m,curChat);
}
/* ---------- disappearing messages ---------- */
function scheduleExpiry(m,cid){
  if(!m.expireAt)return;
  const dt=m.expireAt-now();
  // browsers fire timers over ~24.8 days at once: wait in steps
  if(dt>2e9){ setTimeout(()=>scheduleExpiry(m,cid),2e9); return; }
  setTimeout(()=>{
    if(m.expireAt>now()+1000){ scheduleExpiry(m,cid); return; }
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
/* Read here: take this chat's notification off my phone(s) too (at most every 10 s per chat). */
const _clearedAt={};
function clearPhoneAlerts(c){
  if(!c||!c.kalId||!me()?.token||Date.now()-(_clearedAt[c.kalId]||0)<10000)return;
  _clearedAt[c.kalId]=Date.now();
  api('notify_devices',{...authBody(),type:'clear',key:c.kalId}).catch(()=>{});
}
function openMsgMenu(mid){
  const ch=chat(curChat); const m=ch.msgs.find(x=>x.id===mid); if(!m||m.burned)return;
  const c=contact(curChat);
  const emojis=['❤️','😂','👍','😮','😢','🙏'];
  const reactBar=`<div class="react-bar">${emojis.map(e=>`<button class="react-emoji" onclick='reactMsg("${mid}","${e}")'>${e}</button>`).join('')}</div>`;
  $('msgmenu-body').innerHTML=reactBar+`
    <div class="menu-it" onclick='closeSheets();window._reply("${mid}")'>↩ &nbsp;Reply</div>
    ${m.burn?'':`<div class="menu-it" onclick='closeSheets();openForward("${mid}")'>↪ &nbsp;Forward</div>`}
    <div class="menu-it" onclick='closeSheets();openMsgInfo("${mid}")'>ℹ &nbsp;Message info</div>
    <div class="menu-it red" onclick='delMsg("${mid}",false)'>🗑 &nbsp;Delete for me</div>
    ${m.from==='me'?`<div class="menu-it red" onclick='delMsg("${mid}",true)'>💥 &nbsp;Delete for everyone</div>`:''}`;
  window._reply=id=>{const mm=ch.msgs.find(x=>x.id===id); if(mm)setReply(mm,c);};
  openSheet('sheet-msgmenu');
}
/* ---- forward: pick chats, send each one a copy. A fingerprint of the
   content (never the content) goes with it, as in the app, so a forward
   chain can be traced on a lawful order. ---- */
let _fwd=null;
function openForward(mid){
  const m=chat(curChat).msgs.find(x=>x.id===mid); if(!m)return;
  const list=D().contacts.filter(c=>c.id!==curChat&&(c.isGroup||(c.real&&!c.pending&&!(typeof isBlocked==='function'&&isBlocked(c.kalId)))))
    .sort((a,b)=>a.name.localeCompare(b.name));
  if(!list.length){ toast('No other chats to forward to'); return; }
  _fwd={m,from:curChat,picked:new Set()};
  $('fwd-list').innerHTML=list.map(c=>`<label class="fwd-it"><input type="checkbox" value="${c.id}" onchange="fwdPick(this)">${avatarHTML(c,'sm')}<span>${esc(c.name)}${c.username?` <small class="muted">@${esc(c.username)}</small>`:''}</span></label>`).join('');
  $('fwd-go').disabled=true; $('fwd-go').textContent='Forward';
  openSheet('sheet-forward');
}
function fwdPick(el){ el.checked?_fwd.picked.add(el.value):_fwd.picked.delete(el.value);
  const n=_fwd.picked.size; $('fwd-go').disabled=!n; $('fwd-go').textContent=n>1?'Forward to '+n+' chats':'Forward'; }
async function fwdHash(m){
  const media=m.kind==='img'||m.kind==='voice'||m.kind==='file';
  const content=media?(m.img||m.audio||m.file||''):String(m.text||'').trim().replace(/\s+/g,' ');
  const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('kalisi-fwd-v1\n'+(media?'media':'text')+'\n'+content));
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function doForward(){
  if(!_fwd||!_fwd.picked.size)return;
  const {m,from,picked}=_fwd; _fwd=null; closeSheets();
  const src=contact(from);
  const fwd={fwd_hash:await fwdHash(m)};
  if(m.from!=='me'&&src&&!src.isGroup&&src.kalId)fwd.fwd_from=src.kalId;
  let sent=0;
  for(const id of picked){
    const c=contact(id); if(!c)continue;
    const part={kind:m.kind,text:m.text||'',img:m.img||null,audio:m.audio||null,file:m.file||null,
      fileName:m.fileName||null,fileSize:m.fileSize||null,wave:m.wave||null,dur:m.dur||0};
    if(c.isGroup&&m.kind==='file'){ part.kind='text'; part.text='📄 '+(m.fileName||'Document'); part.file=null; }
    const nm={id:uid(),from:'me',ts:now(),status:c.isGroup?'sent':'sending',...part};
    chat(id).msgs.push(nm); save();
    try{
      if(c.isGroup) await netSendGroup(c,nm,fwd);
      else{ await netSend(c,nm,fwd); if(nm.status==='sending')nm.status='sent'; }
      sent++;
    }catch(e){ nm.status='failed'; }
  }
  save(); renderChats(); if(curChat)renderMsgs(false);
  toast(sent>1?'Forwarded to '+sent+' chats':sent?'Forwarded':'Not sent — check your internet');
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
  dropDemoContacts();
  const inp=$('msg-in');
  inp.addEventListener('input',()=>{inp.style.height='auto';inp.style.height=Math.min(inp.scrollHeight,110)+'px';
    const has=inp.value.trim().length>0;
    document.getElementById('send-btn').classList.toggle('hide',!has);
    document.getElementById('mic-btn').classList.toggle('hide',has);
    onComposeInput();});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}});
  if(S&&S.identities?.length){
    const d=S.data[S.active];for(const cid in d.chats){for(const m of d.chats[cid].msgs){if(m.expireAt)scheduleExpiry(m,cid);}}
    if(!me().token)setTimeout(()=>toast('⚠️ Offline demo account — sign up again to chat for real'),800);
  }
  applyTheme(S&&S.set&&S.set.theme?S.set.theme:'light');
  if(S&&S.set&&S.set.secureAll)secureOn();
  bootRoute();
})();
