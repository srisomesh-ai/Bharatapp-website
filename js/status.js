/* ============ BharatApp Chat status (24h stories) ============ */
let _statusFeed=[];

function openStatusTab(){
  renderStatusList();
  refreshStatus();
}
async function refreshStatus(){
  if(!me()?.token)return;
  const contacts=D().contacts.filter(c=>c.real).map(c=>c.kalId);
  try{
    const r=await api('status_feed',{...authBody(),contacts});
    _statusFeed=r.status||[];
    renderStatusList();
  }catch(e){}
}
function groupStatus(){
  const byUser={};
  for(const s of _statusFeed){
    (byUser[s.kal_id]=byUser[s.kal_id]||{user:s,items:[]}).items.push(s);
  }
  return byUser;
}
function renderStatusList(){
  const body=$('status-body'); if(!body)return;
  const mine=me().kalId;
  const grouped=groupStatus();
  const mineItems=grouped[mine];
  let html=`
    <div class="status-mine">
      <div class="st-ring ${mineItems?'has':''}" onclick="${mineItems?'openMyStatus()':'openMyStatusCompose()'}">${avatarHTML(me(),'')}</div>
      <div class="st-mid" onclick="${mineItems?'openMyStatus()':'openMyStatusCompose()'}"><div class="st-name">My status</div>
        <div class="st-sub">${mineItems?mineItems.items.length+' update'+(mineItems.items.length>1?'s':'')+' · tap to view':'Tap to add status'}</div></div>
      <button class="icon-btn" onclick="openMyStatusCompose()">＋</button>
    </div>`;
  const others=Object.values(grouped).filter(g=>g.user.kal_id!==mine);
  if(others.length){
    html+='<h3>Recent updates</h3>';
    for(const g of others){
      const c=D().contacts.find(x=>x.kalId===g.user.kal_id);
      const nm=c?handleOf(c):('@'+(g.user.username||g.user.name));
      html+=`<div class="status-row" onclick="viewStatus('${g.user.kal_id}')">
        <div class="st-ring has">${avatarHTML(c||{name:g.user.name,color:'#7FA8F5'},'')}</div>
        <div class="st-mid"><div class="st-name">${esc(c?c.name:g.user.name)}</div>
          <div class="st-sub">${g.items.length} update${g.items.length>1?'s':''} · ${timeAgo(g.items[0].ts)}</div></div>
      </div>`;
    }
  }else{
    html+='<div class="empty" style="padding:34px 20px"><b>No status updates yet</b><br>When your contacts post, they appear here for 24 hours.</div>';
  }
  body.innerHTML=html;
}
function timeAgo(ts){ const s=(Date.now()-ts)/1000; if(s<60)return 'just now'; if(s<3600)return Math.floor(s/60)+'m ago'; if(s<86400)return Math.floor(s/3600)+'h ago'; return Math.floor(s/86400)+'d ago'; }

