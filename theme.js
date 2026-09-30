(function(){
  const key='riftarchive_theme';
  const embedded=new URLSearchParams(location.search).get('embed')==='1';
  const inherited=embedded&&window.parent!==window?window.parent.document.documentElement.dataset.theme:null;
  const stored=localStorage.getItem(key);
  let theme=stored==='dark'||stored==='light'?stored:(inherited||document.body.dataset.defaultTheme||'light');
  const apply=value=>{
    theme=value;
    document.documentElement.dataset.theme=value;
    document.documentElement.style.colorScheme=value;
    const button=document.querySelector('.theme-toggle');
    if(button){
      button.setAttribute('aria-label',`Switch to ${value==='dark'?'light':'dark'} mode`);
      button.setAttribute('title',`Switch to ${value==='dark'?'light':'dark'} mode`);
      button.innerHTML=value==='dark'?'<span>☀</span><b>Light</b>':'<span>☾</span><b>Dark</b>';
    }
    document.querySelectorAll('iframe').forEach(frame=>frame.contentWindow?.postMessage({type:'riftarchive-theme',theme:value},location.origin));
  };
  apply(theme);
  const button=document.createElement('button');
  button.type='button';
  button.className='theme-toggle';
  if(!embedded){
    document.body.append(button);
    button.addEventListener('click',()=>{const next=theme==='dark'?'light':'dark';localStorage.setItem(key,next);apply(next)});
  }
  window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='riftarchive-theme')apply(event.data.theme)});
  apply(theme);
})();
