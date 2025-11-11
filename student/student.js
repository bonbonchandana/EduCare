/*
  EduCare – Student Portal Core (student.js)
  --------------------------------------------
  Works with the Admin core (EduCareAdmin)
  Responsibilities:
  - Soft login (select student) & persist current student
  - Fetch academic/attendance/risk data for the logged-in student
  - Retrieve counselor and parent info
  - Display counseling reports
  - Chat integration (with counselor)
*/

(function (window) {
  if (!window.EduCareAdmin) {
    console.error("EduCareAdmin core not found. Include /admin/admin.js first.");
    return;
  }

  const LS_CURRENT = "educare_current_student_id";

  // ---------- Soft Login ----------
  function getCurrentStudentId() {
    return localStorage.getItem(LS_CURRENT) || null;
  }

  function setCurrentStudentId(id) {
    localStorage.setItem(LS_CURRENT, id);
  }

  function getCurrentStudent() {
    const id = getCurrentStudentId();
    return id ? EduCareAdmin.getById("students", id) : null;
  }

  // ---------- Student Selector UI ----------
  function ensureStudentSelected() {
    const id = getCurrentStudentId();
    if (id) return true;

    const list = EduCareAdmin.list("students");
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;";
    wrap.innerHTML = `
      <div style="background:#fff;border-radius:16px;max-width:480px;width:100%;box-shadow:0 10px 24px rgba(0,0,0,.2);padding:20px;font-family:Poppins,sans-serif">
        <h2 style="margin:0 0 10px">Select Student</h2>
        <p style="margin:0 0 12px;color:#6b7280">Choose a student profile to continue. (Prototype soft-login)</p>
        <select id="s_select" style="width:100%;padding:10px;border:1px solid #e5e7eb;border-radius:10px">
          ${list.map((s) => `<option value="${s.id}">${s.name} (${s.pin})</option>`).join("")}
        </select>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
          <button id="s_choose" style="padding:10px 16px;border:none;border-radius:10px;color:#fff;background:linear-gradient(135deg,#7b2ff7,#f107a3)">Continue</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    document.getElementById("s_choose").onclick = () => {
      const sel = document.getElementById("s_select").value;
      setCurrentStudentId(sel);
      document.body.removeChild(wrap);
      window.dispatchEvent(new Event("student-ready"));
    };
    return false;
  }

  // ---------- Data Access ----------
  function getLinkedCounselor() {
    const s = getCurrentStudent();
    if (!s || !s.counselorId) return null;
    return EduCareAdmin.getById("counselors", s.counselorId);
  }

  function getLinkedParent() {
    const s = getCurrentStudent();
    if (!s || !s.parentId) return null;
    return EduCareAdmin.getById("parents", s.parentId);
  }

  function getCounselingSessions() {
    const s = getCurrentStudent();
    if (!s) return [];
    return (EduCareAdmin.getStore().sessions || []).filter((x) => x.studentId === s.id);
  }

  function getChatThread() {
    const s = getCurrentStudent();
    if (!s || !s.counselorId) return [];
    const store = JSON.parse(localStorage.getItem("educare_chat_threads_v1") || '{"threads":{}}');
    const key = `${s.counselorId}|student|${s.id}`;
    return store.threads[key] || [];
  }

  async function sendMessageToCounselor(text) {
    const s = getCurrentStudent();
    if (!s || !s.counselorId) return;
    const key = `${s.counselorId}|student|${s.id}`;
    const store = JSON.parse(localStorage.getItem("educare_chat_threads_v1") || '{"threads":{}}');
    store.threads[key] = store.threads[key] || [];
    store.threads[key].push({ from: "student", text, at: new Date().toISOString() });
    localStorage.setItem("educare_chat_threads_v1", JSON.stringify(store));
    try {
      if (window.EduCareData) {
        await window.EduCareData.sendMessage({ threadKey: key, text, fromRole: 'student', fromId: s.id });
      }
    } catch(e) { console.warn('EduCareData.sendMessage failed', e); }
  }

  // ---------- Utilities ----------
  function fmtDate(d) {
    try {
      return new Date(d).toLocaleString();
    } catch {
      return d;
    }
  }

  // ---------- Expose API ----------
  const API = {
    ensureStudentSelected,
    getCurrentStudentId,
    getCurrentStudent,
    getLinkedCounselor,
    getLinkedParent,
    getCounselingSessions,
    getChatThread,
    sendMessageToCounselor,
    fmtDate,
  };

  window.EduCareStudent = API;
})(window);
