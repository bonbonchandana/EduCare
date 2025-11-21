// Minimal local-only data adapter that delegates to the localStorage-backed EduCareAdmin.
// This file intentionally avoids loading the Firebase SDK so the app remains fully local.

export const EduCareData = {
  async list(colName){
    return window.EduCareAdmin ? window.EduCareAdmin.list(colName) : [];
  },
  async getById(colName, id){
    return window.EduCareAdmin ? window.EduCareAdmin.getById(colName, id) : null;
  },
  async add(colName, payload, id = null){
    if (!window.EduCareAdmin) throw new Error('Local store not available');
    if (id) { window.EduCareAdmin.update(colName, id, payload); return id; }
    const item = window.EduCareAdmin.create(colName, payload); return item.id;
  },
  async update(colName, id, payload){
    if (!window.EduCareAdmin) throw new Error('Local store not available');
    return !!window.EduCareAdmin.update(colName, id, payload);
  },
  async remove(colName, id){
    if (!window.EduCareAdmin) throw new Error('Local store not available');
    return window.EduCareAdmin.remove(colName, id);
  },
  async studentsByCounselor(counselorId){
    const all = window.EduCareAdmin ? window.EduCareAdmin.list('students') : [];
    return all.filter(s => s.counselorId === counselorId);
  },
  async sessionsByCounselor(counselorId){
    const s = window.EduCareAdmin ? window.EduCareAdmin.getStore() : null;
    return s ? (s.sessions||[]).filter(x => x.counselorId === counselorId) : [];
  },
  async sessionsByStudent(studentId){
    const s = window.EduCareAdmin ? window.EduCareAdmin.getStore() : null;
    return s ? (s.sessions||[]).filter(x => x.studentId === studentId) : [];
  },
  async addSession({ studentId, counselorId, date, notes, outcome }){
    if (!window.EduCareAdmin) throw new Error('Local store not available');
    return window.EduCareAdmin.addSession({ studentId, counselorId, date, notes, outcome });
  },
  async sendMessage({ threadKey, text, fromRole, fromId }){
    // Messages are stored in sessions/messages in the local store if needed; simple add
    // Store message under 'uploads' so getThread() (which reads s.uploads)
    // will return the persisted messages consistently across the app.
    return this.add('uploads', { threadKey, text, fromRole, fromId, at: new Date().toISOString() });
  },
  async getThread(threadKey){
    const s = window.EduCareAdmin ? window.EduCareAdmin.getStore() : null;
    if(!s) return [];
    return (s.uploads||[]).filter(m => m.threadKey === threadKey).sort((a,b)=> new Date(a.at)-new Date(b.at));
  }
};

try { window.EduCareData = EduCareData; } catch(e){}