function openMyStatus(){
  const grouped=groupStatus();
  const g=grouped[me().kalId];
  if(!g){ openMyStatusCompose(); return; }
  const items=[...g.items].reverse();
  let idx=0;
  const render=()=>{
    const it=items[idx];
    let media='';
    if(it.type==='text')media=`<div class="sv-text">${esc(it.payload)}</div>`;
    else if(it.type==='photo')media=`<img class="sv-img" src="${it.payload}">`;
    else if(it.type==='voice')media=`<div class="sv-voice"><button class="voice-play" onclick="new Audio('${it.payload}').play()">▶ Play voice</button></div>`;
    $('status-view-body').innerHTML=`
      <div class="sv-bars">${items.map((_,i)=>`<span class="${i<=idx?'on':''}"></span>`).join('')}</div>
      <div class="sv-head">${avatarHTML(me(),'small')}<div><div class="sv-name">My status</div>
        <div class="sv-time">${timeAgo(it.ts)}</div></div>
        <button class="icon-btn" onclick="closeSheets()" style="margin-left:auto">✕</button></div>
      <div class="sv-media" onclick="myStatusNext()">${media}</div>
      <div class="sv-foot">
        <button class="sv-viewers" onclick="showViewers(${it.id})">👁 ${it.views||0} view${(it.views||0)===1?'':'s'}</button>
        <button class="sv-del" onclick="deleteStatus(${it.id})">🗑 Delete</button>
      </div>`;
  };
  window.myStatusNext=()=>{ idx++; if(idx>=items.length){closeSheets();return;} render(); };
  render();
  openSheet('sheet-status-view');
  statusViewerOpened();
}
async function showViewers(sid){
  try{
    const r=await api('status_viewers',{...authBody(),status_id:sid});
    const list=r.viewers||[];
    const likes=list.filter(v=>v.emoji).length;
    const when=ms=>{ if(!ms)return ''; const t=new Date(+ms), n=new Date();
      const d0=new Date(t.getFullYear(),t.getMonth(),t.getDate()), n0=new Date(n.getFullYear(),n.getMonth(),n.getDate());
      const clock=t.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}).toLowerCase();
      const days=Math.round((n0-d0)/86400000);
      return (days===0?'Today':days===1?'Yesterday':t.toLocaleDateString())+', '+clock; };
    $('status-compose-body').innerHTML=`<h2 style="display:flex;align-items:center;gap:10px">Viewed by ${list.length}${likes?`<span style="margin-left:auto;font-size:13.5px;color:#E5484D;background:rgba(229,72,77,.12);padding:4px 10px;border-radius:99px">❤ ${likes}</span>`:''}</h2>`+
      (list.length?list.map(v=>`<div style="display:flex;align-items:center;gap:12px;padding:9px 2px">
          <div style="position:relative">${v.avatar?`<img src="${esc(v.avatar)}" style="width:42px;height:42px;border-radius:50%;object-fit:cover">`:avatarHTML({name:v.name||v.username||'?',color:'#7FA8F5'},'')}${v.emoji?`<span style="position:absolute;right:-5px;bottom:-5px;font-size:14px;background:var(--panel);border-radius:50%;padding:1px 2px">${esc(v.emoji)}</span>`:''}</div>
          <div style="min-width:0"><div style="font-weight:600">${esc(v.name||'@'+(v.username||''))}</div><div class="muted" style="font-size:13px">${when(v.at)}</div></div></div>`).join('')
        :'<div class="ps" style="padding:14px">No views yet.</div>');
    openSheet('sheet-status-compose');
  }catch(e){ toast('Could not load viewers'); }
}
async function deleteStatus(sid){
  if(!await kConfirm({title:'Delete status?',message:'This removes your status update for everyone.',okText:'Delete',danger:true}))return;
  try{ await api('status_delete',{...authBody(),status_id:sid});
    toast('Status deleted'); closeSheets(); refreshStatus();
  }catch(e){ toast('Could not delete'); }
}
function openMyStatusCompose(){
  $('status-compose-body').innerHTML=`
    <h2>Add to my status</h2>
    <p class="sub">Visible to your contacts for 24 hours, then it disappears.</p>
    <textarea id="st-text" placeholder="Type a status update…" rows="3" style="width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px;color:var(--text);resize:none;margin-bottom:12px"></textarea>
    <label class="st-share-opt"><input type="checkbox" id="st-allow-share"> Allow contacts to share this status</label>
    <div class="st-actions">
      <button class="btn ghost" onclick="document.getElementById('st-photo').click()">🖼 Photo</button>
      <button class="btn ghost" id="st-voice-btn" onclick="toggleStatusVoice()">🎙 Voice</button>
      <button class="btn" onclick="postTextStatus()">Post</button>
    </div>
    <div id="st-voice-status" class="qr-sub" style="margin-top:10px"></div>
    <input type="file" id="st-photo" accept="image/*" class="hide" onchange="postPhotoStatus(this)">`;
  openSheet('sheet-status-compose');
}
async function postTextStatus(){
  const t=$('st-text').value.trim();
  if(!t){toast('Type something first');return;}
  await postStatus('text',t);
}
async function postPhotoStatus(input){
  const f=input.files[0]; input.value=''; if(!f)return;
  const img=new Image(); const rd=new FileReader();
  rd.onload=()=>{ img.onload=async()=>{
    const mx=1000,k=Math.min(1,mx/Math.max(img.width,img.height));
    const cv=document.createElement('canvas'); cv.width=img.width*k; cv.height=img.height*k;
    cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
    await postStatus('photo',cv.toDataURL('image/jpeg',.75));
  }; img.src=rd.result; };
  rd.readAsDataURL(f);
}
let _stRec=null,_stChunks=[];
async function toggleStatusVoice(){
  if(_stRec&&_stRec.state==='recording'){
    const done=new Promise(r=>{_stRec.onstop=()=>r();});
    _stRec.stop(); await done;
    const blob=new Blob(_stChunks,{type:_stRec.mimeType||'audio/webm'});
    const b64=await blobToB64(blob);
    _stRec=null;
    await postStatus('voice',b64);
    return;
  }
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    _stRec=new MediaRecorder(stream); _stChunks=[];
    _stRec.ondataavailable=e=>{if(e.data.size)_stChunks.push(e.data);};
    _stRec.onstop=()=>stream.getTracks().forEach(t=>t.stop());
    _stRec.start();
    $('st-voice-status').textContent='🔴 Recording… tap 🎙 Voice again to stop & post';
    $('st-voice-btn').textContent='⏹ Stop';
  }catch(e){ toast('Mic permission needed'); }
}
async function postStatus(type,payload){
  if(!me()?.token){ toast('Only real accounts can post status'); return; }
  const allow_share=$('st-allow-share')?.checked?1:0;
  try{
    await api('status_post',{...authBody(),type,payload,allow_share});
    toast('Status posted ✅');
    closeSheets(); refreshStatus();
  }catch(e){ toast('Could not post status'); }
}

