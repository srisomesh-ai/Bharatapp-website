/* ============ BharatApp Chat landing + entry routing ============ */

// Decide first screen: returning user with an account skips landing.
function isNativeApp(){
  return /KalisiApp/i.test(navigator.userAgent) || location.search.indexOf('app=1')>=0 || window.KalisiNative || window.KalisiBundled || location.protocol==='file:';
}
/* ---- invite links (what the QR holds): bharatapp.chat/add/<username> ---- */
const PLAY_URL='https://play.google.com/store/apps/details?id=chat.bharatappchat.app';
function inviteLink(username){ return 'https://bharatapp.chat/add/'+username; }
/* Returns true when the page was opened from an invite and handled it. */
function handleInvite(){
  const u=(new URLSearchParams(location.search).get('add')||'').toLowerCase();
  if(!/^[a-z0-9_]{3,30}$/.test(u))return false;
  history.replaceState(null,'',location.pathname);
  // Android: open the app if it's installed, otherwise the Play Store
  if(/Android/i.test(navigator.userAgent)&&!isNativeApp()){
    location.href='intent://add/'+u+'#Intent;scheme=kalisi;package=chat.bharatappchat.app;S.browser_fallback_url='+encodeURIComponent(PLAY_URL)+';end';
  }
  showInvite(u);
  return true;
}
function showInvite(u){
  const signedIn=!!(S&&S.identities&&S.identities.length&&me()?.token);
  kConfirm({title:'Chat with @'+u+' on BharatApp Chat',
    message:signedIn?'Send @'+u+' a contact request? You can chat once they accept.'
                    :'Get the BharatApp Chat app to connect with @'+u+', or create an account here in your browser.',
    okText:signedIn?'Connect':'Get it on Google Play', cancelText:signedIn?'Not now':'Use in browser'})
  .then(async ok=>{
    if(!signedIn){ if(ok){ location.href=PLAY_URL; } else { window._pendingInvite=u; landStart(); } return; }
    if(!ok)return;
    try{ const c=await connectReal(u); await api('req_send',{...authBody(),to:c.kalId}); toast('Request sent to @'+u); }
    catch(e){ toast(e.message==='not_found'?'No user found with @'+u:'Could not connect'); }
  });
}
function bootRoute(){
  if(isNativeApp())document.body.classList.add('native-app');
  if(DESK){
    document.body.classList.add('desk');
    if(S && S.identities && S.identities.length){ showApp(); return true; }
    showLogin(true);
    $('lg-user').value='support';
    setTimeout(()=>$('lg-pass')?.focus(),250);
    return false;
  }
  const invited=handleInvite();
  if(S && S.identities && S.identities.length){
    // existing account on this device → straight to app
    showApp();
    return true;
  }
  if(invited)return false;   // the invite dialog decides where to go
  if(isNativeApp()){
    // inside the Android app: no marketing landing — go straight to create/login
    document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
    $('scr-onboard').classList.add('on');
    $('ob-step1').classList.remove('hide');
    $('ob-step2').classList.add('hide');
    return false;
  }
  // web visitor, no account → show landing
  document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
  $('scr-landing').classList.add('on');
  return false;
}

/* ---- back to the home page from sign-up / log-in ----
   The browser's Back button does the same: entering sign-up or log-in adds
   a history entry, and going back to it shows the home page again. */
function goHome(){
  if(history.state&&history.state.kscr){ history.back(); return; }
  showLanding();
}
function showLanding(){
  if(isNativeApp())return;           // the app has no home page
  document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
  $('scr-landing').classList.add('on');
}
function _pushScreen(name){
  if(isNativeApp())return;
  if(history.state&&history.state.kscr){ history.replaceState({kscr:name},''); }
  else history.pushState({kscr:name},'');
}
window.addEventListener('popstate',()=>{
  // only while signed out: the home page is the start of the journey
  if(S&&S.identities&&S.identities.length&&me()?.token)return;
  if(history.state&&history.state.kscr==='login'){ showLogin(true); return; }
  if(history.state&&history.state.kscr==='signup'){ landStart(true); return; }
  showLanding();
});

