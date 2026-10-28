/* Shared header, footer and small site-wide behaviour for every page.
   A page opts in with <div id="site-header"></div> / <div id="site-footer"></div>. */
(function(){
  const PAGES=[['/features.html','Features'],['/how-it-works.html','How it works'],['/security.html','Security'],
               ['/privacy.html','Privacy'],['/help.html','Help']];
  const here=location.pathname.replace(/\/$/,'/index.html');
  const year=new Date().getFullYear();

  const h=document.getElementById('site-header');
  if(h){
    h.innerHTML='<div class="sw"><header class="s-nav">'+
      '<a class="s-brand" href="/"><img src="/icons/bharatapp-logo.png" alt="BharatApp Chat"></a>'+
      '<nav class="s-links">'+PAGES.map(([u,t])=>'<a href="'+u+'"'+(here===u?' class="on"':'')+'>'+t+'</a>').join('')+'</nav>'+
      '<a class="s-home" href="/"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>Home</a>'+
      '</header></div>';
  }
  const f=document.getElementById('site-footer');
  if(f) f.innerHTML=footerHTML();

  function footerHTML(){
    return '<div class="sw"><footer class="s-foot"><div class="cols">'+
      '<div><img src="/icons/bharatapp-logo.png" alt="BharatApp Chat" style="height:40px"><p style="margin:10px 0 0;max-width:22em">A private messenger made in India. Your @username is your number.</p></div>'+
      '<div><h4>Product</h4><a href="/features.html">Features</a><a href="/how-it-works.html">How it works</a><a href="/security.html">Security</a><a href="/download.html">Download</a></div>'+
      '<div><h4>Company</h4><a href="/about.html">About us</a><a href="/indian-messaging-app.html">Made in India</a><a href="/help.html">Help &amp; contact</a></div>'+
      '<div><h4>Legal</h4><a href="/privacy.html">Privacy Policy</a><a href="/terms.html">Terms of Use</a><a href="/delete-account.html">Delete your account</a></div>'+
      '</div><div class="love"><span>Made with <b>❤</b> in India</span>'+
      '<span>© '+year+' BharatApp Chat Media Private Limited. All rights reserved.</span></div></footer></div>';
  }
  window.siteFooterHTML=footerHTML;

  // No right-click menu on the site (text fields keep theirs for paste).
  document.addEventListener('contextmenu',e=>{
    const t=e.target;
    if(t&&(t.closest('input,textarea,[contenteditable="true"]')))return;
    e.preventDefault();
  });
})();
