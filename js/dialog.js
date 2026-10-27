/* ============ BharatApp Chat custom dialogs (replaces browser confirm/alert/prompt) ============ */
const _esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function _dialogEl(){
  let d=document.getElementById('kdialog');
  if(!d){
    d=document.createElement('div');
    d.id='kdialog';
    d.className='kdialog-backdrop';
    d.innerHTML=`<div class="kdialog" role="dialog" aria-modal="true">
      <div class="kd-icon" id="kd-icon"></div>
      <div class="kd-title" id="kd-title"></div>
      <div class="kd-msg" id="kd-msg"></div>
      <input class="kd-input" id="kd-input" style="display:none">
      <div class="kd-actions" id="kd-actions"></div>
    </div>`;
    document.body.appendChild(d);
  }
  return d;
}

/* kConfirm(opts) → Promise<boolean>
   opts: {title, message, okText, cancelText, danger:true, icon} */
function kConfirm(opts){
  if(typeof opts==='string')opts={message:opts};
  const {title='',message='',okText='Confirm',cancelText='Cancel',danger=false,icon=''}=opts;
  return new Promise(resolve=>{
    const d=_dialogEl();
    document.getElementById('kd-icon').innerHTML=icon||'';
    document.getElementById('kd-icon').style.display=icon?'flex':'none';
    document.getElementById('kd-title').textContent=title;
    document.getElementById('kd-title').style.display=title?'block':'none';
    document.getElementById('kd-msg').innerHTML=_esc(message).replace(/\n/g,'<br>');
    document.getElementById('kd-input').style.display='none';
    const act=document.getElementById('kd-actions');
    act.innerHTML='';
    const cancel=document.createElement('button');
    cancel.className='kd-btn ghost'; cancel.textContent=cancelText;
    cancel.onclick=()=>{ close(); resolve(false); };
    const ok=document.createElement('button');
    ok.className='kd-btn '+(danger?'danger':'primary'); ok.textContent=okText;
    ok.onclick=()=>{ close(); resolve(true); };
    act.appendChild(cancel); act.appendChild(ok);
    open();
    function open(){ d.classList.add('on'); }
    function close(){ d.classList.remove('on'); }
    d.onclick=e=>{ if(e.target===d){ close(); resolve(false); } };
  });
}

/* kAlert(opts) → Promise<void> */
function kAlert(opts){
  if(typeof opts==='string')opts={message:opts};
  const {title='',message='',okText='OK',icon='',danger=false}=opts;
  return new Promise(resolve=>{
    const d=_dialogEl();
    document.getElementById('kd-icon').innerHTML=icon||'';
    document.getElementById('kd-icon').style.display=icon?'flex':'none';
    document.getElementById('kd-title').textContent=title;
    document.getElementById('kd-title').style.display=title?'block':'none';
    document.getElementById('kd-msg').innerHTML=_esc(message).replace(/\n/g,'<br>');
    document.getElementById('kd-input').style.display='none';
    const act=document.getElementById('kd-actions');
    act.innerHTML='';
    const ok=document.createElement('button');
    ok.className='kd-btn '+(danger?'danger':'primary'); ok.textContent=okText;
    ok.onclick=()=>{ d.classList.remove('on'); resolve(); };
    act.appendChild(ok);
    d.classList.add('on');
    d.onclick=e=>{ if(e.target===d){ d.classList.remove('on'); resolve(); } };
  });
}

/* kPrompt(opts) → Promise<string|null> */
function kPrompt(opts){
  if(typeof opts==='string')opts={message:opts};
  const {title='',message='',value='',placeholder='',okText='OK',cancelText='Cancel',password=false}=opts;
  return new Promise(resolve=>{
    const d=_dialogEl();
    document.getElementById('kd-icon').style.display='none';
    document.getElementById('kd-title').textContent=title;
    document.getElementById('kd-title').style.display=title?'block':'none';
    document.getElementById('kd-msg').innerHTML=_esc(message).replace(/\n/g,'<br>');
    document.getElementById('kd-msg').style.display=message?'block':'none';
    const inp=document.getElementById('kd-input');
    inp.style.display='block'; inp.value=value; inp.placeholder=placeholder;
    inp.type=password?'password':'text';
    const act=document.getElementById('kd-actions');
    act.innerHTML='';
    const cancel=document.createElement('button');
    cancel.className='kd-btn ghost'; cancel.textContent=cancelText;
    cancel.onclick=()=>{ close(); resolve(null); };
    const ok=document.createElement('button');
    ok.className='kd-btn primary'; ok.textContent=okText;
    ok.onclick=()=>{ const v=inp.value; close(); resolve(v); };
    act.appendChild(cancel); act.appendChild(ok);
    d.classList.add('on');
    setTimeout(()=>inp.focus(),100);
    inp.onkeydown=e=>{ if(e.key==='Enter'){ const v=inp.value; close(); resolve(v); } };
    d.onclick=e=>{ if(e.target===d){ close(); resolve(null); } };
    function close(){ d.classList.remove('on'); document.getElementById('kd-msg').style.display='block'; }
  });
}
