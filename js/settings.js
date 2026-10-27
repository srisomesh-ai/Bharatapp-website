/* ============ BharatApp Chat user settings ============ */
function openSettings(){
  const m=me();
  $('settings-body').innerHTML=`
    <div class="set-profile">
      ${avatarHTML(m,'')}
      <div class="set-pm">
        <div class="set-name">${esc(m.name)}</div>
        <div class="set-handle">${esc(handleOf(m))}</div>
      </div>
      <button class="icon-btn" onclick="editName()" aria-label="Edit name">✏️</button>
    </div>
    <div class="pcard">
      <div class="menu-it" onclick="changeUsernameUI()">＠ &nbsp;Change username <span class="muted" style="margin-left:auto;font-weight:400">once per 30 days</span></div>
    </div>

    <h3>Appearance</h3>
    <div class="pcard">
      <div class="prow"><span class="k">Theme</span>
        <select onchange="applyTheme(this.value);toast('Theme updated')">
          <option value="dark" ${(S.set?.theme||'dark')==='dark'?'selected':''}>Dark</option>
          <option value="light" ${(S.set?.theme)==='light'?'selected':''}>Light</option>
        </select></div>
    </div>

    <h3>Privacy</h3>
    <div class="pcard">
      <div class="prow"><span class="k">Block screenshots app-wide <span class="muted" style="font-size:11px">(app only)</span></span>${toggle('set_secureAll',S.set?.secureAll===true)}</div>
      <div class="prow"><span class="k">Read receipts</span>${toggle('set_readReceipts',S.set?.readReceipts!==false)}</div>
      <div class="prow"><span class="k">Show last seen</span>${toggle('set_lastSeen',S.set?.lastSeen!==false)}</div>
      <div class="prow"><span class="k">Who can add me by username</span>
        <select onchange="setPref('addBy',this.value)">
          <option value="all" ${(S.set?.addBy||'all')==='all'?'selected':''}>Everyone</option>
          <option value="qr" ${(S.set?.addBy)==='qr'?'selected':''}>Only via QR / invite</option>
        </select></div>
    </div>

    <h3>Chats</h3>
    <div class="pcard">
      <div class="prow"><span class="k">Enter key sends message</span>${toggle('set_enterSend',S.set?.enterSend!==false)}</div>
      <div class="prow"><span class="k">Default disappearing timer</span>
        <select onchange="setPref('defTimer',+this.value)">
          ${[[0,'Off'],[21600,'6h'],[43200,'12h'],[86400,'24h'],[604800,'7d'],[2592000,'30d']].map(([v,l])=>`<option value="${v}" ${(S.set?.defTimer||0)===v?'selected':''}>${l}</option>`).join('')}
        </select></div>
    </div>

    <h3>Notifications</h3>
    <div class="pcard">
      <div class="prow"><span class="k">Message notifications</span>${toggle('set_notif',S.set?.notif!==false)}</div>
      <div class="prow"><span class="k">Sound</span>${toggle('set_sound',S.set?.sound!==false)}</div>
      <div class="prow"><span class="k">Vibration</span>${toggle('set_vibrate',S.set?.vibrate!==false)}</div>
      <div class="ps" style="padding:8px 15px 12px">Notifications work fully in the installed app. In the browser they're limited.</div>
    </div>

    <h3>Blocked users</h3>
    <div class="pcard" id="blocked-card"></div>

    <h3>Account</h3>
    <div class="pcard">
      <div class="menu-it" onclick="openSheet('sheet-about')">ℹ️ &nbsp;About BharatApp Chat · how it works</div>
      <div class="menu-it" onclick="backupData()">🔐 &nbsp;Save encrypted backup</div>
      <div class="menu-it" onclick="restorePick()">📥 &nbsp;Restore from backup</div>
      <div class="menu-it red" onclick="logout()">🚪 &nbsp;Log out from this phone</div>
      ${me()?.token?'<div class="menu-it red" onclick="deleteAccount()">🗑 &nbsp;Delete account</div>':''}
    </div>
    <p class="qr-sub" style="text-align:center;margin:10px 0 4px">BharatApp Chat ${APP_VERSION} · BharatApp Chat by BharatApp Chat Media Private Limited<br><a href="/privacy.html" target="_blank">Privacy</a> · <a href="/terms.html" target="_blank">Terms</a></p>`;
  renderBlockedList();
  openSheet('sheet-settings');
}
function toggle(id,on){ return `<button class="tgl ${on?'on':''}" id="${id}" onclick="flipToggle('${id}')"><span></span></button>`; }
function flipToggle(id){
  const key=id.replace('set_','');
  S.set=S.set||{};
  const nowOn=!$(id).classList.contains('on');
  $(id).classList.toggle('on');
  S.set[key]=nowOn;
  save();
  if(key==='secureAll'){ if(nowOn){secureOn();toast('Screenshots blocked app-wide (in the app)');} else {secureOff();toast('App-wide block off — status stays protected');} return; }
  toast('Saved');
}

async function changeUsernameUI(){
  const cur=me().username||'';
  const nn=await kPrompt({title:'Change username',message:'4 or more letters and at least 1 number (letters, numbers, _). You can change this once every 30 days.',value:cur,placeholder:'username',okText:'Change'});
  if(!nn)return;
  const clean=nn.trim().replace(/^@/,'').toLowerCase();
  if(!/^[a-z0-9_]{5,30}$/.test(clean)||(clean.match(/[a-z]/g)||[]).length<4||!/[0-9]/.test(clean)){ toast('Use 4 or more letters and at least 1 number'); return; }
  if(clean===cur){ toast('That is already your username'); return; }
  if(!me().token){ toast('Only real accounts can change username'); return; }
  try{
    const r=await api('change_username',{...authBody(),username:clean});
    me().username=r.username; save();
    toast('Username changed to @'+r.username+' ✅');
    openSettings(); renderAll();
  }catch(e){
    const msg={too_soon:'You changed it recently — try again in '+(e.days||'a few')+' days',
      username_taken:'@'+clean+' is unavailable', bad_username:'Use 4 or more letters and at least 1 number',
      premium_username:'Letters-only names are for BharatApp Premium — add a number',
      same_username:'That is already your username'}[e.message]||'Could not change username';
    toast(msg);
  }
}
function setPref(key,val){ S.set=S.set||{}; S.set[key]=val; save(); toast('Saved'); }
async function editName(){
  const n=await kPrompt({title:'Display name',value:me().name,placeholder:'Your name',okText:'Save'});
  if(n&&n.trim()){ me().name=n.trim(); save(); openSettings(); renderAll(); }
}

/* Delete the account on the server for good (Play Store requirement). */
async function deleteAccount(){
  const m=me(); if(!m?.token)return;
  const typed=await kPrompt({title:'Delete your account?',message:'Your @username, Gmail, profile, contacts and statuses are removed from BharatApp Chat and you are logged out everywhere. This cannot be undone. Type @'+m.username+' to confirm.',placeholder:m.username,okText:'Delete',danger:true});
  if(typed==null)return;
  try{ await api('account_delete',{...authBody(),confirm:typed}); }
  catch(e){ toast(e.message==='confirm_mismatch'?'Type @'+m.username+' exactly to confirm':'Could not delete the account'); return; }
  try{ localStorage.removeItem(LS_KEY); }catch(e){}
  toast('Your account was deleted'); setTimeout(()=>location.replace('/'),900);
}