function landStart(fromHistory){
  if(fromHistory!==true)_pushScreen('signup');
  // go to onboarding (create account)
  document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
  $('scr-onboard').classList.add('on');
  $('ob-step1').classList.remove('hide');
  $('ob-step2').classList.add('hide');
  $('ob-login').classList.add('hide'); $('ob-forgot').classList.add('hide');
  setTimeout(()=>$('ob-name')?.focus(),200);
}

function landRestore(){ showLogin(); }

/* ---- home page: check a @username live, then carry it into sign-up ---- */
let _lpTimer=null, _lpSeq=0, _lpOk='';
function _lpStatus(t,cls){ const e=$('lp-status'); e.textContent=t; e.className='lp-status'+(cls?' '+cls:''); }
function lpCheck(){
  const el=$('lp-user'); const v=el.value.replace(/^@+/,'').toLowerCase().replace(/[^a-z0-9_]/g,'');
  if(v!==el.value)el.value=v;
  _lpOk=''; clearTimeout(_lpTimer);
  if(!v){ _lpStatus('4 or more letters and at least 1 number, e.g. jenny21'); return; }
  _lpStatus('Checking @'+v+'…');
  const seq=++_lpSeq;
  _lpTimer=setTimeout(async()=>{
    try{
      const r=await api('check',{username:v});
      if(seq!==_lpSeq)return;
      if(r.available){ _lpOk=v; _lpStatus('✓ @'+v+' is available','ok'); return; }
      const why=r.reason==='taken'?'@'+v+' is unavailable':
        r.reason==='premium'?'Letters-only names are for Premium':'Use 4+ letters and at least 1 number';
      _lpStatus(why+((r.suggestions||[]).length?' — try ':''),'bad');
      for(const u of r.suggestions||[]){
        const b=document.createElement('button'); b.type='button'; b.className='lp-sugg'; b.textContent='@'+u;
        b.onclick=()=>{ $('lp-user').value=u; lpCheck(); };
        $('lp-status').appendChild(b);
      }
    }catch(e){ if(seq===_lpSeq)_lpStatus('Could not check right now — try again'); }
  },350);
}
function lpClaim(){
  const v=$('lp-user').value;
  if(!v){ $('lp-user').focus(); _lpStatus('Type the username you want','bad'); return; }
  if(_lpOk!==v){ lpCheck(); return; }
  landStart();
  const u=$('ob-user'); if(u){ u.value=v; u.dispatchEvent(new Event('input',{bubbles:true})); }
  setTimeout(()=>$('ob-name')?.focus(),250);
}

/* ---- log in: @username + password. A new browser is asked once for a code
   sent to the account's Gmail; after that this browser is trusted. ---- */
function showLogin(fromHistory){
  if(fromHistory!==true)_pushScreen('login');
  document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
  $('scr-onboard').classList.add('on');
  $('ob-step1').classList.add('hide'); $('ob-step2').classList.add('hide');
  $('ob-login').classList.remove('hide'); $('ob-forgot').classList.add('hide');
  $('lg-step2').classList.add('hide'); $('lg-code').value=''; lgMsg('');
  setTimeout(()=>$('lg-user')?.focus(),200);
}
const _lgUser=()=>($('lg-user').value||'').trim().replace(/^@/,'').toLowerCase();
function lgMsg(t){ $('lg-msg').textContent=t||''; }
const LOGIN_ERR={wrong_password:'Wrong username or password',bad_input:'Enter your username and password',
  no_recovery:'This account has no password, so it can only be opened on the phone it was made on',
  too_soon:'Wait a minute before asking for another code',
  too_many:'Too many tries — try again later',email_send_failed:'Could not send the email — try again',
  wrong_code:'Wrong code — check your Gmail',code_expired:'Code expired — tap Log in again for a new one',
  account_disabled:'This account has been disabled'};
