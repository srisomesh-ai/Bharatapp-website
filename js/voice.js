/* ============ BharatApp Chat voice messages ============ */
let _rec=null, _recChunks=[], _recStart=0, _recTimer=null;

async function startRec(){
  if(!curChat)return;
  if(!navigator.mediaDevices?.getUserMedia){ toast('Mic not supported in this browser'); return; }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    _rec=new MediaRecorder(stream);
    _recChunks=[];
    _rec.ondataavailable=e=>{ if(e.data.size)_recChunks.push(e.data); };
    _rec.onstop=()=>stream.getTracks().forEach(t=>t.stop());
    _rec.start();
    _recStart=Date.now();
    $('composer-main').classList.add('hide');
    $('rec-bar').classList.add('on');
    _recTimer=setInterval(()=>{ const s=Math.floor((Date.now()-_recStart)/1000);
      $('rec-time').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; },200);
  }catch(e){ toast('Microphone permission needed'); }
}
function cancelRec(){
  if(_rec&&_rec.state!=='inactive')_rec.stop();
  clearInterval(_recTimer); _rec=null; _recChunks=[];
  $('rec-bar').classList.remove('on'); $('composer-main').classList.remove('hide');
}
async function stopRecSend(){
  if(!_rec){ cancelRec(); return; }
  const dur=Math.round((Date.now()-_recStart)/1000);
  const done=new Promise(res=>{ _rec.onstop=()=>res(); });
  _rec.stop(); clearInterval(_recTimer);
  await done;
  $('rec-bar').classList.remove('on'); $('composer-main').classList.remove('hide');
  if(!_recChunks.length||dur<1){ toast('Too short'); _rec=null; return; }
  const blob=new Blob(_recChunks,{type:_rec.mimeType||'audio/webm'});
  _rec=null;
  const b64=await blobToB64(blob);
  // rough waveform: sample sizes for visual bars
  const bars=makeWave(_recChunks.length);
  pushMine({kind:'voice',audio:b64,dur,wave:bars,text:''});
}
function blobToB64(blob){ return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(blob); }); }
function makeWave(seed){ const n=24,a=[]; for(let i=0;i<n;i++)a.push(3+Math.round(Math.abs(Math.sin(i*1.7+seed))*17)); return a; }

function voiceBubbleHTML(m){
  const wave=(m.wave||makeWave(3)).map(h=>`<i style="height:${h}px"></i>`).join('');
  const mm=Math.floor((m.dur||0)/60), ss=(m.dur||0)%60;
  return `<div class="voice-bub">
    <button class="voice-play" onclick="playVoice('${m.id}',this)">▶</button>
    <div class="voice-wave" data-wave="${m.id}">${wave}</div>
    <span class="voice-time">${mm}:${String(ss).padStart(2,'0')}</span>
  </div>`;
}
let _curAudio=null;
function playVoice(mid,btn){
  const ch=chat(curChat); const m=ch.msgs.find(x=>x.id===mid); if(!m||!m.audio)return;
  if(_curAudio){ _curAudio.pause(); _curAudio=null; document.querySelectorAll('.voice-play').forEach(b=>b.textContent='▶'); }
  const a=new Audio(m.audio); _curAudio=a;
  btn.textContent='⏸';
  const bars=document.querySelectorAll(`[data-wave="${mid}"] i`);
  a.ontimeupdate=()=>{ const p=a.currentTime/(a.duration||m.dur||1); const k=Math.floor(p*bars.length);
    bars.forEach((b,i)=>b.classList.toggle('on',i<=k)); };
  a.onended=()=>{ btn.textContent='▶'; bars.forEach(b=>b.classList.remove('on')); _curAudio=null;
    if(m.burn&&m.from==='them'&&!m.burned){ setTimeout(()=>burnMsg(mid),400); } };
  a.play().catch(()=>toast('Playback failed'));
}
