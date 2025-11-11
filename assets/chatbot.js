// assets/chatbot.js
(function(){
  // Basic floating chatbot that posts to /chat
  function createChatWidget(){
    if(document.getElementById('edu-chatbot-root')) return;
    const root = document.createElement('div'); root.id = 'edu-chatbot-root';
    root.innerHTML = `
      <div class="edu-chatbot" id="eduChatbot">
        <div class="header">
          <div style="display:flex;align-items:center">
            <div class="title">EduCare Assistant</div>
            <div class="subtitle">Project-aware student support</div>
          </div>
          <div class="closeBtn" style="cursor:pointer">✕</div>
        </div>
        <div class="messages" id="eduMessages"></div>
        <div class="composer">
          <textarea id="eduInput" placeholder="Ask about a student, sessions, or general guidance..."></textarea>
          <button id="eduSend">Send</button>
        </div>
      </div>
      <div class="toggleBtn" id="eduToggle">💬</div>
    `;
  document.body.appendChild(root);
    // load CSS
    const cssHref = '/assets/chatbot.css';
    if(!document.querySelector(`link[href="${cssHref}"]`)){
      const l = document.createElement('link'); l.rel='stylesheet'; l.href = cssHref; document.head.appendChild(l);
    }

    const chat = document.getElementById('eduChatbot');
    const toggle = document.getElementById('eduToggle');

    // Create a small stacked mini-toolbar (AI + Quick Chat) near the page FAB.
    // Hide duplicate toggles/FABs and wire the two buttons to their panels.
    (function createMiniToolbar(){
      try{
        if(toggle) toggle.style.display = 'none';
        const pageFab = document.getElementById('eduChatFab'); if(pageFab) pageFab.style.display = 'none';
        const tb = document.createElement('div'); tb.className = 'edu-mini-toolbar';
        const aiBtn = document.createElement('button'); aiBtn.id = 'eduAIBtn'; aiBtn.className = 'edu-ai-mini'; aiBtn.title = 'EduCare Assistant'; aiBtn.innerHTML = '🤖';
        const fabBtn = document.createElement('button'); fabBtn.id = 'eduFabMini'; fabBtn.className = 'edu-fab-mini'; fabBtn.title = 'Quick Chat'; fabBtn.innerHTML = '💬';
        tb.appendChild(aiBtn); tb.appendChild(fabBtn);
        document.body.appendChild(tb);

        aiBtn.addEventListener('click', ()=>{
          const isOpen = chat.style.display === 'block';
          chat.style.display = isOpen ? 'none' : 'block';
          aiBtn.classList.toggle('active', !isOpen);
        });

        fabBtn.addEventListener('click', ()=>{
          const quickPanel = document.getElementById('eduChatPanel');
          if(!quickPanel) return alert('Quick chat panel not found');
          const isOpen = quickPanel.classList.contains('open');
          if(isOpen) quickPanel.classList.remove('open'); else quickPanel.classList.add('open');
        });
      }catch(e){ console.warn('Failed to create mini toolbar', e); }
    })();

    // when AI chat close button clicked, remove active state from toolbar AI button if present
    try{ const aiClose = chat && chat.querySelector && chat.querySelector('.closeBtn'); if(aiClose){ aiClose.addEventListener('click', ()=>{ const btn = document.getElementById('eduAIBtn'); if(btn) btn.classList.remove('active'); }); } }catch(e){}

    // Make the AI chat panel draggable by its header and persist position to localStorage
    try{
      // apply saved position if any
      const saved = localStorage.getItem('edu_chat_pos');
      if(saved){ try{ const pos = JSON.parse(saved); if(pos && pos.left){ chat.style.position = 'fixed'; chat.style.left = pos.left; chat.style.top = pos.top; chat.style.right = 'auto'; chat.style.bottom = 'auto'; } }catch(e){} }

      function makeDraggable(el, handleSel){
        if(!el) return;
        const handle = el.querySelector(handleSel) || el;
        handle.style.cursor = 'grab';
        let dragging = false, offsetX = 0, offsetY = 0;
        function start(ev){ ev.preventDefault(); dragging = true; handle.style.cursor = 'grabbing'; const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX; const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY; const rect = el.getBoundingClientRect(); offsetX = clientX - rect.left; offsetY = clientY - rect.top; document.addEventListener('mousemove', move); document.addEventListener('mouseup', end); document.addEventListener('touchmove', move, {passive:false}); document.addEventListener('touchend', end); }
        function move(ev){ if(!dragging) return; ev.preventDefault(); const clientX = ev.touches ? ev.touches[0].clientX : ev.clientX; const clientY = ev.touches ? ev.touches[0].clientY : ev.clientY; let left = clientX - offsetX; let top = clientY - offsetY; left = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, left)); top = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, top)); el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; }
        function end(){ dragging = false; handle.style.cursor = 'grab'; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', end); document.removeEventListener('touchmove', move); document.removeEventListener('touchend', end); try{ localStorage.setItem('edu_chat_pos', JSON.stringify({ left: el.style.left, top: el.style.top })); }catch(e){} }
        handle.addEventListener('mousedown', start);
        handle.addEventListener('touchstart', start, {passive:false});
      }
      makeDraggable(chat, '.header');
    }catch(e){ console.warn('draggable init failed', e); }

    const closeBtn = chat.querySelector('.closeBtn');
    const msgs = document.getElementById('eduMessages');
    const input = document.getElementById('eduInput');
    const send = document.getElementById('eduSend');

    function addMessage(text, who){
      const div = document.createElement('div'); div.className = 'msg '+(who==='user'?'user':'bot');
      const bub = document.createElement('div'); bub.className='bubble';
      // allow simple HTML for line breaks
      bub.innerHTML = String(text).replace(/\n/g, '<br/>');
      div.appendChild(bub);
      msgs.appendChild(div); msgs.scrollTop = msgs.scrollHeight;
    }

  // Keep the toggle button visible at all times; clicking toggles the chat panel.
  toggle.onclick = ()=>{ chat.style.display = (chat.style.display === 'block' ? 'none' : 'block'); };
  // Close button simply hides the chat panel but leaves the toggle visible
  closeBtn.onclick = ()=>{ chat.style.display='none'; };
    chat.style.display='none';

    async function sendMessage(){
      const text = input.value.trim(); if(!text) return;
      addMessage(text, 'user'); input.value = '';
      // Build messages array: include a system prompt that instructs assistant to use EduCare context
      const messages = [ { role: 'system', content: 'You are EduCare assistant: helpful, concise, and sensitive when discussing student wellbeing.' }, { role: 'user', content: text } ];

      // collect small context from EduCareAdmin if available
      const context = {};
      try{
        // include current user role ids (student/parent/counselor/admin)
        if(window.EduCareStudent && EduCareStudent.getCurrentStudent){ const s = EduCareStudent.getCurrentStudent(); if(s) context.currentStudent = { id: s.id, name: s.name, attendance: s.attendance, cgpa: s.cgpa, stress: s.stress }; }
        if(window.EduCareAdmin && EduCareAdmin.getStore){ const store = EduCareAdmin.getStore(); if(store && store.meta) context.systemMeta = store.meta; if(store && store.meta && store.meta.chatbotContext) context.project = store.meta.chatbotContext; }
      }catch(e){ /* ignore */ }

      addMessage('Thinking...', 'bot');
      try{
        // Do not include client-side API keys. The server will use its server-side stored key.
        const payload = { messages, context };

        // determine model server base (if configured in system settings) and post there, otherwise use same-origin /chat
        let endpoint = '/chat';
        try{
          const st = window.EduCareAdmin && EduCareAdmin.getStore && EduCareAdmin.getStore();
          const base = (st && st.meta && st.meta.modelApiBase) ? String(st.meta.modelApiBase).replace(/\/$/, '') : '';
          if(base) endpoint = base + '/chat';
        }catch(e){}

        console.debug('Chat endpoint:', endpoint, 'payload keys:', Object.keys(payload));

        // Helper to perform a POST and return {ok,res,bodyText,json}
        async function doPost(url){
          try{
            const r = await fetch(url, { method:'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            const text = await r.text().catch(()=>null);
            let json = null;
            try{ json = text ? JSON.parse(text) : null; }catch(e){ json = null; }
            return { ok: r.ok, status: r.status, text, json };
          }catch(err){
            return { ok: false, error: err };
          }
        }

        // Try primary endpoint first
        let result = await doPost(endpoint);
        // If method not allowed or network error and endpoint was relative, retry against explicit localhost server
        if((result && result.status === 405) || (result && result.error && endpoint === '/chat')){
          const alt = 'http://127.0.0.1:8000/chat';
          console.debug('Retrying chat POST against', alt);
          result = await doPost(alt);
        }

        // remove the last 'Thinking...' bubble
        const last = msgs.querySelectorAll('.msg.bot'); if(last && last.length) last[last.length-1].remove();

        if(!result){
          addMessage('No response from chat request (unknown error).', 'bot');
          return;
        }
        if(result.error){
          addMessage('Failed to contact chat server: '+String(result.error), 'bot');
          return;
        }
        if(!result.ok){
          const txt = (result.text) ? result.text : `status ${result.status}`;
          console.warn('Chat request failed', result.status, txt);
          addMessage(`Chat server error (${result.status}): ${txt}`, 'bot');
          return;
        }
        const j = result.json || null;
        if(j && j.reply){ addMessage(j.reply, 'bot'); }
        else if(j && j.raw){ addMessage(JSON.stringify(j.raw).slice(0,800), 'bot'); }
        else addMessage('No response from server.', 'bot');
      }catch(e){
        // remove thinking
        const last = msgs.querySelectorAll('.msg.bot'); if(last && last.length) last[last.length-1].remove();
        addMessage('Failed to contact chat server: '+e.message, 'bot');
      }
    }

    // Auto-seed chatbot context from the model server when possible (non-blocking)
    (async function seedChatContext(){
      try{
        if(!(window.EduCareAdmin && EduCareAdmin.getStore && (EduCareAdmin.setStore || window.localStorage))){ return; }
        const st = EduCareAdmin.getStore();
        const base = (st && st.meta && st.meta.modelApiBase) ? String(st.meta.modelApiBase).replace(/\/$/, '') : 'http://127.0.0.1:8000';
        // fetch model_info and recent predictions (best-effort)
        const infoRes = await fetch(base + '/model_info').catch(()=>null);
        const predsRes = await fetch(base + '/predictions_saved').catch(()=>null);
        let info = null; let preds = null;
        try{ if(infoRes && infoRes.ok) info = await infoRes.json(); }catch(e){}
        try{ if(predsRes && predsRes.ok) preds = await predsRes.json(); }catch(e){}
        if(info || preds){
          const store = EduCareAdmin.getStore() || {};
          store.meta = store.meta || {};
          store.meta.chatbotContext = store.meta.chatbotContext || {};
          if(info) store.meta.chatbotContext.model_info = info;
          if(preds) store.meta.chatbotContext.predictions = preds;
          if(EduCareAdmin.setStore){
            EduCareAdmin.setStore(store);
          }else{
            try{ localStorage.setItem('educare_store_v1', JSON.stringify(store)); }catch(e){}
          }
        }
      }catch(e){ /* ignore seeding errors */ }
    })();

    send.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); sendMessage(); } });

    // ---------------- Quick Chat panel wiring (centralized) ----------------
    try{
      const panel = document.getElementById('eduChatPanel');
      const contactsEl = document.getElementById('chatContacts');
      const targetSelect = document.getElementById('chatTarget');
      const messagesEl = document.getElementById('chatMessages');
      const quickInput = document.getElementById('chatInput');
      const quickSend = document.getElementById('chatSend');
      const chatClose = document.getElementById('chatCloseBtn');

      if(panel && contactsEl && targetSelect && messagesEl && quickInput && quickSend){
        function getAssigned(){
          try{ if(window.EduCareCounselor && EduCareCounselor.getAssignedStudents) return EduCareCounselor.getAssignedStudents(); }catch(e){}
          try{ const st = window.EduCareAdmin && EduCareAdmin.getStore && EduCareAdmin.getStore(); return (st && st.users && st.users.students) ? st.users.students : []; }catch(e){ return []; }
        }

        function renderContacts(){
          const students = getAssigned();
          contactsEl.innerHTML = students.map(s=>`<div class="quick-contact" data-id="${s.id}" style="padding:8px;border-bottom:1px solid #f1f5f9;cursor:pointer">${s.name}<div style=\"font-size:12px;color:#6b7280\">${s.pin||s.id}</div></div>`).join('') || '<div style="color:#6b7280">No assigned students</div>';
          targetSelect.innerHTML = '<option value="">Select student</option>' + students.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
          contactsEl.querySelectorAll('.quick-contact').forEach(el=> el.addEventListener('click', ()=>{ const id = el.getAttribute('data-id'); targetSelect.value = id; renderMessagesFor(id); }));
        }

        function renderMessagesFor(studentId){
          if(!studentId){ messagesEl.innerHTML = '<div style="color:#6b7280">Select a student to view messages.</div>'; return; }
          // prefer EduCareCounselor.getThread if available
          let thread = [];
          try{ if(window.EduCareCounselor && EduCareCounselor.getThread) thread = EduCareCounselor.getThread({ targetRole: 'student', targetId: studentId }) || []; }catch(e){}
          // fallback: no thread API -> show placeholder
          if(!thread.length) messagesEl.innerHTML = '<div style="color:#6b7280">No messages yet for this student.</div>'; else messagesEl.innerHTML = thread.map(m=>`<div class="msg ${m.from==='counselor'?'from-me':'from-them'}">${m.text}<div style=\"font-size:11px;color:#6b7280;margin-top:6px\">${new Date(m.at).toLocaleTimeString()}</div></div>`).join('');
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        quickSend.addEventListener('click', async ()=>{
          const studentId = targetSelect.value; const text = quickInput.value.trim();
          if(!studentId) return alert('Select a student'); if(!text) return;
          try{
            if(window.EduCareCounselor && EduCareCounselor.sendMessage){
              await EduCareCounselor.sendMessage({ targetRole:'student', targetId: studentId, text });
              quickInput.value = '';
              renderMessagesFor(studentId);
            } else {
              // fallback: append to local UI only
              const div = document.createElement('div'); div.className='msg from-me'; div.textContent = text; messagesEl.appendChild(div); quickInput.value = '';
            }
          }catch(e){ console.error('quick send failed', e); alert('Failed to send message'); }
        });

        if(chatClose) chatClose.addEventListener('click', ()=>{ panel.classList.remove('open'); panel.setAttribute('aria-hidden','true'); });
        // initial render
        renderContacts();
        // re-render when store updates
        if(window.EduCareAdmin && EduCareAdmin.onStoreUpdated) EduCareAdmin.onStoreUpdated(renderContacts);
      }
    }catch(e){ console.warn('quick chat wiring failed', e); }
  }

  // Initialize when ready
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', createChatWidget); else createChatWidget();
})();
