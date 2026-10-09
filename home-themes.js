/* Snag home-screen design gallery. Local preference only; no project or cloud data changed. */
(function () {
  'use strict';
  const KEY = 'snag-home-design-v1';
  const designs = [
    {id:'classic',name:'Current design',kind:'original',detail:'Keep the original Snag home screen.'},
    {id:'full-bleed',name:'Full-Bleed Hero',kind:'photo',detail:'Immersive project photo with overlaid progress.'},
    {id:'split-banner',name:'Split Banner',kind:'split',detail:'Architectural image beside a structured summary.'},
    {id:'clean-stack',name:'Clean Card Stack',kind:'light',detail:'Airy photography, distinct white cards and quiet text.'},
    {id:'dark-mode',name:'Dark Mode',kind:'dark',detail:'Midnight-blue surfaces and high-contrast cards.'},
    {id:'architectural',name:'Architectural Editorial',kind:'editorial',detail:'Warm paper, refined type and edge-to-edge photographs.'},
    {id:'site-journal',name:'Dark Site Journal',kind:'journal',detail:'Atmospheric charcoal, warm photographs and coral rails.'},
    {id:'modern-utility',name:'Modern Utility',kind:'utility',detail:'Bright, practical layout with compact sans-serif labels.'}
  ];
  const ids = new Set(designs.map(x=>x.id));
  function stored() {
    try {
      const val = localStorage.getItem(KEY);
      return ids.has(val) ? val : 'classic';
    } catch (_) { return 'classic'; }
  }
  function apply(id, persist) {
    if (!ids.has(id)) return;
    document.documentElement.setAttribute('data-home-theme',id);
    if (persist) { try {localStorage.setItem(KEY,id)} catch (_) {} }
    document.querySelectorAll('input[name="snag-home-design"]').forEach(input=>{
      input.checked = input.value===id;
      const card=input.closest('.home-theme-option');
      if(card) card.classList.toggle('is-selected',input.checked);
    });
    const label=document.getElementById('activeHomeDesign');
    const match=designs.find(x=>x.id===id);
    if(label && match)label.textContent='Using: '+match.name;
  }
  function renderGallery() {
    const host=document.getElementById('homeThemeChoices');
    if(!host)return;
    host.innerHTML=designs.map(x=>
      '<label class="home-theme-option" data-design="'+x.id+'">'+
      '<input type="radio" name="snag-home-design" value="'+x.id+'" aria-label="'+x.name+'">'+
      '<span class="home-theme-swatch home-theme-swatch--'+x.kind+'" aria-hidden="true">'+
      '<span class="mini-project"><span class="mini-roof"></span><span class="mini-window"></span></span>'+
      '<span class="mini-summary"><i></i><b></b><em></em></span>'+
      '<span class="mini-item"><i></i><b></b><em></em></span></span>'+
      '<span class="home-theme-copy"><strong>'+x.name+'</strong><small>'+x.detail+'</small></span>'+
      '<span class="home-theme-check" aria-hidden="true">✓</span></label>'
    ).join('');
    host.addEventListener('change',event=>{
      const input=event.target.closest('input[name="snag-home-design"]');
      if(input)apply(input.value,true);
    });
    apply(stored(),false);
  }
  apply(stored(),false);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',renderGallery,{once:true});
  else renderGallery();
  window.addEventListener('storage',event=>{
    if(event.key===KEY)apply(stored(),false);
  });
})();
