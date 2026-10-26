/* ============ Kalisi in-app notifications: sound + vibration ============ */

/* Short pleasant "ding" via WebAudio (no asset file needed) */
let _audioCtx=null;
function playDing(){
  if(!(S?.set?.sound!==false))return;         // respect sound setting
  try{
    _audioCtx=_audioCtx||new (window.AudioContext||window.webkitAudioContext)();
    const ctx=_audioCtx;
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type='sine'; o.frequency.setValueAtTime(880,ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1320,ctx.currentTime+0.08);
    g.gain.setValueAtTime(0.0001,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25,ctx.currentTime+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.35);
    o.start(); o.stop(ctx.currentTime+0.36);
  }catch(e){}
}
function buzz(pattern){
  if(!(S?.set?.vibrate!==false))return;        // respect vibrate setting
  try{ if(navigator.vibrate)navigator.vibrate(pattern||[30,40,30]); }catch(e){}
  // native app can vibrate more reliably
  try{ if(window.KalisiVibrate)window.KalisiVibrate.postMessage(String((pattern||[30,40,30]).join(','))); }catch(e){}
}

/* Called when a new incoming message arrives (from poll) */
function notifyIncoming(c,m){
  // don't notify for the chat you're actively viewing
  if(curChat===c.id && document.visibilityState==='visible')return;
  playDing();
  buzz([30,40,30]);
  // browser notification (web, when tab not focused)
  try{
    if(document.hidden && 'Notification' in window && Notification.permission==='granted'){
      const body = m.kind==='text' ? m.text
                 : (m.kind==='voice'?'🎙 Voice message':(m.kind==='img'?'🖼 Photo':'New message'));
      const n=new Notification((c.name||'Kalisi'), {body, icon:'/icon-192.png', tag:c.id});
      n.onclick=()=>{ window.focus(); openChat(c.id); n.close(); };
    }
  }catch(e){}
}

/* Ask for web notification permission once (after first interaction) */
function askNotifyPermission(){
  try{
    if('Notification' in window && Notification.permission==='default'){
      Notification.requestPermission();
    }
  }catch(e){}
}
