// firebase/firebase-init.js
// Module-style initializer for Firebase (loaded with type="module").
// This file initializes Firebase and exposes a small wrapper on window.__EDUCARE_FIREBASE
// so non-module scripts (your existing admin scripts) can use Firestore helper methods.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js';
// Note: analytics dynamic config fetch can trigger Google APIs usage checks and 403 warnings
// in some projects. Analytics is optional for the prototype; we avoid calling getAnalytics
// here to prevent runtime 403 logs in the browser during local development.
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { getFirestore, collection, doc, setDoc, addDoc, onSnapshot, deleteDoc, getDocs } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js';

// Replace with your Firebase configuration (from the console)
const firebaseConfig = {
  // NOTE: apiKey is a public-facing config value for Firebase Web SDKs.
  // Keep server-side secrets (service account JSON) out of the repo. The user requested
  // this API key be added here so the client Firebase initialization uses it.
  apiKey: "AIzaSyBUJdbRr70DLH4m5GshFmeJ5uuAm1i_5cg",
  authDomain: "educare-2025-6383b.firebaseapp.com",
  projectId: "educare-2025-6383b",
  storageBucket: "educare-2025-6383b.firebasestorage.app",
  messagingSenderId: "949866669779",
  appId: "1:949866669779:web:094c440558cde9b95c1626",
  measurementId: "G-9L5FEPDHCW"
};

const app = initializeApp(firebaseConfig);
// We intentionally do not initialize analytics by default to avoid dynamic config fetches
// that may require enabling the Firebase Management API in the GCP console.
let analytics = null;
const auth = getAuth(app);
const db = getFirestore(app);

// Lightweight wrapper helpers exposed to non-module scripts
window.__EDUCARE_FIREBASE = {
  app,
  analytics,
  auth,
  db,
  // create or merge a document with a provided id
  setDocById: async (colName, id, data) => {
    try{
      await setDoc(doc(db, colName, String(id)), data, { merge: true });
      return true;
    }catch(e){ console.warn('setDocById failed', e); return false; }
  },
  addDoc: async (colName, data) => {
    try{ const ref = await addDoc(collection(db, colName), data); return ref.id; }catch(e){ console.warn('addDoc failed', e); return null; }
  },
  onCollectionSnapshot: (colName, cb, errCb) => {
    try{ return onSnapshot(collection(db, colName), cb, errCb); }catch(e){ console.warn('onCollectionSnapshot failed', e); return ()=>{}; }
  },
  // list documents in a collection once (used for polling fallback)
  listCollection: async (colName) => {
    try{
      const snap = await getDocs(collection(db, colName));
      return snap.docs.map(d => ({ id: d.id, data: d.data() }));
    }catch(e){ console.warn('listCollection failed', e); return []; }
  },
  deleteDocById: async (colName, id) => { try{ await deleteDoc(doc(db, colName, String(id))); return true; }catch(e){ console.warn('deleteDoc failed', e); return false; } }
};

console.info('Firebase initialized (module) and window.__EDUCARE_FIREBASE is available');
