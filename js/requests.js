/* ============ BharatApp Chat contact requests (Instagram-style) ============ */
let _reqIn=[];       // incoming pending requests
let _acceptedKal=[]; // accepted contact kal_ids
let _pendingOut=[];  // requests I sent, awaiting their accept

async function refreshRequests(){
  if(!me()?.token)return;
  try{
    const prevCount=_reqIn.length;
    const r=await api('req_list',authBody());
    _reqIn=r.requests||[];
    const st=await api('contacts_state',authBody());
    _acceptedKal=st.accepted||[]; _pendingOut=st.pending_out||[];
    // BharatApp Chat Support is always in the chat list
    if(st.support&&st.support!==me().kalId&&!D().contacts.some(c=>c.kalId===st.support)){ try{ await connectReal(st.support); }catch(e){} }
    updateReqBadge();
    // notify on a newly arrived request
    if(_reqIn.length>prevCount && prevCount>=0 && window._reqReady){
      const latest=_reqIn[0];
      toast('👋 New contact request from @'+(latest.username||latest.name||''));
      if(typeof notifyIncoming==='function')notifyIncoming('New contact request','@'+(latest.username||latest.name||'')+' wants to connect');
    }
    window._reqReady=true;
    if($('pane-connect')?.classList.contains('on'))renderRequestsInbox();
    renderChats();
  }catch(e){}
}
function updateReqBadge(){
  const b=$('req-badge'); if(!b)return;
  if(_reqIn.length){ b.textContent=_reqIn.length; b.classList.remove('hide'); }
  else b.classList.add('hide');
}
function isAccepted(kalId){ return _acceptedKal.includes(kalId); }
function isPendingOut(kalId){ return _pendingOut.includes(kalId); }

// send a contact request instead of instantly connecting
async function sendRequest(handle){
  if(!me()?.token){toast('Sign up first to connect');return null;}
  const {user}=await api('lookup',{handle});
  const r=await api('req_send',{...authBody(),to:user.kal_id});
  // store contact locally as pending/accepted
  let c=D().contacts.find(x=>x.kalId===user.kal_id);
  if(!c){
    c={id:uid(),name:user.name,username:user.username||'',kalId:user.kal_id,
       color:COLORS[Math.floor(Math.random()*COLORS.length)],real:true,pubkey:user.pubkey};
    D().contacts.push(c); chat(c.id); save();
  }
  if(r.auto_accepted||r.already==='accepted'){ _acceptedKal.push(user.kal_id); toast('Connected with '+handleOf(c)+' ✅'); }
  else if(r.already==='pending'||r.sent){ _pendingOut.push(user.kal_id); toast('Request sent to '+handleOf(c)+' — waiting for accept'); }
  save();
  return c;
}

function renderRequestsInbox(){
  const box=$('req-inbox'); if(!box)return;
  if(!_reqIn.length){ box.innerHTML=''; return; }
  box.innerHTML=`<h3>Contact requests (${_reqIn.length})</h3>`+_reqIn.map(r=>`
    <div class="req-row">
      <div class="avatar" style="background:#7FA8F5">${esc((r.name||'?').slice(0,2).toUpperCase())}</div>
      <div class="req-mid"><div class="req-name">${esc(r.name||'')}</div>
        <div class="req-handle">@${esc(r.username||'')}</div></div>
      <div class="req-acts">
        <button class="btn" style="width:auto;padding:8px 14px;font-size:13px" onclick="actRequest('${r.from_id}','accept')">Accept</button>
        <button class="btn ghost" style="width:auto;padding:8px 12px;font-size:13px" onclick="actRequest('${r.from_id}','reject')">Reject</button>
      </div>
    </div>`).join('');
}
async function actRequest(fromKal,act){
  try{
    await api('req_act',{...authBody(),from:fromKal,act});
    _reqIn=_reqIn.filter(r=>r.from_id!==fromKal);
    if(act==='accept'){
      _acceptedKal.push(fromKal);
      // ensure a contact exists locally
      if(!D().contacts.find(x=>x.kalId===fromKal)){
        try{ const {user}=await api('lookup',{handle:fromKal});
          D().contacts.push({id:uid(),name:user.name,username:user.username||'',kalId:fromKal,
            color:COLORS[Math.floor(Math.random()*COLORS.length)],real:true,pubkey:user.pubkey});
          save();
        }catch(e){}
      }
      toast('Request accepted ✅');
    }else toast('Request rejected');
    updateReqBadge(); renderRequestsInbox(); renderConnect(); renderChats();
  }catch(e){ toast('Could not update request'); }
}
