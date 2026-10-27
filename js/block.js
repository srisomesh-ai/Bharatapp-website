/* ============ BharatApp Chat block / unblock ============ */
function isBlocked(kalId){ return (S.blocked||[]).includes(kalId); }
async function blockContact(cid){
  const c=contact(cid); if(!c)return;
  if(!await kConfirm({title:'Block '+handleOf(c)+'?',message:"They won't be able to message you, and you won't see their messages or status.",okText:'Block',danger:true}))return;
  S.blocked=S.blocked||[];
  if(!S.blocked.includes(c.kalId))S.blocked.push(c.kalId);
  save();
  if(c.real&&me().token){ try{ await api('block',{...authBody(),kal_id:c.kalId}); }catch(e){} }
  toast(handleOf(c)+' blocked');
  closeSheets(); if(curChat===cid)closeChat(); renderChats();
}
async function unblockContact(kalId){
  S.blocked=(S.blocked||[]).filter(x=>x!==kalId);
  save();
  if(me().token){ try{ await api('unblock',{...authBody(),kal_id:kalId}); }catch(e){} }
  toast('Unblocked');
  renderBlockedList();
}
function renderBlockedList(){
  const card=$('blocked-card'); if(!card)return;
  const list=(S.blocked||[]);
  if(!list.length){ card.innerHTML='<div class="ps" style="padding:12px 15px">No blocked users.</div>'; return; }
  card.innerHTML=list.map(kid=>{
    const c=D().contacts.find(x=>x.kalId===kid);
    const label=c?handleOf(c):kid;
    return `<div class="prow"><span class="k">${esc(label)}</span>
      <button class="btn ghost" style="width:auto;padding:6px 12px;font-size:13px" onclick="unblockContact('${kid}')">Unblock</button></div>`;
  }).join('');
}
