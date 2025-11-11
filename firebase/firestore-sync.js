// firebase/firestore-sync.js
// Non-module sync adapter that bridges EduCareAdmin local store and Firestore.
(function(){
  function waitFor(cond, cb, interval=200, timeout=15000){
    const start = Date.now();
    const t = setInterval(()=>{
      if(cond()){ clearInterval(t); cb(); }
      else if(Date.now()-start > timeout){ clearInterval(t); console.warn('waitFor timeout'); }
    }, interval);
  }

  waitFor(()=> window.__EDUCARE_FIREBASE && window.EduCareAdmin, () => {
    const fb = window.__EDUCARE_FIREBASE;
    const db = fb.db;
    if(!db){ console.warn('Firestore not available on window.__EDUCARE_FIREBASE.db'); return; }

    function toDoc(obj){
      // shallow clone to remove methods and prototypes
      try{ return JSON.parse(JSON.stringify(obj)); }catch(e){ return Object.assign({}, obj); }
    }

    // Upsert document by id with quota-exhausted handling
    let __EDUCARE_FIRESTORE_EXHAUSTED = false;

    function showFirestoreBanner(){
      try{
        if(document.getElementById('edu-firestore-warning')) return;
        const el = document.createElement('div');
        el.id = 'edu-firestore-warning';
        el.style.cssText = 'position:fixed;right:18px;bottom:18px;background:#fffbeb;color:#92400e;padding:12px 16px;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,0.18);z-index:99999;font-family:Poppins,Arial,sans-serif;max-width:320px';
        el.innerHTML = '<strong>Firestore quota reached</strong><div style="font-size:13px;margin-top:6px;color:#7c2d12">Writes are temporarily suspended. Changes will continue locally.</div><div style="margin-top:8px;text-align:right"><button id="edu-firestore-retry" style="background:#ffffff;border:1px solid #e5e7eb;padding:6px 10px;border-radius:6px;cursor:pointer;font-size:13px">Retry</button> <button id="edu-firestore-dismiss" style="background:transparent;border:0;color:#7c2d12;padding:6px 8px;cursor:pointer;font-size:13px">Dismiss</button></div>';
        document.body.appendChild(el);
        try{
          const retryBtn = el.querySelector('#edu-firestore-retry');
          const disBtn = el.querySelector('#edu-firestore-dismiss');
          if(retryBtn){ retryBtn.addEventListener('click', ()=>{ try{ if(typeof window.__EDUCARE_FIRESTORE_TRY_PROBE === 'function') window.__EDUCARE_FIRESTORE_TRY_PROBE(); }catch(_){}}); }
          if(disBtn){ disBtn.addEventListener('click', ()=>{ try{ el.remove(); }catch(_){}}); }
        }catch(e){}
      }catch(e){}
    }

    // Pending writes queue persisted to localStorage as a safety fallback when Firestore is unavailable.
    const PENDING_KEY = 'educare_pending_writes_v1';
    function loadPendingWrites(){
      try{ const s = localStorage.getItem(PENDING_KEY); return s? JSON.parse(s) : []; }catch(e){ return []; }
    }
    function savePendingWrites(arr){
      try{ localStorage.setItem(PENDING_KEY, JSON.stringify(arr||[])); }catch(e){}
    }
    function addPendingWrite(collectionName, id, data){
      try{
        const arr = loadPendingWrites();
        // replace existing entry for same collection+id
        const key = collectionName+ '::' + String(id);
        const filtered = arr.filter(x=> x.key !== key);
        filtered.push({ key, collectionName, id: String(id), data: toDoc(data), at: Date.now() });
        savePendingWrites(filtered);
        try{ window.__EDUCARE_PENDING_WRITES_COUNT = filtered.length; }catch(_){}
      }catch(e){ console.warn('addPendingWrite failed', e); }
    }
    function removePendingWrite(collectionName, id){
      try{
        const key = collectionName+ '::' + String(id);
        const arr = loadPendingWrites().filter(x=> x.key !== key);
        savePendingWrites(arr);
        try{ window.__EDUCARE_PENDING_WRITES_COUNT = arr.length; }catch(_){}
      }catch(e){ console.warn('removePendingWrite failed', e); }
    }

    async function flushPendingWrites(){
      try{
        if(__EDUCARE_FIRESTORE_EXHAUSTED) return; // don't flush while exhausted
        const arr = loadPendingWrites();
        if(!arr || !arr.length) return;
        console.info('Flushing', arr.length, 'pending writes to Firestore');
        for(const item of arr.slice()){
          try{
            await fb.setDocById(item.collectionName, item.id, item.data);
            removePendingWrite(item.collectionName, item.id);
          }catch(e){
            console.warn('flushPendingWrites: write failed for', item.collectionName, item.id, e);
            // detect quota exhaustion
            const msg = (e && (e.code || e.message || '') + '').toLowerCase();
            if(msg.includes('resource-exhausted') || msg.includes('quota exceeded') || msg.includes('exceeded')){
              __EDUCARE_FIRESTORE_EXHAUSTED = true;
              try{ window.__EDUCARE_FIRESTORE_EXHAUSTED = true; }catch(_){}
              showFirestoreBanner();
              return;
            }
            // leave the item in the queue and continue to next; we'll retry later
          }
        }
      }catch(e){ console.warn('flushPendingWrites error', e); }
    }

    // Upsert document by id
    async function upsertDoc(collectionName, id, data){
      if(!id) return null;
      if(__EDUCARE_FIRESTORE_EXHAUSTED) return false; // avoid attempts when exhausted
      try{
        await fb.setDocById(collectionName, id, toDoc(data));
        // on success, remove any pending write for this doc
        try{ removePendingWrite(collectionName, id); }catch(_){}
        return true;
      }catch(e){
        console.warn('upsertDoc failed', e);
        // detect Firestore quota / resource exhausted and stop further writes
        const msg = (e && (e.code || e.message || '') + '').toLowerCase();
        if(msg.includes('resource-exhausted') || msg.includes('quota exceeded') || msg.includes('exceeded')){
          __EDUCARE_FIRESTORE_EXHAUSTED = true;
          try{ window.__EDUCARE_FIRESTORE_EXHAUSTED = true; }catch(_){ }
          showFirestoreBanner();
          // enqueue pending write for later flush
          try{ addPendingWrite(collectionName, id, data); }catch(_){}
        } else {
          // for other write failures, also enqueue as a precaution (network hiccup)
          try{ addPendingWrite(collectionName, id, data); }catch(_){}
        }
        return false;
      }
    }

    // Listen for local store updates and push the canonical store to Firestore.
    // Note: EduCareAdmin.onStoreUpdated() signals that something changed but does not provide
    // the changed payload (it calls the handler with no args). So we read the full store
    // and synchronize its collections to Firestore (upsert + delete as needed).
    try{
      // Debounced sync: collect rapid updates and sync after short delay to avoid frequent writes
      let pendingSyncTimer = null;
      const SYNC_DEBOUNCE_MS = 1200;

      async function syncStoreNow(){
        try{
          if(__EDUCARE_FIRESTORE_EXHAUSTED){ console.warn('Skipping sync: firestore exhausted'); return; }
          const s = window.EduCareAdmin.getStore();
          if(!s) return;

          // Collections to sync: users.<role> -> role, plus top-level arrays like sessions, uploads
          const newDataMap = {};

          // users object: students, parents, counselors, admins, training_examples
          if(s.users && typeof s.users === 'object'){
            Object.keys(s.users).forEach(role => {
              const arr = Array.isArray(s.users[role]) ? s.users[role] : [];
              newDataMap[role] = {};
              arr.forEach(item => { if(item && item.id) newDataMap[role][String(item.id)] = item; });
            });
          }

          // top-level collections
          const topCols = ['sessions','uploads','training_examples'];
          topCols.forEach(col => {
            const arr = Array.isArray(s[col]) ? s[col] : [];
            if(arr.length){ newDataMap[col] = {}; arr.forEach(item => { if(item && item.id) newDataMap[col][String(item.id)] = item; }); }
          });

          // For each collection, upsert current docs and remove deleted ones
          for(const col of Object.keys(newDataMap)){
            const map = newDataMap[col] || {};
            // upsert all current items
            for(const id of Object.keys(map)){
              try{ await upsertDoc(col, id, map[id]); }catch(e){ console.warn('failed upsert in sync loop', col, id, e); }
            }
            // remove docs that existed in cache but not in current map
            const prev = cache[col] || {};
            for(const pid of Object.keys(prev)){
              if(!map[pid]){
                try{ await fb.deleteDocById(col, pid); }catch(e){ console.warn('failed to delete remote doc', col, pid, e); }
              }
            }
            cache[col] = map;
          }
        }catch(e){ console.warn('onStoreUpdated handler error', e); }
      }

      function scheduleSync(){
        if(pendingSyncTimer) clearTimeout(pendingSyncTimer);
        pendingSyncTimer = setTimeout(()=>{ pendingSyncTimer = null; syncStoreNow(); }, SYNC_DEBOUNCE_MS);
      }

      window.EduCareAdmin.onStoreUpdated(() => {
        scheduleSync();
      });

      // Probe / Retry logic: attempt a lightweight read to detect recovery from quota errors.
      let probeTimer = null;
      let probeInFlight = false;
      const PROBE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

      async function tryProbe(){
        if(probeInFlight) return;
        probeInFlight = true;
        try{
          console.info('Attempting Firestore probe...');
          // lightweight read - request a single collection list
          await fb.listCollection('students');
          // if succeeded, clear exhausted flag and remove banner
          __EDUCARE_FIRESTORE_EXHAUSTED = false;
          try{ window.__EDUCARE_FIRESTORE_EXHAUSTED = false; }catch(_){}
          const b = document.getElementById('edu-firestore-warning'); if(b) b.remove();
          console.info('Firestore probe succeeded, resuming sync');
          // attempt an immediate sync
          try{ scheduleSync(); }catch(e){}
        }catch(err){
          console.warn('Firestore probe failed', err);
        }finally{ probeInFlight = false; }
      }

      // expose probe for the banner button to call
      try{ window.__EDUCARE_FIRESTORE_TRY_PROBE = tryProbe; }catch(_){}

      // start a periodic probe that runs while exhausted is true
      probeTimer = setInterval(()=>{ if(__EDUCARE_FIRESTORE_EXHAUSTED){ tryProbe(); } }, PROBE_INTERVAL_MS);
    }catch(e){ console.warn('Failed to attach onStoreUpdated', e); }

    // Listen to Firestore collections and mirror into local store
  // Collections to listen to from Firestore and mirror back into the local store.
  const collections = ['students','parents','counselors','admins','sessions','uploads','training_examples'];
    const cache = {};
    const pollingTimers = {};

    function applyDocToStore(collectionName, id, data){
      try{
        // If a local tombstone exists for this id, avoid re-adding it from remote snapshots.
        try{
          const store = (window.EduCareAdmin && typeof window.EduCareAdmin.getStore === 'function') ? window.EduCareAdmin.getStore() : null;
          if(store && store.meta && store.meta.deleted && Array.isArray(store.meta.deleted[collectionName]) && store.meta.deleted[collectionName].includes(String(id))){
            // best-effort: ask backend to delete remote doc (if API available) and skip applying this doc
            try{ if(window.__EDUCARE_FIREBASE && typeof window.__EDUCARE_FIREBASE.deleteDocById === 'function'){ window.__EDUCARE_FIREBASE.deleteDocById(collectionName, id).catch(()=>{}); } }catch(_){ }
            return;
          }
        }catch(_){ }
        const userCollections = ['students','parents','counselors','admins'];
        const topCollections = ['sessions','uploads','training_examples'];

        // Helper: consider a doc meaningful if it contains at least one non-empty value
        function isMeaningful(obj){
          if(!obj || typeof obj !== 'object') return false;
          return Object.keys(obj).some(k => {
            const v = obj[k];
            if(v === null || v === undefined) return false;
            if(typeof v === 'string') return v.trim() !== '';
            if(Array.isArray(v)) return v.length > 0;
            if(typeof v === 'object') return Object.keys(v).length > 0;
            return true; // numbers, booleans
          });
        }

        if(userCollections.includes(collectionName)){
          // avoid creating empty/placeholder user docs that sometimes appear after server-side writes
          if(!isMeaningful(data)){
            console.warn('Skipping creation of empty remote user doc:', collectionName, id);
            return;
          }
          const existing = (window.EduCareAdmin.getById && window.EduCareAdmin.getById(collectionName, id)) || null;
          if(existing){ window.EduCareAdmin.update(collectionName, id, data); }
          else { window.EduCareAdmin.create(collectionName, Object.assign({ id }, data)); }
          return;
        }

        // Top-level collections (not under s.users)
        if(topCollections.includes(collectionName)){
          // also avoid creating entirely empty docs
          if(!isMeaningful(data)){
            console.warn('Skipping creation of empty top-level doc:', collectionName, id);
            return;
          }
          try{
            const store = window.EduCareAdmin.getStore() || {};
            store[collectionName] = Array.isArray(store[collectionName]) ? store[collectionName] : [];
            const idx = store[collectionName].findIndex(x => String(x.id) === String(id));
            if(idx !== -1){ store[collectionName][idx] = { ...store[collectionName][idx], ...data, id }; }
            else { store[collectionName].push(Object.assign({ id }, data)); }
            window.EduCareAdmin.setStore(store);
          }catch(e){ console.warn('applyDocToStore (top collection) failed', e); }
          return;
        }

        // Fallback: attempt to create under users if sensible
        const existing = (window.EduCareAdmin.getById && window.EduCareAdmin.getById(collectionName, id)) || null;
        if(existing){ window.EduCareAdmin.update(collectionName, id, data); }
        else { window.EduCareAdmin.create(collectionName, Object.assign({ id }, data)); }
      }catch(e){ console.warn('apply snapshot to store failed', e); }
    }

    async function pollCollectionOnce(col){
      try{
        const docs = await fb.listCollection(col);
        const newMap = {};
        docs.forEach(d=> newMap[d.id] = d.data);

        const prevMap = cache[col] || {};

        // detect added / updated
        for(const id of Object.keys(newMap)){
          const nd = newMap[id];
          const pd = prevMap[id];
          if(!pd){ // added
            applyDocToStore(col, id, nd);
          } else {
            try{
              const a = JSON.stringify(pd);
              const b = JSON.stringify(nd);
              if(a !== b){ applyDocToStore(col, id, nd); }
            }catch(e){ applyDocToStore(col, id, nd); }
          }
        }

        // detect removed
        for(const id of Object.keys(prevMap)){
          if(!newMap[id]){
            try{ window.EduCareAdmin.remove(col, id); }catch(e){ console.warn('remove failed', e); }
          }
        }

        cache[col] = newMap;
      }catch(e){ console.warn('pollCollectionOnce failed for', col, e); }
    }

    function startPolling(col){
      if(pollingTimers[col]) return; // already polling
      console.warn('Starting polling fallback for', col);
      // initial immediate poll
      pollCollectionOnce(col);
      pollingTimers[col] = setInterval(()=> pollCollectionOnce(col), 5000);
    }

    collections.forEach(col => {
      try{
        // subscribe with an error callback that will trigger polling fallback
        fb.onCollectionSnapshot(col, (snapshot) => {
          // update cache and apply changes
          const newMap = {};
          snapshot.docs.forEach(d => { newMap[d.id] = d.data(); });
          cache[col] = newMap;

          snapshot.docChanges().forEach(change => {
            const id = change.doc.id;
            const data = change.doc.data();
            if(change.type === 'removed'){
              try{
                const userCollections = ['students','parents','counselors','admins'];
                const topCollections = ['sessions','uploads','training_examples'];
                if(userCollections.includes(col)){
                  window.EduCareAdmin.remove(col, id);
                } else if(topCollections.includes(col)){
                  try{
                    const store = window.EduCareAdmin.getStore() || {};
                    store[col] = (Array.isArray(store[col]) ? store[col] : []).filter(x => String(x.id) !== String(id));
                    window.EduCareAdmin.setStore(store);
                  }catch(e){ console.warn('failed to remove top-level doc from store', col, id, e); }
                } else {
                  // fallback
                  try{ window.EduCareAdmin.remove(col, id); }catch(e){}
                }
              }catch(e){ console.warn('remove failed', e); }
            } else {
              applyDocToStore(col, id, data);
            }
          });
        }, (err)=>{ console.warn('Firestore snapshot error for', col, err); startPolling(col); });
      }catch(e){ console.warn('subscribe failed for', col, e); startPolling(col); }
    });

    console.info('Firestore sync adapter initialized');
  });
})();
