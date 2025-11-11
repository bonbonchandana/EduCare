// Floating animated words and small interactivity for student pages
(function(){
  const words = ['Focus','Grow','Learn','Thrive','Explore','Create','Improve','Reflect','Engage'];

  // Ensure required CSS for floating words is present. Some pages (e.g., chat.html)
  // include `student-theme.css`, but others may not — inject minimal styles so
  // the floating words render as positioned animated elements instead of inline text.
  if(!document.querySelector('link[href*="student-theme.css"], style#student-theme-inline')){
    const style = document.createElement('style');
    style.id = 'student-theme-inline';
    style.textContent = `
      .floating-area{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:40}
      .floating-word{position:absolute;font-weight:700;opacity:.85;font-size:18px;color:#fff;padding:6px 12px;border-radius:999px;mix-blend-mode:screen;transform:translateY(100vh);animation:floatUp 6s linear forwards}
      @keyframes floatUp{0%{transform:translateY(110vh) scale(.8);opacity:0}10%{opacity:1}70%{opacity:1}100%{transform:translateY(-10vh) scale(1.05);opacity:0}}
      @media (max-width:720px){ .floating-word{font-size:14px} }
    `;
    document.head && document.head.appendChild(style);
  }

  const area = document.createElement('div'); area.className = 'floating-area';
  document.body.appendChild(area);

  function spawn(){
    const w = words[Math.floor(Math.random()*words.length)];
    const el = document.createElement('div');
    el.className = 'floating-word';
    el.textContent = w;
    // randomize color palette
    const hue = Math.floor(Math.random()*360);
    el.style.background = `hsl(${hue} 90% 55% / 0.95)`;
    el.style.left = Math.floor(Math.random()*90) + '%';
    el.style.fontSize = (14 + Math.floor(Math.random()*12)) + 'px';
    area.appendChild(el);
    el.addEventListener('animationend', ()=> el.remove());
  }

  // spawn a few on load and then periodically
  for(let i=0;i<6;i++){ setTimeout(spawn, i*400); }
  setInterval(()=>{ spawn(); }, 2200);

  // Add a gentle hover glow to sidebar links
  document.addEventListener('mouseover', (e)=>{
    const a = e.target.closest('.sidebar .nav a');
    if(a){ a.style.boxShadow = '0 10px 30px rgba(255,255,255,0.06)'; a.style.transform='translateY(-3px)'; }
  });
  document.addEventListener('mouseout', (e)=>{
    const a = e.target.closest('.sidebar .nav a');
    if(a){ a.style.boxShadow = ''; a.style.transform=''; }
  });
  // -------------------- Notifications injection & rendering --------------------
  function ensureNotifUI(){
    const sidebar = document.querySelector('.sidebar');
    if(!sidebar) return null;
    if(sidebar.querySelector('#stuNotifToggle')) return sidebar;
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'padding:8px 6px;color:#fff';
    wrapper.innerHTML = `
      <button id="stuNotifToggle" style="background:transparent;border:none;color:#fff;cursor:pointer;display:flex;align-items:center;gap:8px">🔔 <span id="stuNotifCount" style="background:#ef4444;padding:2px 6px;border-radius:999px;font-size:12px;margin-left:6px;display:inline-block">0</span></button>
      <div id="stuNotifPanel" style="display:none;background:#fff;color:#111;padding:8px;border-radius:8px;margin-top:8px;position:relative;z-index:60;max-height:260px;overflow:auto"></div>
    `;
    const brand = sidebar.querySelector('.brand');
    if(brand && brand.parentNode) brand.parentNode.insertBefore(wrapper, brand.nextSibling);
    else sidebar.insertBefore(wrapper, sidebar.firstChild);
    return sidebar;
  }

  function renderStudentNotifications(){
    try{
      const sidebar = ensureNotifUI(); if(!sidebar) return;
      const toggle = document.getElementById('stuNotifToggle');
      const panel = document.getElementById('stuNotifPanel');
      const countEl = document.getElementById('stuNotifCount');
      if(!toggle || !panel || !countEl) return;
      const student = window.EduCareStudent && EduCareStudent.getCurrentStudent ? EduCareStudent.getCurrentStudent() : null;
      const store = window.EduCareAdmin && EduCareAdmin.getStore ? EduCareAdmin.getStore() : null;
      const studentUser = store && store.users && store.users.students ? (store.users.students.find(x=> x.id === (student && student.id))) : null;
      const notes = (studentUser && studentUser.notifications) ? studentUser.notifications : [];
      const unread = notes.filter(n=>!n.read).length;
      countEl.textContent = unread || 0;
      panel.innerHTML = notes.length ? notes.map(n=>`<div style="padding:8px;border-bottom:1px solid #f1f5f9"><strong>${n.title}</strong><div style="font-size:12px;color:#6b7280">${new Date(n.at).toLocaleString()}</div><div style="margin-top:6px">${n.message}</div><div style="text-align:right;margin-top:6px"><button data-id="${n.id}" class="stu-notif-mark">Mark read</button></div></div>`).join('') : '<div style="color:#6b7280">No notifications</div>';

      toggle.onclick = ()=>{ panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; };

      panel.querySelectorAll('.stu-notif-mark').forEach(b=> b.addEventListener('click', (e)=>{
        const id = e.currentTarget.getAttribute('data-id');
        markStudentNotifRead(id);
      }));
    }catch(e){ console.warn('renderStudentNotifications failed', e); }
  }

  function markStudentNotifRead(id){
    if(!id) return;
    try{
      const store = window.EduCareAdmin && EduCareAdmin.getStore ? EduCareAdmin.getStore() : null;
      if(!store) return;
      const student = window.EduCareStudent && EduCareStudent.getCurrentStudent ? EduCareStudent.getCurrentStudent() : null;
      if(!student) return;
      const p = (store.users && store.users.students||[]).find(x=>x.id===student.id);
      if(p && p.notifications){ const ni = p.notifications.find(x=>x.id===id); if(ni) ni.read = true; }
      // Prefer granular update API if available, otherwise replace full store
      if(window.EduCareAdmin && EduCareAdmin.update){
        // send updated student object
        EduCareAdmin.update('students', student.id, p);
      }else if(window.EduCareAdmin && EduCareAdmin.setStore){
        EduCareAdmin.setStore(store);
      }
      renderStudentNotifications();
    }catch(e){ console.error('markStudentNotifRead failed', e); }
  }

  if(window.EduCareAdmin && EduCareAdmin.onStoreUpdated) EduCareAdmin.onStoreUpdated(renderStudentNotifications);
  try{ renderStudentNotifications(); }catch(e){ window.addEventListener('student-ready', renderStudentNotifications); }
})();
