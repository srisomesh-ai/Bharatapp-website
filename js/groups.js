/* ============ BharatApp Chat groups (server-relayed) ============ */

function openNewGroup(){
  const reals=D().contacts.filter(c=>c.real&&!isBlocked(c.kalId));
  $('newgroup-body').innerHTML=`
    <h2>New group</h2>
    <p class="sub">Pick members from your contacts. Group messages are end-to-end encrypted.</p>
    <input id="grp-name" placeholder="Group name" maxlength="40" style="width:100%;background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:12px 14px;color:var(--text);margin-bottom:14px">
    <div id="grp-members">
      ${reals.length?reals.map(c=>`
        <label class="grp-pick">
          <input type="checkbox" value="${c.id}">
          ${avatarHTML(c,'small')}
          <span class="grp-pname">${esc(c.name)} <span class="muted">${esc(handleOf(c))}</span></span>
        </label>`).join(''):'<div class="ps" style="padding:10px 4px">Add some contacts first (Connect tab).</div>'}
    </div>
    <button class="btn" style="width:100%;margin-top:14px" onclick="createGroup()">Create group</button>`;
  openSheet('sheet-newgroup');
}
async function createGroup(){
  const name=$('grp-name').value.trim();
  if(!name){toast('Name the group');return;}
  const picked=[...document.querySelectorAll('#grp-members input:checked')].map(i=>i.value);
  if(!picked.length){toast('Pick at least one member');return;}
  if(!me()?.token){toast('Only real accounts can create groups');return;}
  const memberContacts=picked.map(id=>contact(id)).filter(Boolean);
  const memberKal=memberContacts.map(c=>c.kalId);
  try{
    const r=await api('group_create',{...authBody(),name,members:memberKal});
    // store group as a special contact
    const g={id:uid(),name,kalId:r.gid,isGroup:true,members:r.members,gkey:newGroupKey(),
             memberNames:Object.fromEntries(memberContacts.map(c=>[c.kalId,c.name])),
             color:COLORS[Math.floor(Math.random()*COLORS.length)],real:true};
    g.memberNames[me().kalId]='You';
    D().contacts.push(g); chat(g.id); save();
    shareGroupKey(g,g.members).catch(()=>{});
    closeSheets(); toast('Group created ✅');
    switchTab(document.querySelector('.tab[data-pane="pane-chats"]')); openChat(g.id);
  }catch(e){ toast('Could not create group'); }
}

/* ---- group encryption (same scheme as the app): each group has one random
   AES-256 key, handed to every member over their encrypted 1:1 chat as a
   'gkey' message. Group messages are encrypted once with it; the server only
   fans out ciphertext. ---- */
function newGroupKey(){ return b64(crypto.getRandomValues(new Uint8Array(32))); }
const _gkCache={};
async function gkImport(k){ return _gkCache[k]||(_gkCache[k]=await crypto.subtle.importKey('raw',unb64(k),'AES-GCM',false,['encrypt','decrypt'])); }
async function gEncrypt(key,obj){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},await gkImport(key),new TextEncoder().encode(JSON.stringify(obj)));
  return {iv:b64(iv),blob:b64(ct)};
}
async function gDecrypt(key,iv,blob){
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(unb64(iv))},await gkImport(key),unb64(blob));
  return JSON.parse(new TextDecoder().decode(pt));
}
/* someone to encrypt for: a contact, or a fellow member looked up by KAL-ID */
async function memberPeer(kal){
  const c=D().contacts.find(x=>x.kalId===kal&&!x.isGroup&&x.pubkey);
  if(c)return c;
  try{ const {user}=await api('lookup',{handle:kal}); return user?.pubkey?{kalId:kal,pubkey:user.pubkey,name:user.name}:null; }catch(e){ return null; }
}
async function shareGroupKey(g,kals){
  for(const k of kals){
    if(k===me().kalId||(typeof isBlocked==='function'&&isBlocked(k)))continue;
    const p=await memberPeer(k); if(!p)continue;
    await netSendCtl(p,{kind:'gkey',gid:g.kalId,name:g.name,key:g.gkey,members:g.members||[],cid:uid(),ts:now()});
  }
}
/* groups made before encryption have no key yet: make one and share it */
async function ensureGroupKey(g){
  if(g.gkey)return;
  g.gkey=newGroupKey(); save();
  await shareGroupKey(g,g.members||[]);
}
async function netSendGroup(g,m,fwd){
  await ensureGroupKey(g);
  const obj={kind:m.kind,text:m.text||'',img:m.img||null,audio:m.audio||null,file:m.file||null,
    fileName:m.fileName||null,fileSize:m.fileSize||null,wave:m.wave||null,dur:m.dur||0,
    gid:g.kalId,from:me().kalId,fromName:me().name,cid:m.id,ts:m.ts};
  const enc=await gEncrypt(g.gkey,obj);
  await api('group_send',{...authBody(),gid:g.kalId,client_id:m.id,...enc,echo:1,...(fwd||{})});
}
/* a packet that opens with one of my group keys: [group, message] or null */
async function tryGroupDecrypt(pkt){
  for(const g of D().contacts){
    if(!g.isGroup||!g.gkey)continue;
    try{ return [g,await gDecrypt(g.gkey,pkt.iv,pkt.blob)]; }catch(e){}
  }
  return null;
}
/* a member couldn't read a group message: ask them (at most once a minute) to re-send keys */
const _gkAsk={};
function askGroupKeys(c){
  if(Date.now()-(_gkAsk[c.kalId]||0)<60000)return;
  _gkAsk[c.kalId]=Date.now();
  netSendCtl(c,{kind:'gkey-request',cid:uid(),ts:now()});
}
/* 'gkey' (added to a group / new key) and 'gkey-request' over a 1:1 chat */
function onGroupKey(c,body){
  if(!body.gid||!body.key)return;
  if((D().leftGroups||[]).includes(body.gid))return;      // I left it
  let g=D().contacts.find(x=>x.isGroup&&x.kalId===body.gid);
  // only a member may hand out (or replace) a group's key
  if(g&&Array.isArray(g.members)&&g.members.length&&!g.members.includes(c.kalId))return;
  const isNew=!g;
  if(!g){ g={id:uid(),name:body.name||'Group',kalId:body.gid,isGroup:true,members:[],memberNames:{},
    color:COLORS[Math.floor(Math.random()*COLORS.length)],real:true}; D().contacts.push(g); chat(g.id); }
  g.gkey=body.key; if(body.name)g.name=body.name;
  if(Array.isArray(body.members)&&body.members.length)g.members=body.members.map(String);
  g.memberNames=g.memberNames||{}; g.memberNames[c.kalId]=c.name;
  if(isNew){ const ch=chat(g.id); ch.msgs.push({id:uid(),from:'them',kind:'text',senderName:c.name,text:'added you to this group',ts:now(),status:'read'});
    ch.unread=(ch.unread||0)+1; }
  save(); renderChats();
}
async function onGroupKeyRequest(c){
  for(const g of D().contacts){
    if(g.isGroup&&g.gkey&&(g.members||[]).includes(c.kalId))
      await netSendCtl(c,{kind:'gkey',gid:g.kalId,name:g.name,key:g.gkey,members:g.members||[],cid:uid(),ts:now()});
  }
}

function groupMsgLabel(g){ return g.members?`${g.members.length} members`:'Group'; }
