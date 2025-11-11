/*
  EduCare – Parent Portal Core (parent.js)
  -----------------------------------------
  Works with the Admin core (EduCareAdmin)
  Responsibilities:
  - Soft login (choose parent) and store current parent ID
  - Access linked student and counselor data
  - Fetch student's performance, attendance, and counseling reports
  - Chat integration with counselor (shared LocalStorage threads)
*/

(function(window){
    if(!window.EduCareAdmin){
      console.error("EduCareAdmin core not found. Include /admin/admin.js first.");
      return;
    }
  
    const LS_CURRENT_PARENT = "educare_current_parent_id";
  
    // ---------- Soft Login ----------
    function getCurrentParentId(){
      return localStorage.getItem(LS_CURRENT_PARENT) || null;
    }
  
    function setCurrentParentId(id){
      localStorage.setItem(LS_CURRENT_PARENT, id);
    }
  
    function getCurrentParent(){
      const id = getCurrentParentId();
      return id ? EduCareAdmin.getById("parents", id) : null;
    }
  
    function ensureParentSelected(){
      const id = getCurrentParentId();
      if(id) return true;
  
      const list = EduCareAdmin.list("parents");
      const wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
      wrap.innerHTML = `
        <div style="background:#fff;border-radius:16px;max-width:480px;width:100%;box-shadow:0 10px 24px rgba(0,0,0,.2);padding:20px;font-family:Poppins,sans-serif">
          <h2 style="margin:0 0 10px">Select Parent</h2>
          <p style="margin:0 0 12px;color:#6b7280">Choose your parent account to continue. (Prototype soft-login)</p>
          <select id="p_select" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:10px">
            ${list.map(p=>`<option value="${p.id}">${p.name} (${p.email})</option>`).join("")}
          </select>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
            <button id="p_choose" style="padding:10px 16px;border:none;border-radius:10px;color:#fff;background:linear-gradient(135deg,#7b2ff7,#f107a3)">Continue</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
  
      document.getElementById("p_choose").onclick = ()=>{
        const sel = document.getElementById("p_select").value;
        setCurrentParentId(sel);
        document.body.removeChild(wrap);
        window.dispatchEvent(new Event("parent-ready"));
      };
      return false;
    }
  
    // ---------- Linked Data ----------
    function getLinkedStudent(){
      const p = getCurrentParent();
      if(!p || !p.studentId) return null;
      return EduCareAdmin.getById("students", p.studentId);
    }
  
    function getLinkedCounselor(){
      const student = getLinkedStudent();
      if(!student || !student.counselorId) return null;
      return EduCareAdmin.getById("counselors", student.counselorId);
    }
  
    // ---------- Student Data ----------
    function getStudentPerformance(){
      const s = getLinkedStudent();
      if(!s) return {};
      return {attendance: s.attendance, cgpa: s.cgpa, stress: s.stress, risk: s.risk};
    }
  
    function getStudentSessions(){
      const s = getLinkedStudent();
      if(!s) return [];
      return (EduCareAdmin.getStore().sessions || []).filter(se => se.studentId === s.id);
    }
  
    // ---------- Chat Integration ----------
    function getChatThread(){
      const s = getLinkedStudent();
      const c = getLinkedCounselor();
      if(!s || !c) return [];
      const store = JSON.parse(localStorage.getItem("educare_chat_threads_v1") || '{"threads":{}}');
      const key = `${c.id}|parent|${getCurrentParentId()}`;
      return store.threads[key] || [];
    }
  
    async function sendMessageToCounselor(text){
      const s = getLinkedStudent();
      const c = getLinkedCounselor();
      if(!s || !c) return;
      const store = JSON.parse(localStorage.getItem("educare_chat_threads_v1") || '{"threads":{}}');
      const key = `${c.id}|parent|${getCurrentParentId()}`;
      store.threads[key] = store.threads[key] || [];
      store.threads[key].push({ from:"parent", text, at:new Date().toISOString() });
      localStorage.setItem("educare_chat_threads_v1", JSON.stringify(store));
      try {
        if (window.EduCareData) {
          await window.EduCareData.sendMessage({ threadKey: key, text, fromRole: 'parent', fromId: getCurrentParentId() });
        }
      } catch(e) { console.warn('EduCareData.sendMessage failed', e); }
    }
  
    // ---------- Utilities ----------
    function fmtDate(d){
      try{return new Date(d).toLocaleString();}catch{return d;}
    }
  
    // ---------- Expose API ----------
    const API = {
      ensureParentSelected,
      getCurrentParent,
      getLinkedStudent,
      getLinkedCounselor,
      getStudentPerformance,
      getStudentSessions,
      getChatThread,
      sendMessageToCounselor,
      fmtDate
    };
  
    window.EduCareParent = API;
  })(window);
  