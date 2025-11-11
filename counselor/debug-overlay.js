(function(){
  // Debug overlay for QA: toggle with Ctrl+Shift+D or click the small handle
  const id = 'eduDebugOverlay';
  if(document.getElementById(id)) return;
  const btn = document.createElement('button');
  btn.id = 'eduDebugToggle';
  btn.textContent = 'QA';
  Object.assign(btn.style, {position:'fixed',right:'12px',top:'12px',zIndex:20050,padding:'8px 10px',borderRadius:'8px',background:'linear-gradient(90deg,#7b2ff7,#0ea5e9)',color:'#fff',border:'none',cursor:'pointer',boxShadow:'0 10px 30px rgba(59,130,246,0.18)'});
  document.body.appendChild(btn);

  const panel = document.createElement('div'); panel.id = id;
  Object.assign(panel.style, {position:'fixed',right:'12px',top:'56px',width:'420px',maxHeight:'60vh',overflow:'auto',zIndex:20050,background:'rgba(255,255,255,0.98)',color:'#071013',borderRadius:'10px',boxShadow:'0 30px 80px rgba(2,6,23,0.18)',padding:'12px',display:'none',fontFamily:'monospace',fontSize:'12px'});
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <strong>EduCare QA Overlay</strong>
      <div style="display:flex;gap:8px"><button id="eduDbgRefresh" style="padding:6px;border-radius:6px;border:none;background:#0ea5e9;color:#fff;cursor:pointer">Refresh</button><button id="eduDbgCopy" style="padding:6px;border-radius:6px;border:none;background:#7b2ff7;color:#fff;cursor:pointer">Copy</button></div>
    </div>
    <div style="margin-bottom:8px"><strong>Counselor:</strong> <span id="dbgCounselor">(loading)</span></div>
    <div style="margin-bottom:8px"><strong>Store Summary:</strong> <div id="dbgSummary" style="margin-top:6px;color:#374151"></div></div>
    <details id="dbgRaw" style="margin-top:8px"><summary>Raw store (click to expand)</summary><pre id="dbgStorePre" style="white-space:pre-wrap;max-height:300px;overflow:auto;background:#f8fafc;padding:8px;border-radius:6px;margin-top:6px;color:#0b1220"></pre></details>
  `;
  document.body.appendChild(panel);

  function render(){
    try{
      const c = window.EduCareCounselor && EduCareCounselor.getCurrentCounselor ? EduCareCounselor.getCurrentCounselor() : null;
      const store = window.EduCareAdmin && EduCareAdmin.getStore ? EduCareAdmin.getStore() : null;
      document.getElementById('dbgCounselor').textContent = c ? (c.name + ' ('+c.id+')') : 'None';
      if(store){
        const counts = { students: (store.users && store.users.students && store.users.students.length) || 0, sessions: (store.sessions && store.sessions.length) || 0 };
        document.getElementById('dbgSummary').innerHTML = `Students: ${counts.students} &nbsp; | &nbsp; Sessions: ${counts.sessions} &nbsp; | &nbsp; Version: ${store.meta && store.meta.version ? store.meta.version : 'n/a'}`;
        document.getElementById('dbgStorePre').textContent = JSON.stringify(store, null, 2);
      } else {
        document.getElementById('dbgSummary').textContent = 'Store not available';
        document.getElementById('dbgStorePre').textContent = '';
      }
    }catch(e){ console.warn('dbg render failed', e); }
  }

  btn.addEventListener('click', ()=>{ panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; render(); });
  document.getElementById('eduDbgRefresh').addEventListener('click', render);
  document.getElementById('eduDbgCopy').addEventListener('click', ()=>{ try{ const t = document.getElementById('dbgStorePre').textContent || ''; navigator.clipboard.writeText(t); alert('Store JSON copied to clipboard'); }catch(e){ alert('Copy failed'); } });

  // keyboard toggle Ctrl+Shift+D
  window.addEventListener('keydown', (ev)=>{ if(ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'd'){ panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; render(); } });

  // auto-refresh on store updates
  if(window.EduCareAdmin && EduCareAdmin.onStoreUpdated){ EduCareAdmin.onStoreUpdated(render); }
  // initial render
  setTimeout(render, 200);
})();
