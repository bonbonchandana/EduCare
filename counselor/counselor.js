/*
  EduCare – Counselor Portal Core (counselor.js)
  -------------------------------------------------
  Works on top of the Admin core (window.EduCareAdmin)
  Responsibilities:
  - Soft login (choose counselor) and persist current counselor
  - Helper selectors filtered by current counselor
  - CRUD for counseling sessions (using Admin core)
  - Lightweight chat simulation storage
  - Small utilities for charts & formatting
*/

(function(window){
  if(!window.EduCareAdmin){
    console.error('EduCareAdmin core not found. Include /admin/admin.js first.');
    return;
  }

  const LS_CURRENT = 'educare_current_counselor_id';
  const LS_CHAT = 'educare_chat_threads_v1';

  // ---------- Login / Current Counselor ----------
  function getCurrentCounselorId(){
    return localStorage.getItem(LS_CURRENT) || null;
  }
  function setCurrentCounselorId(id){
    localStorage.setItem(LS_CURRENT, id);
  }
  function getCurrentCounselor(){
    const id = getCurrentCounselorId();
    return id ? EduCareAdmin.getById('counselors', id) : null;
  }

  // Show a minimal selector UI if no counselor is chosen yet
  function ensureCounselorSelected(){
    const id = getCurrentCounselorId();
    if(id) return true;
    // inject overlay selector
    const list = EduCareAdmin.list('counselors');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;';
    wrap.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:520px;width:100%;box-shadow:0 10px 24px rgba(0,0,0,.2);padding:20px;font-family:Poppins,sans-serif">
        <h2 style="margin:0 0 10px">Select Counselor</h2>
        <p style="margin:0 0 12px;color:#6b7280">Choose a counselor to continue. (Prototype soft-login)</p>
        <select id="c_select" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:10px"> 
          ${list.map(c=>`<option value="${c.id}">${c.name} (${c.email})</option>`).join('')} 
        </select>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
          <button id="c_choose" style="padding:10px 16px;border:none;border-radius:10px;color:#fff;background:linear-gradient(135deg,#7b2ff7,#f107a3)">Continue</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    document.getElementById('c_choose').onclick = ()=>{
      const sel = document.getElementById('c_select').value;
      setCurrentCounselorId(sel);
      document.body.removeChild(wrap);
      window.dispatchEvent(new Event('counselor-ready'));
    };
    return false;
  }

  // ---------- Data helpers (filtered) ----------
  function getAssignedStudents(){
    const cid = getCurrentCounselorId();
    if(!cid) return [];
    return EduCareAdmin.list('students').filter(s => s.counselorId === cid);
  }

  function getSessionsForCounselor(){
    const cid = getCurrentCounselorId();
    if(!cid) return [];
    const all = EduCareAdmin.getStore().sessions || [];
    const mine = all.filter(se => se.counselorId === cid);
    return mine.sort((a,b)=> new Date(b.date) - new Date(a.date));
  }

  async function addSession({studentId, date, notes, outcome}){
    const counselorId = getCurrentCounselorId();
    try {
      if (window.EduCareData) {
        await window.EduCareData.addSession({ studentId, counselorId, date, notes, outcome });
      } else {
        EduCareAdmin.addSession({ studentId, counselorId, date, notes, outcome });
      }
    } catch(e) {
      console.error('Failed to add session via EduCareData, falling back', e);
      EduCareAdmin.addSession({ studentId, counselorId, date, notes, outcome });
    }
  }

  // ---------- Risk view helpers ----------
  function riskDistributionForCounselor(){
    const list = getAssignedStudents();
    const counts = { Low:0, Medium:0, High:0 };
    list.forEach(s => counts[s.risk] = (counts[s.risk]||0)+1);
    return counts;
  }

  // ---------- Chat simulation ----------
  function getChatStore(){
    try{ return JSON.parse(localStorage.getItem(LS_CHAT)) || { threads: {} }; }
    catch{ return { threads: {} }; }
  }
  function setChatStore(v){ localStorage.setItem(LS_CHAT, JSON.stringify(v)); }

  // key: `${counselorId}|${targetRole}|${targetId}`
  function threadKey({ counselorId, targetRole, targetId }){
    return `${counselorId}|${targetRole}|${targetId}`;
  }

  async function sendMessage({ targetRole, targetId, text }){
    const counselorId = getCurrentCounselorId();
    const store = getChatStore();
    const key = threadKey({ counselorId, targetRole, targetId });
    store.threads[key] = store.threads[key] || [];
    store.threads[key].push({ from:'counselor', text, at:new Date().toISOString() });
    setChatStore(store);
    try {
      if (window.EduCareData) {
        await window.EduCareData.sendMessage({ threadKey: key, text, fromRole: 'counselor', fromId: counselorId });
      }
    } catch(e) { console.warn('EduCareData.sendMessage failed', e); }
    return store.threads[key];
  }
  function receiveMessageMock({ targetRole, targetId, text }){
    // for demo
    const counselorId = getCurrentCounselorId();
    const store = getChatStore();
    const key = threadKey({ counselorId, targetRole, targetId });
    store.threads[key] = store.threads[key] || [];
    store.threads[key].push({ from: targetRole, text, at:new Date().toISOString() });
    setChatStore(store);
    return store.threads[key];
  }
  function getThread({ targetRole, targetId }){
    const counselorId = getCurrentCounselorId();
    const key = threadKey({ counselorId, targetRole, targetId });
    const store = getChatStore();
    return store.threads[key] || [];
  }

  // ---------- Utilities ----------
  function fmtDate(d){ try{ return new Date(d).toLocaleString(); } catch{ return d; } }

  // ---------- Expose API ----------
  const API = {
    ensureCounselorSelected,
    getCurrentCounselorId, setCurrentCounselorId, getCurrentCounselor,
    getAssignedStudents,
    getSessionsForCounselor, addSession,
    riskDistributionForCounselor,
    sendMessage, receiveMessageMock, getThread,
    fmtDate
  };

  window.EduCareCounselor = API;

})(window);