const _trustKey=u=>'bharatapp_trust_'+u;
function _getTrust(u){ try{ return localStorage.getItem(_trustKey(u))||''; }catch(e){ return ''; } }
function _setTrust(u,t){ try{ localStorage.setItem(_trustKey(u),t); }catch(e){} }
let _lgKeys=null; // {u,pass,keys,verifier} — so the code step doesn't redo the slow key maths
async function lgLogin(){
  const u=_lgUser(), pass=$('lg-pass').value, code=($('lg-code').value||'').trim();
  if(!/^[a-z0-9_]{3,30}$/.test(u)){lgMsg('Enter your @username');return;}
  if(!pass){lgMsg('Enter your password');return;}
  const codeStep=!$('lg-step2').classList.contains('hide');
  if(codeStep && !/^\d{6}$/.test(code)){lgMsg('Enter the 6-digit code from your Gmail');return;}
  const go=$('lg-go'); go.disabled=true; lgMsg('Signing in…');
  try{
    if(!_lgKeys||_lgKeys.u!==u||_lgKeys.pass!==pass){
      // the server only gives out the password salt to a browser it trusts,
      // or once the code from the account's Gmail is entered
      let rs;
      try{ rs=await api('recover_salt',{username:u,trust:_getTrust(u),code:codeStep?code:''}); }
      catch(e){ lgMsg(e.message==='no_recovery'?LOGIN_ERR.wrong_password:(LOGIN_ERR[e.message]||'Could not log in — check your internet')); return; }
      if(rs.need_code){
        $('lg-hint').textContent=rs.email_hint||'your Gmail';
        $('lg-step2').classList.remove('hide'); $('lg-code').focus();
        lgMsg(''); return;
      }
      // the key was made with the username the account had at sign-up
      const keyUser=rs.key_username||u;
      const keys=await keyFromPassword(keyUser,pass,rs.salt);
      const verifier=await verifierFor(keyUser,pass,rs.salt);
      _lgKeys={u,pass,keys,verifier};
    }
    const dev=(navigator.userAgentData?.platform||navigator.platform||'Browser')+' · web';
    const r=await api('login_password',{username:u,verifier:_lgKeys.verifier,device:dev,
      trust:_getTrust(u),code:codeStep?code:''});
    if(r.need_code){
      $('lg-hint').textContent=r.email_hint||'your Gmail';
      $('lg-step2').classList.remove('hide'); $('lg-code').focus();
      lgMsg(''); return;
    }
    if(r.trust)_setTrust(u,r.trust);
    const keys=_lgKeys.keys; _lgKeys=null;
    const ident=seedIdentity(r.name||u,{kalId:r.kal_id,username:r.username,token:r.token,pub:keys.pub,priv:keys.priv});
    ident.device=true; save();
    // go straight into the app; tidy the form only once it's out of sight
    lgMsg('');
    showApp();
    $('lg-pass').value=''; $('lg-code').value=''; $('lg-step2').classList.add('hide');
    loadContactsAfterLogin().then(()=>{ if(typeof renderAll==='function')renderAll(); });
  }catch(e){ lgMsg(LOGIN_ERR[e.message]||'Could not log in — check your internet'); }
  finally{ go.disabled=false; }
}
/* ---- forgot password: @username + Gmail → code → new password. The key
   comes from the password, so a new one is made; other devices sign out. ---- */
function showForgot(){
  $('ob-login').classList.add('hide'); $('ob-forgot').classList.remove('hide');
  $('fp-user').value=$('lg-user').value; $('fp-step2').classList.add('hide');
  $('fp-go').textContent='Send code'; fpMsg('');
  setTimeout(()=>($('fp-user').value?$('fp-email'):$('fp-user')).focus(),200);
}
function fpMsg(t){ $('fp-msg').textContent=t||''; }
const FP_ERR={no_match:"That @username and Gmail don't match an account",bad_email:'Enter the Gmail of your account',
  bad_username:'Enter your @username',...LOGIN_ERR,code_expired:'Code expired — clear the code and tap Send code again'};
