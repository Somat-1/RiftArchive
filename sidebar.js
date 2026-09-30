(function(){
  'use strict';
  const panel=document.querySelector('.admin-mode-nav,.sidebar');
  if(!panel)return;
  const admin=panel.classList.contains('admin-mode-nav');
  const host=admin?document.querySelector('.admin-shell'):document.querySelector('.app');
  if(!host)return;
  const className=admin?'admin-nav-is-collapsed':'sidebar-is-collapsed';
  const storageKey=admin?'riftarchive_admin_nav_collapsed':'riftarchive_sidebar_collapsed';
  const button=document.createElement('button');
  button.type='button';
  button.className='sidebar-collapse-toggle';
  button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
  panel.append(button);

  function apply(collapsed){
    host.classList.toggle(className,collapsed);
    button.setAttribute('aria-expanded',String(!collapsed));
    button.setAttribute('aria-label',collapsed?'Expand navigation':'Collapse navigation');
    button.title=collapsed?'Expand navigation':'Collapse navigation';
  }
  let collapsed=false;
  try{collapsed=localStorage.getItem(storageKey)==='true'}catch(error){}
  apply(collapsed);
  button.addEventListener('click',()=>{
    collapsed=!host.classList.contains(className);
    apply(collapsed);
    try{localStorage.setItem(storageKey,String(collapsed))}catch(error){}
  });
})();
