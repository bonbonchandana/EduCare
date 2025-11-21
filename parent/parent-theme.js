(function(){
  // Create a backdrop of softly animated orbs for parent pages
  const container = document.createElement('div'); container.className = 'parent-orbs';
  document.body.appendChild(container);

  const sizes = ['small','med','large'];
  const colors = ['rgba(124,58,237,0.22)','rgba(6,182,212,0.18)','rgba(255,184,107,0.14)'];

  function makeOrb(i){
    const el = document.createElement('div');
    el.className = 'parent-orb ' + sizes[i % sizes.length];
    el.style.left = (10 + Math.random()*80) + '%';
    el.style.top = (10 + Math.random()*80) + '%';
    el.style.background = colors[i % colors.length];
    el.style.animation = `floatParent ${12 + Math.floor(Math.random()*8)}s ease-in-out ${Math.random()*3}s infinite`;
    container.appendChild(el);
  }

  for(let i=0;i<7;i++) makeOrb(i);

  // gentle parallax on mouse move (subtle, and safe for reduced-motion)
  let supportsPointer = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches === false;
  if(supportsPointer){
    document.addEventListener('mousemove', (e)=>{
      const cx = window.innerWidth/2, cy = window.innerHeight/2;
      const dx = (e.clientX - cx)/cx, dy = (e.clientY - cy)/cy;
      container.style.transform = `translate(${dx*6}px, ${dy*6}px)`;
    });
  }
})();

/* Sidebar dimming behavior: reduce visual weight on scroll, restore on hover */
(function(){
  const sidebar = document.querySelector('.sidebar');
  if(!sidebar) return;
  // apply a subtle dim by default across parent pages (reduces saturation/weight)
  sidebar.classList.add('dimmed');
  let last = 0;
  function checkScroll(){
    const pos = window.scrollY || document.documentElement.scrollTop || 0;
    if(pos > 80){ sidebar.classList.add('dimmed'); sidebar.classList.add('scrolled'); }
    else { sidebar.classList.remove('scrolled'); sidebar.classList.remove('dimmed'); }
    last = pos;
  }
  // run on load and on scroll
  checkScroll();
  window.addEventListener('scroll', throttle(checkScroll, 120));
  // remove dim on hover to let users focus on nav when they need it
  sidebar.addEventListener('mouseenter', ()=> sidebar.classList.remove('dimmed'));
  sidebar.addEventListener('mouseleave', ()=> { if((window.scrollY||0) > 80) sidebar.classList.add('dimmed'); });

  // tiny throttle helper
  function throttle(fn, wait){ let t = null; return function(){ if(t) return; t = setTimeout(()=>{ t=null; fn(); }, wait); } }
})();

/* Notifications UI initializer (shared across parent pages) */
(function(){
  function createPanelIfMissing(){
    let panel = document.getElementById('notifPanel');
    if(!panel){
      panel = document.createElement('div');
      panel.id = 'notifPanel';
      panel.className = 'notif-panel';
      panel.setAttribute('aria-hidden','true');
      panel.innerHTML = `<h4>Notifications</h4><div class="notif-item">No new notifications<small>— You're all caught up</small></div>`;
      document.body.appendChild(panel);
    }
    return panel;
  }

  function updateNotificationsUI(){
    const panel = createPanelIfMissing();
    const btn = document.getElementById('notifBtn');
    if(!btn) return;

    // try to render real notifications from EduCareAdmin store if available
    try{
      const me = window.EduCareParent?.getCurrentParent?.();
      const store = window.EduCareAdmin?.getStore?.() || {};
      const my = (store.users && store.users.parents || []).find(x=> x.id === (me && me.id)) || {};
      const notes = my.notifications || [];
      const unread = notes.filter(n=>!n.read).length;
      // badge element
      let badge = btn.querySelector('.notif-badge');
      if(!badge){ badge = document.createElement('span'); badge.className = 'notif-badge'; badge.style.cssText='background:#ef4444;padding:2px 6px;border-radius:999px;font-size:12px;margin-left:6px;display:inline-block'; btn.appendChild(badge); }
      badge.textContent = unread || 0;

      panel.innerHTML = `<h4>Notifications</h4>` + (notes.length ? notes.map(n=> `<div class="notif-item"><strong>${n.title}</strong><div style="font-size:12px;color:rgba(255,255,255,0.6)">${new Date(n.at||Date.now()).toLocaleString()}</div><div style="margin-top:6px">${n.message||''}</div></div>`).join('') : `<div class="notif-item">No notifications<small>— You're all caught up</small></div>`);
    }catch(e){
      // leave default content
    }
  }

  // Wire button behavior for any page that includes the .notif-button markup
  document.addEventListener('click', function pageNotifHandler(e){
    const btn = document.getElementById('notifBtn');
    if(!btn) return;
    const panel = createPanelIfMissing();

    // First-time: if clicking on the icon and still in mode 0, convert to text-only
    if(e.target === btn || btn.contains(e.target)){
      // determine mode
      if(!btn.dataset.mode || btn.dataset.mode === '0'){
        btn.classList.add('text-only');
        const icon = btn.querySelector('.notif-icon'); if(icon) icon.style.display = 'none';
        const text = btn.querySelector('.notif-text'); if(text) text.style.display = 'inline';
        btn.dataset.mode = '1';
        btn.setAttribute('aria-expanded','false');
        updateNotificationsUI();
        return;
      }

      // subsequent clicks toggle panel
      const open = panel.classList.toggle('open');
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if(open) updateNotificationsUI();
      return;
    }

    // click outside: close panel
    if(panel.classList.contains('open') && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)){
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden','true');
      btn.setAttribute('aria-expanded','false');
    }
  });

  // If EduCareAdmin emits store updates, refresh the UI
  if(window.EduCareAdmin && typeof window.EduCareAdmin.onStoreUpdated === 'function'){
    window.EduCareAdmin.onStoreUpdated(function(){ updateNotificationsUI(); });
  } else {
    // fallback: periodic refresh in case store becomes available later
    setTimeout(updateNotificationsUI, 800);
    setTimeout(updateNotificationsUI, 3000);
  }
})();
