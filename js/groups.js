/* ============ BharatApp Chat groups (server-relayed) ============ */

function openNewGroup(){
  const reals=D().contacts.filter(c=>c.real&&!isBlocked(c.kalId));
  $('newgroup-body').innerHTML=`
    <h2>New group</h2>
    <p class="sub">Pick members from your contacts. Group messages are relayed to each member.</p>
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
    const g={id:uid(),name,kalId:r.gid,isGroup:true,members:r.members,
             memberNames:Object.fromEntries(memberContacts.map(c=>[c.kalId,c.name])),
             color:COLORS[Math.floor(Math.random()*COLORS.length)],real:true};
    g.memberNames[me().kalId]='You';
    D().contacts.push(g); chat(g.id); save();
    closeSheets(); toast('Group created ✅');
    switchTab(document.querySelector('.tab[data-pane="pane-chats"]')); openChat(g.id);
  }catch(e){ toast('Could not create group'); }
}

// group send: encrypt per member is heavy; server-relayed simple = one shared blob via group_send
async function netSendGroup(g,m,fwd){
  // For simple relay groups we encrypt with a per-group symmetric key stored locally and shared at creation.
  // v1 simplification: send base64 JSON blob (transport still HTTPS); flagged for E2E upgrade later.
  const body={kind:m.kind,text:m.text,img:m.img||null,audio:m.audio||null,wave:m.wave||null,dur:m.dur||0,
              cid:m.id,ts:m.ts,gid:g.kalId,gname:g.name,fromName:me().name,fromKal:me().kalId};
  const blob=btoa(unescape(encodeURIComponent(JSON.stringify(body))));
  await api('group_send',{...authBody(),gid:g.kalId,iv:'grp',blob,client_id:m.id,...(fwd||{})});
}

function groupMsgLabel(g){ return g.members?`${g.members.length} members`:'Group'; }
