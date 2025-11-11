/*
  EduCare Admin Core – admin.js
  --------------------------------------------------
  Drop this file in /admin/admin.js
  Purpose: one shared source of truth for the entire Admin portal.
  - Sample seed data (loaded once)
  - LocalStorage data store helpers (CRUD)
  - Linking Student ↔ Parent ↔ Counselor
  - Risk scoring simulation (for prototype)
  - Backup / Restore / Reset
  - Simple pub/sub event bus so pages can react to changes
*/

(function (window) {
  const LS_KEY = 'educare_store_v1';
  const BUS_KEY = 'educare_event_bus'; // used for cross-tab/page events

  // ---------- Utilities ----------
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const todayISO = () => new Date().toISOString();

  function getStore() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function setStore(next) {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    // broadcast event to other pages listening
    localStorage.setItem(BUS_KEY, JSON.stringify({ t: Date.now(), type: 'STORE_UPDATED' }));
    // also emit an in-page event so same-tab listeners can react immediately
    try {
      const ev = new CustomEvent('educare:store.updated', { detail: { t: Date.now() } });
      window.dispatchEvent(ev);
    } catch (e) {
      // ignore if CustomEvent not supported (very old browsers)
    }
  }

  function ensureStore() {
    let s = getStore();
    if (s) return s;
    // Seed data (runs once on first load)
    s = {
      meta: { createdAt: todayISO(), version: 1 },
      users: {
        students: [
          { id: 'stu_1', name: 'Ravi Kumar', pin: '20A91A001', password: 'student123', branch: 'CSE', department: 'Engineering', attendance: 85, cgpa: 7.2, stress: 3, risk: 'Low', parentId: 'par_1', counselorId: 'cou_1' },
          { id: 'stu_2', name: 'Anjali Sharma', pin: '20A91A002', password: 'student123', branch: 'ECE', department: 'Engineering', attendance: 66, cgpa: 5.8, stress: 6, risk: 'High', parentId: 'par_2', counselorId: 'cou_2' },
          { id: 'stu_3', name: 'Vikram Singh', pin: '20A91A003', password: 'student123', branch: 'ME', department: 'Engineering', attendance: 74, cgpa: 6.3, stress: 5, risk: 'Medium', parentId: 'par_3', counselorId: 'cou_1' }
        ],
        parents: [
          { id: 'par_1', name: 'Mr. Kumar', email: 'kumar.parent@example.com', password: 'parent123', studentId: 'stu_1' },
          { id: 'par_2', name: 'Mrs. Sharma', email: 'sharma.parent@example.com', password: 'parent123', studentId: 'stu_2' },
          { id: 'par_3', name: 'Mr. Singh', email: 'singh.parent@example.com', password: 'parent123', studentId: 'stu_3' }
        ],
        counselors: [
          { id: 'cou_1', name: 'Dr. Meena Rao', email: 'meena.counselor@example.com', password: 'counselor123', students: ['stu_1', 'stu_3'] },
          { id: 'cou_2', name: 'Prof. Ajay', email: 'ajay.counselor@example.com', password: 'counselor123', students: ['stu_2'] }
        ],
        admins: [
          { id: 'adm_1', name: 'System Admin', email: 'admin@educare.local', password: 'admin123' }
        ]
      },
      sessions: [
        { id: 'sess_1', studentId: 'stu_2', counselorId: 'cou_2', date: todayISO(), notes: 'Discussed attendance improvement plan', outcome: 'Action Plan' }
      ],
      uploads: [], // record of uploaded files (meta only in prototype)
      analytics: {
        monthly: [75, 80, 78, 82, 85, 88],
        attendance: [70, 72, 74, 76, 80, 83]
      }
    };
    setStore(s);
    return s;
  }

  // ---------- Risk Engine (prototype) ----------
  // Simple rule-based scoring to simulate AI prediction
  function computeRisk({ attendance, cgpa, stress }) {
    let score = 0;
    if (attendance < 60) score += 50;
    else if (attendance < 75) score += 25;

    if (cgpa < 6) score += 40;
    else if (cgpa < 7) score += 20;

    if (stress >= 7) score += 30;
    else if (stress >= 5) score += 15;

    if (score >= 70) return 'High';
    if (score >= 35) return 'Medium';
    return 'Low';
  }

  // ---------- CRUD Helpers ----------
  function list(role) {
    const s = ensureStore();
    return clone(s.users[role] || []);
  }

  function getById(role, id) {
    return list(role).find((x) => x.id === id) || null;
  }

  function create(role, payload) {
    const s = ensureStore();
    const item = { id: payload.id || `${role.slice(0,3)}_${uid()}`, ...payload };
    s.users[role].push(item);
    setStore(s);
    return item;
  }

  function update(role, id, patch) {
    const s = ensureStore();
    const idx = s.users[role].findIndex((x) => x.id === id);
    if (idx === -1) return null;
    s.users[role][idx] = { ...s.users[role][idx], ...patch };
    setStore(s);
    return clone(s.users[role][idx]);
  }

  function remove(role, id) {
    const s = ensureStore();
    s.users[role] = s.users[role].filter((x) => x.id !== id);
    // cleanup links
    if (role === 'students') {
      s.users.parents.forEach(p => { if (p.studentId === id) p.studentId = null; });
      s.users.counselors.forEach(c => c.students = (c.students || []).filter(sid => sid !== id));
      s.sessions = s.sessions.filter(se => se.studentId !== id);
      // remove references to this student in any persisted 'current' keys
      try{
        const keys = ['educare_current_student_id','educare_current_parent_id','educare_current_counselor_id','educare_current_admin_id'];
        keys.forEach(k=>{ try{ if(localStorage.getItem(k) === id) localStorage.removeItem(k); }catch(_){}});
      }catch(_){/* ignore */}
    }
    if (role === 'parents') {
      s.users.students.forEach(st => { if (st.parentId === id) st.parentId = null; });
    }
    if (role === 'counselors') {
      s.users.students.forEach(st => { if (st.counselorId === id) st.counselorId = null; });
      s.sessions = s.sessions.filter(se => se.counselorId !== id);
    }

    // persist local deletion immediately
    setStore(s);

    // If Firestore is configured, attempt to delete the remote document right away
    try{
      const fb = window.__EDUCARE_FIREBASE;
      if(fb && typeof fb.deleteDocById === 'function'){
        // best-effort async delete; failure will be handled by the sync adapter's pending queue
        fb.deleteDocById(role, id).then(ok=>{
          if(!ok) console.warn('Remote delete reported failure for', role, id);
        }).catch(err=>{
          console.warn('Remote delete failed for', role, id, err);
        });
      }
    }catch(e){ console.warn('Attempt to delete remote doc failed', e); }
    // Record a local tombstone so sync adapter does not re-create the doc from remote snapshots
    try{
      const store = ensureStore();
      store.meta = store.meta || {};
      store.meta.deleted = store.meta.deleted || {};
      store.meta.deleted[role] = Array.isArray(store.meta.deleted[role]) ? store.meta.deleted[role] : [];
      if(!store.meta.deleted[role].includes(id)) store.meta.deleted[role].push(id);
      // persist tombstone
      setStore(store);
    }catch(_){/* ignore tombstone failures */}
  }

  // ---------- Linking Helpers ----------
  function linkParent(studentId, parentId) {
    const s = ensureStore();
    const st = s.users.students.find(x => x.id === studentId);
    const pr = s.users.parents.find(x => x.id === parentId);
    if (!st || !pr) return false;
    // One-to-one mapping (parent ↔ student)
    s.users.parents.forEach(p => { if (p.id === parentId) p.studentId = studentId; });
    s.users.students.forEach(x => { if (x.id === studentId) x.parentId = parentId; });
    setStore(s); return true;
  }

  function assignCounselor(studentId, counselorId) {
    const s = ensureStore();
    const c = s.users.counselors.find(x => x.id === counselorId);
    const st = s.users.students.find(x => x.id === studentId);
    if (!c || !st) return false;
    st.counselorId = counselorId;
    c.students = Array.from(new Set([...(c.students || []), studentId]));
    setStore(s); return true;
  }

  // ---------- Sessions ----------
  function addSession({ studentId, counselorId, date = todayISO(), notes = '', outcome = '' }) {
    const s = ensureStore();
    const session = { id: 'sess_' + uid(), studentId, counselorId, date, notes, outcome };
    s.sessions.push(session);
    setStore(s);
    return session;
  }

  // ---------- Uploads & Prediction ----------
  function recordUpload(meta) {
    const s = ensureStore();
    s.uploads.push({ id: 'upl_' + uid(), ...meta, at: todayISO() });
    setStore(s);
  }

  function runPredictionOnStudents(ids) {
    const s = ensureStore();
    const target = ids && ids.length ? s.users.students.filter(st => ids.includes(st.id)) : s.users.students;
    // For the lightweight prototype risk engine we compute rule-based risk
    // using the student's stored numeric fields (attendance, cgpa, stress).
    target.forEach(st => {
      const attendance = Number(st.attendance || 0);
      const cgpa = Number(st.cgpa || 0);
      const stress = Number(st.stress || 0);
      const risk = computeRisk({ attendance, cgpa, stress });
      st.risk = risk;
      // also expose a coarse dropout probability for UI purposes
      st.dropoutProb = risk === 'High' ? 0.9 : (risk === 'Medium' ? 0.5 : 0.1);
    });
    setStore(s);
    return clone(target);
  }

  // ---------- Analytics ----------
  function riskDistribution() {
    const s = ensureStore();
    const counts = { Low: 0, Medium: 0, High: 0 };
    s.users.students.forEach(st => counts[st.risk] = (counts[st.risk] || 0) + 1);
    return counts;
  }

  // ---------- Backup / Restore ----------
  function exportBackup() {
    const s = getStore() || ensureStore();
    return JSON.stringify(s, null, 2);
  }

  function importBackup(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || !parsed.users) throw new Error('Invalid backup file');
      setStore(parsed);
      return true;
    } catch (e) {
      console.error('Import failed', e);
      return false;
    }
  }

  function resetAll() {
    localStorage.removeItem(LS_KEY);
    ensureStore();
  }

  // ---------- Event Bus (page-to-page) ----------
  function onStoreUpdated(handler) {
    window.addEventListener('storage', (ev) => {
      if (ev.key === BUS_KEY) handler();
    });
    // also listen for in-page notifications (same-tab)
    window.addEventListener('educare:store.updated', () => { handler(); });
  }

  // ---------- Expose API ----------
  const API = {
    // store
    ensureStore, getStore, setStore,
    // CRUD
    list, getById, create, update, remove,
    // links
    linkParent, assignCounselor,
    // sessions
    addSession,
    // prediction
    computeRisk, runPredictionOnStudents, recordUpload,
    // analytics
    riskDistribution,
    // backup
    exportBackup, importBackup, resetAll,
    // events
    onStoreUpdated
  };

  window.EduCareAdmin = API;
  // Initialize immediately so first page load has data
  ensureStore();
  // --- Data migration: ensure all users have a password field (helps when seed changed)
  (function ensurePasswords(){
    const s = getStore();
    if(!s || !s.users) return;
    let changed = false;
    const defaults = { students: 'student123', parents: 'parent123', counselors: 'counselor123', admins: 'admin123' };
    Object.keys(s.users).forEach(role => {
      (s.users[role]||[]).forEach(u => {
        if(u && typeof u.password === 'undefined'){
          u.password = defaults[role] || '';
          changed = true;
        }
      });
    });
    if(changed) setStore(s);
  })();
  // ---------- Logout helper (inject into any sidebar nav) ----------
  function logoutAll() {
    try {
      localStorage.removeItem('educare_current_student_id');
      localStorage.removeItem('educare_current_parent_id');
      localStorage.removeItem('educare_current_counselor_id');
    } catch (e) { /* ignore */ }
    // Optionally clear session-like keys here
    // Redirect to index or login landing
    try { window.location.href = '../index.html'; } catch { window.location.reload(); }
  }

  // Inject a logout link into the sidebar nav if present
  try {
    const nav = document.querySelector('.sidebar .nav');
    if (nav && !document.getElementById('educare_logout_link')) {
      const a = document.createElement('a');
      a.href = '#';
      a.id = 'educare_logout_link';
      a.textContent = 'Logout';
      a.style.marginTop = '8px';
      a.onclick = (e) => { e.preventDefault(); logoutAll(); };
      nav.appendChild(a);
    }
  } catch (e) { /* no-op if DOM not present */ }
  // Utility: remove empty/null-valued users created accidentally
  function _isMeaningfulValue(v){
    if(v === null || typeof v === 'undefined') return false;
    if(typeof v === 'string') return v.trim() !== '';
    if(typeof v === 'number' || typeof v === 'boolean') return true;
    if(Array.isArray(v)) return v.length > 0;
    if(typeof v === 'object') return Object.keys(v).length > 0;
    return false;
  }

  function cleanupEmptyUsers(){
    try{
      const s = getStore();
      if(!s || !s.users) return { removed: 0 };
      let removed = 0;
      ['students','parents','counselors','admins'].forEach(role => {
        if(!Array.isArray(s.users[role])) return;
        const kept = [];
        s.users[role].forEach(u => {
          if(!u || typeof u !== 'object'){ removed++; return; }
          // consider user empty if none of its top-level fields are meaningful
          const has = Object.keys(u).some(k => _isMeaningfulValue(u[k]));
          if(has) kept.push(u); else removed++;
        });
        s.users[role] = kept;
      });
      if(removed){ setStore(s); }
      console.info('cleanupEmptyUsers removed', removed, 'empty records');
      return { removed };
    }catch(e){ console.error('cleanupEmptyUsers failed', e); return { error: e && e.message }; }
  }
  // expose helper for admin console
  try{ window.cleanupEmptyUsers = cleanupEmptyUsers; }catch(e){ }
})(window);
