/* ============ BharatApp screenshot protection (#5) ============ */
/* In the Flutter app: signals native FLAG_SECURE (real OS-level block).
   On web: best-effort deterrents only — true blocking is impossible in a browser. */

let _secureActive=false;

function secureOn(){
  // TEMPORARILY DISABLED so screenshots can be taken for the Play Store listing.
  // To re-enable: uncomment the two lines below.
  // _secureActive=true;
  // try{ if(window.KalisiSecure) window.KalisiSecure.postMessage('on'); }catch(e){}
  return;
}
function secureOff(){
  _secureActive=false;
  try{ if(window.KalisiSecure) window.KalisiSecure.postMessage('off'); }catch(e){}
}

/* Web deterrent: when a status is open and the app loses focus or becomes hidden
   (which happens during some screenshot/switch actions), blur the content. */
function armStatusScreenshotGuard(){
  document.addEventListener('visibilitychange', _statusBlurOnHide);
  window.addEventListener('blur', _statusBlurOnHide);
}
function disarmStatusScreenshotGuard(){
  document.removeEventListener('visibilitychange', _statusBlurOnHide);
  window.removeEventListener('blur', _statusBlurOnHide);
}
function _statusBlurOnHide(){
  const v=document.getElementById('status-view-body');
  if(!v)return;
  if(document.hidden){ v.style.filter='blur(22px)'; }
  else { setTimeout(()=>{ v.style.filter=''; }, 200); }
}

/* Block long-press "save image" on status photos (web) */
function blockImageSave(scope){
  (scope||document).querySelectorAll('.sv-img, .sv-media img').forEach(img=>{
    img.addEventListener('contextmenu', e=>e.preventDefault());
    img.style.webkitTouchCallout='none';
    img.style.userSelect='none';
    img.draggable=false;
  });
}

/* Called when opening/closing any status viewer */
function statusViewerOpened(){
  secureOn();               // native: block screenshots while viewing status
  armStatusScreenshotGuard();
  setTimeout(()=>blockImageSave(document.getElementById('status-view-body')), 50);
  // show the one-time "protected" hint
  if(!localStorage.getItem('kalisi_ss_hint')){
    setTimeout(()=>toast('🔒 Status is screenshot-protected'), 300);
    localStorage.setItem('kalisi_ss_hint','1');
  }
}
function statusViewerClosed(){
  secureOff();              // native: allow screenshots elsewhere
  disarmStatusScreenshotGuard();
  const v=document.getElementById('status-view-body'); if(v)v.style.filter='';
}