function viewStatus(kalId){
  const grouped=groupStatus();
  const g=grouped[kalId]; if(!g)return;
  const items=[...g.items].reverse(); // oldest first
  let idx=0;
  const c=D().contacts.find(x=>x.kalId===kalId);
  const nm=c?c.name:g.user.name;
  const render=()=>{
    const it=items[idx];
    let media='';
    if(it.type==='text')media=`<div class="sv-text">${esc(it.payload)}</div>`;
    else if(it.type==='photo')media=`<img class="sv-img" src="${it.payload}">`;
    else if(it.type==='voice')media=`<div class="sv-voice"><button class="voice-play" onclick="new Audio('${it.payload}').play()">▶ Play voice</button></div>`;
    if(it.id&&me().token){ api('status_view',{...authBody(),status_id:it.id}).catch(()=>{}); }
    $('status-view-body').innerHTML=`
      <div class="sv-bars">${items.map((_,i)=>`<span class="${i<=idx?'on':''}"></span>`).join('')}</div>
      <div class="sv-head">${avatarHTML(c||{name:nm,color:'#7FA8F5'},'small')}<div><div class="sv-name">${esc(nm)}</div><div class="sv-time">${timeAgo(it.ts)}</div></div>
        <button class="icon-btn" onclick="closeSheets()" style="margin-left:auto">✕</button></div>
      <div class="sv-media" onclick="statusNext()">${media}</div>
      <div class="sv-actions">
        <button class="sv-act" id="sv-like" onclick="reactStatus(${it.id})">🤍 <span id="sv-like-c"></span></button>
        <button class="sv-act" onclick="replyToStatus('${it.kal_id}',${JSON.stringify(JSON.stringify(previewOf(it)))})">↩ Reply</button>
        ${it.allow_share?`<button class="sv-act" onclick="shareStatus(${it.id})">↗ Share</button>`:''}
      </div>`;
    loadReactions(it.id);
  };
  window.statusNext=()=>{ idx++; if(idx>=items.length){closeSheets();return;} render(); };
  render();
  openSheet('sheet-status-view');
}

/* ---- status social: react, reply, share ---- */
function previewOf(it){ return it.type==='text'?it.payload.slice(0,60):(it.type==='photo'?'📷 Photo status':'🎙 Voice status'); }
async function loadReactions(sid){
  if(!sid||!me()?.token)return;
  try{ const r=await api('status_reactions',{...authBody(),status_id:sid});
    const b=$('sv-like'); if(!b)return;
    b.innerHTML=(r.mine?'❤':'🤍')+' <span id="sv-like-c">'+(r.count||'')+'</span>';
    b.dataset.on=r.mine?'1':'';
  }catch(e){}
}
async function reactStatus(sid){
  if(!me()?.token){toast('Sign up to react');return;}
  try{ await api('status_react',{...authBody(),status_id:sid,emoji:'❤'}); loadReactions(sid); }catch(e){}
}
function replyToStatus(kalId,previewJson){
  let preview=''; try{ preview=JSON.parse(previewJson);}catch(e){}
  const c=D().contacts.find(x=>x.kalId===kalId);
  if(!c){ toast('Add this contact first'); return; }
  closeSheets();
  switchTab(document.querySelector('.tab[data-pane="pane-chats"]'));
  openChat(c.id);
  setTimeout(()=>{ const inp=$('msg-in'); if(inp){ inp.value='Re: '+preview+'\n'; inp.focus();
    inp.dispatchEvent(new Event('input')); } },250);
}
async function shareStatus(sid){
  const all=_statusFeed.find(s=>s.id===sid); if(!all){toast('Cannot share');return;}
  if(!all.allow_share){toast('The poster disabled sharing');return;}
  // re-post to own status
  if(!await kConfirm({title:'Share to your status?',message:'This re-posts it to your own status.',okText:'Share'}))return;
  postStatus(all.type, all.payload);
}
