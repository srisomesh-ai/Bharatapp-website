/* ============ Kalisi landing + entry routing ============ */

// Decide first screen: returning user with an account skips landing.
function isNativeApp(){
  return /KalisiApp/i.test(navigator.userAgent) || location.search.indexOf('app=1')>=0 || window.KalisiNative || window.KalisiBundled || location.protocol==='file:';
}
/* ---- invite links (what the QR holds): bharatapp.chat/add/<username> ---- */
const PLAY_URL='https://play.google.com/store/apps/details?id=com.messenger.app';
function inviteLink(username){ return 'https://bharatapp.chat/add/'+username; }
/* Returns true when the page was opened from an invite and handled it. */
function handleInvite(){
  const u=(new URLSearchParams(location.search).get('add')||'').toLowerCase();
  if(!/^[a-z0-9_]{3,20}$/.test(u))return false;
  history.replaceState(null,'',location.pathname);
  // Android: open the app if it's installed, otherwise the Play Store
  if(/Android/i.test(navigator.userAgent)&&!isNativeApp()){
    location.href='intent://add/'+u+'#Intent;scheme=kalisi;package=com.messenger.app;S.browser_fallback_url='+encodeURIComponent(PLAY_URL)+';end';
  }
  showInvite(u);
  return true;
}
function showInvite(u){
  const signedIn=!!(S&&S.identities&&S.identities.length&&me()?.token);
  kConfirm({title:'Chat with @'+u+' on Kalisi',
    message:signedIn?'Send @'+u+' a contact request? You can chat once they accept.'
                    :'Get the Kalisi app to connect with @'+u+', or create an account here in your browser.',
    okText:signedIn?'Connect':'Get it on Google Play', cancelText:signedIn?'Not now':'Use in browser'})
  .then(async ok=>{
    if(!signedIn){ if(ok){ location.href=PLAY_URL; } else { window._pendingInvite=u; landStart(); } return; }
    if(!ok)return;
    try{ const c=await connectReal(u); await api('req_send',{...authBody(),to:c.kalId}); toast('Request sent to @'+u); }
    catch(e){ toast(e.message==='not_found'?'No user found with @'+u:'Could not connect'); }
  });
}
function bootRoute(){
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

function landStart(){
  // go to onboarding (create account)
  document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
  $('scr-onboard').classList.add('on');
  $('ob-step1').classList.remove('hide');
  $('ob-step2').classList.add('hide');
  $('ob-login').classList.add('hide');
  setTimeout(()=>$('ob-name')?.focus(),200);
}

function landRestore(){ showLogin(); }

/* ---- log in: @username + Gmail must match → code by email → password ---- */
function showLogin(){
  document.querySelectorAll('.scr').forEach(x=>x.classList.remove('on'));
  $('scr-onboard').classList.add('on');
  $('ob-step1').classList.add('hide'); $('ob-step2').classList.add('hide');
  $('ob-login').classList.remove('hide');
  setTimeout(()=>$('lg-user')?.focus(),200);
}
const _lgUser=()=>($('lg-user').value||'').trim().replace(/^@/,'').toLowerCase();
const _lgEmail=()=>($('lg-email').value||'').trim();
function lgMsg(t){ $('lg-msg').textContent=t||''; }
const LOGIN_ERR={no_match:"That @username and Gmail don't match an account",bad_email:'Enter a valid Gmail address',
  bad_username:'Check the username',too_soon:'Wait a minute before asking for another code',
  too_many:'Too many tries — try again in an hour',email_send_failed:'Could not send the email — try again',
  wrong_code:'Wrong code — check your email',code_expired:'Code expired — tap Send code again',
  account_disabled:'This account has been disabled'};
async function lgSendCode(){
  if(!/^[a-z0-9_]{3,20}$/.test(_lgUser())){lgMsg('Enter your @username');return;}
  if(!/^[^@\s]+@(gmail|googlemail)\.com$/i.test(_lgEmail())){lgMsg('Enter your Gmail address');return;}
  const b=$('lg-send-code'); b.disabled=true; lgMsg('Sending…');
  try{
    await api('login_otp_send',{username:_lgUser(),email:_lgEmail()});
    $('lg-step2').classList.remove('hide'); $('lg-code').focus();
    lgMsg('Code sent — check your Gmail');
  }catch(e){ lgMsg(LOGIN_ERR[e.message]||'Could not send code'); }
  setTimeout(()=>{b.disabled=false;},30000);
}
async function lgLogin(){
  const u=_lgUser(), email=_lgEmail(), code=($('lg-code').value||'').trim(), pass=$('lg-pass').value;
  if(!/^\d{6}$/.test(code)){lgMsg('Enter the 6-digit code');return;}
  if(!pass){lgMsg('Enter your password');return;}
  const go=$('lg-go'); go.disabled=true; lgMsg('Checking…');
  try{
    // 1) rebuild the account key from the password and check it against the
    //    account's public key — before using up the code
    let salt;
    try{ salt=(await api('recover_salt',{username:u})).salt; }
    catch(e){ lgMsg(e.message==='no_recovery'?'This account has no password, so it can only be opened on the phone it was made on':'Could not check the account'); return; }
    const keys=await keyFromPassword(u,pass,salt);
    const {user}=await api('lookup',{handle:u});
    if(user.pubkey?.x!==keys.pub.x||user.pubkey?.y!==keys.pub.y){ lgMsg('Wrong password'); return; }
    // 2) the code logs this browser in as one more device
    const dev=(navigator.userAgentData?.platform||navigator.platform||'Browser')+' · web';
    const r=await api('login_otp_verify',{username:u,email,code,device:dev});
    const ident=seedIdentity(r.name||u,{kalId:r.kal_id,username:r.username,token:r.token,pub:keys.pub,priv:keys.priv},false);
    ident.device=true; save();
    lgMsg('');
    await loadContactsAfterLogin();
    showApp();
  }catch(e){ lgMsg(LOGIN_ERR[e.message]||'Could not log in'); }
  finally{ go.disabled=false; }
}
/* bring in everyone this account is connected with, so the chat list isn't empty */
async function loadContactsAfterLogin(){
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
  if(typeof requestNotifPermission==='function')requestNotifPermission();
  if(typeof registerFCM==='function')registerFCM();
  // signed up from an invite link → offer to connect now
  if(window._pendingInvite&&me()?.token){ const u=window._pendingInvite; window._pendingInvite=null; setTimeout(()=>showInvite(u),400); }
}