async function fpGo(){
  const u=($('fp-user').value||'').trim().replace(/^@/,'').toLowerCase(), email=($('fp-email').value||'').trim().toLowerCase();
  if(!/^[a-z0-9_]{3,30}$/.test(u)){fpMsg('Enter your @username');return;}
  if(!email.includes('@')){fpMsg('Enter the Gmail of your account');return;}
  const step2=!$('fp-step2').classList.contains('hide'), code=($('fp-code').value||'').trim();
  const go=$('fp-go'); go.disabled=true;
  try{
    if(!step2||!code){
      fpMsg('Sending…');
      await api('login_otp_send',{username:u,email});
      $('fp-step2').classList.remove('hide'); go.textContent='Set new password';
      fpMsg(''); $('fp-code').focus(); return;
    }
    const pass=$('fp-pass').value;
    if(!/^\d{6}$/.test(code)){fpMsg('Enter the 6-digit code from your Gmail');return;}
    if(pass.length<8){fpMsg('Use 8 or more characters for the new password');return;}
    if(pass!==$('fp-pass2').value){fpMsg('The two passwords are different');return;}
    fpMsg('Setting your new password…');
    const salt=newSalt(), keys=await keyFromPassword(u,pass,salt), verifier=await verifierFor(u,pass,salt);
    const dev=(navigator.userAgentData?.platform||navigator.platform||'Browser')+' · web';
    const r=await api('password_reset',{username:u,email,code,verifier,salt,pubkey:keys.pub,device:dev});
    if(r.trust)_setTrust(u,r.trust);
    const ident=seedIdentity(r.name||u,{kalId:r.kal_id,username:r.username,token:r.token,pub:keys.pub,priv:keys.priv});
    ident.device=true; save();
    fpMsg(''); showApp(); toast('Password changed — you\'re logged in');
    for(const id of ['fp-code','fp-pass','fp-pass2'])$(id).value='';
    loadContactsAfterLogin().then(()=>{ if(typeof renderAll==='function')renderAll(); });
  }catch(e){ fpMsg(FP_ERR[e.message]||'Something went wrong — check your internet'); }
  finally{ go.disabled=false; }
}
/* bring in everyone this account is connected with, so the chat list isn't empty */
async function loadContactsAfterLogin(){
  if(DESK)return;   // the support desk lists people as they write in
  try{
    const st=await api('contacts_state',authBody());
    for(const id of st.accepted||[]){ try{ await connectReal(id); }catch(e){} }
  }catch(e){}
}

function showApp(){
  document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
  $('scr-main').classList.add('on');
  renderAll();
  startPoll();
  if(typeof refreshRequests==='function')refreshRequests();
  if(typeof askNotifyPermission==='function')askNotifyPermission();
  if(typeof registerFCM==='function')registerFCM();
  // signed up from an invite link → offer to connect now
  if(window._pendingInvite&&me()?.token){ const u=window._pendingInvite; window._pendingInvite=null; setTimeout(()=>showInvite(u),400); }
}

/* ---- home page: demo phone slideshow (admin screenshots, else built-in screens) ---- */
(function(){
  const box=document.getElementById('lp-slides'); if(!box)return;
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i=0;
  function tick(){
    const s=box.querySelectorAll('.lp-slide'); if(s.length<2)return;
    s[i%s.length].classList.remove('on'); i++; s[i%s.length].classList.add('on');
  }
  if(!reduce) setInterval(tick,2000);
  api('slides',{}).then(r=>{
    const list=(r&&r.slides)||[]; if(!list.length)return;
    box.innerHTML=list.map((u,k)=>'<div class="lp-slide'+(k?'':' on')+'"><img src="'+esc(u)+'" alt=""></div>').join('');
    i=0;
  }).catch(()=>{});
  // the row of floating phones loops: repeat it once so the scroll is seamless
  const t=document.querySelector('.lp-float-track');
  if(t&&!reduce) t.innerHTML+=t.innerHTML;
})();
