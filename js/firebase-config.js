/**
 * Firebase Realtime & Firestore Cloud Sync Layer - Al-Mustaqbal System
 * Project: attend-b33db
 * Developer: Eng. Ahmed Mourad
 */

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCTjPPhlVqd8XJJL3D6z_eKAO_FAuV5u70",
  authDomain: "attend-b33db.firebaseapp.com",
  databaseURL: "https://attend-b33db-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "attend-b33db",
  storageBucket: "attend-b33db.firebasestorage.app",
  messagingSenderId: "1022037718825",
  appId: "1:1022037718825:web:3a91171ad3287cb9e02938",
  measurementId: "G-F0SMCG0YT9"
};

class CloudStore {
  constructor() {
    this.isFirebaseReady = false;
    this.rtdb = null;
    this.firestoreDb = null;
    this.subscribers = [];
    this.serverTimeOffset = 0;
    this.isProcessingSync = false;
    this.config = this.loadStoredConfig() || DEFAULT_FIREBASE_CONFIG;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.processPendingSync());
    }
    this.initFirebase();
  }

  getServerNow() {
    const offset = typeof this.serverTimeOffset === 'number' ? this.serverTimeOffset : 0;
    return new Date(Date.now() + offset);
  }

  loadStoredConfig() {
    try {
      const saved = localStorage.getItem('almustaqbal_firebase_config');
      return saved ? JSON.parse(saved) : DEFAULT_FIREBASE_CONFIG;
    } catch (e) {
      return DEFAULT_FIREBASE_CONFIG;
    }
  }

  saveConfig(configObject) {
    localStorage.setItem('almustaqbal_firebase_config', JSON.stringify(configObject));
    this.config = configObject;
    return this.initFirebase();
  }

  initFirebase() {
    if (!this.config || !this.config.apiKey) {
      this.isFirebaseReady = false;
      return false;
    }

    try {
      if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
          firebase.initializeApp(this.config);
        }

        // 1. Initialize Realtime Database (Primary for attend-b33db)
        if (typeof firebase.database === 'function') {
          try {
            this.rtdb = firebase.database();
            this.isFirebaseReady = true;
            console.log('✅ Connected to Firebase Realtime Database:', this.config.databaseURL);
            this.processPendingSync();
          } catch (rtdbErr) {
            console.warn('Realtime Database init warning:', rtdbErr);
          }
        }

        // 2. Initialize Firestore as optional fallback
        if (typeof firebase.firestore === 'function') {
          try {
            this.firestoreDb = firebase.firestore();
          } catch (fsErr) {
            console.warn('Firestore optional warning:', fsErr);
          }
        }

        this.startRealtimeListeners();
        return true;
      }
    } catch (err) {
      console.warn('Firebase initialization notice (running offline first):', err);
      this.isFirebaseReady = false;
      return false;
    }
    return false;
  }

  onSync(callback) {
    this.subscribers.push(callback);
  }

  notifySubscribers(type, data) {
    this.subscribers.forEach(cb => {
      try { cb(type, data); } catch (e) { console.error(e); }
    });
  }

  startRealtimeListeners() {
    if (!this.isFirebaseReady) return;

    // A. Realtime Database Listeners
    if (this.rtdb) {
      try {
        // Attendance records listener
        this.rtdb.ref('attendance').on('value', snapshot => {
          const val = snapshot.val();
          if (val === null) {
            // Safe handling: never wipe local data when snapshot is null
            return;
          }
          const recordsMap = new Map();
          Object.values(val).forEach(r => { if (r && r.id) recordsMap.set(r.id, r); });

          // Merge pending queue items on top of server snapshot
          const queue = this.getPendingQueue();
          queue.forEach(item => {
            if (item.type === 'saveAttendance' && item.data && item.data.id) {
              recordsMap.set(item.data.id, item.data);
            } else if (item.type === 'deleteAttendance' && item.data) {
              recordsMap.delete(item.data);
            }
          });

          const records = Array.from(recordsMap.values());
          localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));
          this.notifySubscribers('attendance', records);
        }, err => console.warn('RTDB attendance listener notice:', err));

        // Employees listener
        this.rtdb.ref('employees').on('value', snapshot => {
          const val = snapshot.val();
          if (val === null) {
            // Safe handling: never wipe local data when snapshot is null
            return;
          }
          const empsMap = new Map();
          Object.values(val).forEach(e => { if (e && e.id) empsMap.set(e.id, e); });

          // Merge pending queue items on top of server snapshot
          const queue = this.getPendingQueue();
          queue.forEach(item => {
            if (item.type === 'saveEmployee' && item.data && item.data.id) {
              empsMap.set(item.data.id, item.data);
            } else if (item.type === 'deleteEmployee' && item.data) {
              empsMap.delete(item.data);
            }
          });

          const emps = Array.from(empsMap.values());
          localStorage.setItem('almustaqbal_employees', JSON.stringify(emps));
          this.notifySubscribers('employees', emps);
        }, err => console.warn('RTDB employees listener notice:', err));

        // Settings / Admin PIN listener
        this.rtdb.ref('settings/admin_pin').on('value', snapshot => {
          const pin = snapshot.val();
          if (pin) {
            localStorage.setItem('almustaqbal_admin_pin', pin);
            this.notifySubscribers('admin_pin', pin);
          }
        }, err => console.warn('RTDB settings listener notice:', err));

        // Server Time Offset listener (.info/serverTimeOffset)
        this.rtdb.ref('.info/serverTimeOffset').on('value', snapshot => {
          const offset = snapshot.val();
          if (typeof offset === 'number') {
            this.serverTimeOffset = offset;
          }
        }, err => console.warn('RTDB serverTimeOffset listener notice:', err));

        return; // RTDB active
      } catch (e) {
        console.warn('RTDB listen error:', e);
      }
    }

    // B. Firestore fallback listeners (if RTDB not used)
    if (this.firestoreDb) {
      try {
        this.firestoreDb.collection('attendance').onSnapshot(snapshot => {
          const records = [];
          snapshot.forEach(doc => records.push({ id: doc.id, ...doc.data() }));
          localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));
          this.notifySubscribers('attendance', records);
        }, err => console.warn('Firestore attendance notice:', err));

        this.firestoreDb.collection('employees').onSnapshot(snapshot => {
          const emps = [];
          snapshot.forEach(doc => emps.push({ id: doc.id, ...doc.data() }));
          localStorage.setItem('almustaqbal_employees', JSON.stringify(emps));
          this.notifySubscribers('employees', emps);
        }, err => console.warn('Firestore employees notice:', err));
      } catch (e) {}
    }
  }

  getPendingQueue() {
    try {
      const q = localStorage.getItem('almustaqbal_pending_sync');
      return q ? JSON.parse(q) : [];
    } catch (e) {
      return [];
    }
  }

  savePendingQueue(queue) {
    try {
      localStorage.setItem('almustaqbal_pending_sync', JSON.stringify(queue));
    } catch (e) {
      console.warn('Error saving pending sync queue:', e);
    }
  }

  enqueuePending(type, data) {
    const queue = this.getPendingQueue();
    const existingIdx = queue.findIndex(item => item.type === type && JSON.stringify(item.data) === JSON.stringify(data));
    if (existingIdx >= 0) {
      queue[existingIdx] = { id: queue[existingIdx].id, type, data, createdAt: new Date().toISOString() };
    } else {
      queue.push({
        id: 'sync_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        type,
        data,
        createdAt: new Date().toISOString()
      });
    }
    this.savePendingQueue(queue);
  }

  dequeuePending(id) {
    const queue = this.getPendingQueue().filter(item => item.id !== id);
    this.savePendingQueue(queue);
  }

  async processPendingSync() {
    if (this.isProcessingSync || !this.rtdb || !this.isFirebaseReady) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const queue = this.getPendingQueue();
    if (queue.length === 0) return;

    this.isProcessingSync = true;
    try {
      for (const item of queue) {
        try {
          if (item.type === 'saveAttendance') {
            await this.rtdb.ref(`attendance/${item.data.id}`).set(item.data);
          } else if (item.type === 'deleteAttendance') {
            await this.rtdb.ref(`attendance/${item.data}`).remove();
          } else if (item.type === 'saveEmployee') {
            await this.rtdb.ref(`employees/${item.data.id}`).set(item.data);
          } else if (item.type === 'deleteEmployee') {
            await this.rtdb.ref(`employees/${item.data}`).remove();
          } else if (item.type === 'saveAdminPin') {
            await this.rtdb.ref('settings/admin_pin').set(item.data);
          }
          this.dequeuePending(item.id);
        } catch (itemErr) {
          console.warn('Sync queue item failed, pausing retry:', itemErr);
          break;
        }
      }
    } finally {
      this.isProcessingSync = false;
    }
  }

  // Read server copy with a 3-second timeout (fallback to local if offline/timeout)
  fetchAttendanceRecord(recordId) {
    if (!this.rtdb || !this.isFirebaseReady) {
      return Promise.resolve(null);
    }
    return new Promise(resolve => {
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 3000);

      this.rtdb.ref(`attendance/${recordId}`).once('value').then(snapshot => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(snapshot.val());
        }
      }).catch(err => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          resolve(null);
        }
      });
    });
  }

  // Create new check-in record using RTDB transaction only if node is null
  createAttendanceRecordTransaction(record) {
    let records = JSON.parse(localStorage.getItem('almustaqbal_attendance_records') || '[]');
    const existingIndex = records.findIndex(r => r.id === record.id);
    if (existingIndex >= 0) {
      records[existingIndex] = record;
    } else {
      records.unshift(record);
    }
    localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));

    if (this.rtdb && this.isFirebaseReady) {
      return this.rtdb.ref(`attendance/${record.id}`).transaction(currentData => {
        if (currentData === null) {
          return record;
        }
        return; // Abort transaction if node already exists
      }).then(result => {
        if (!result.committed && result.snapshot && result.snapshot.val()) {
          const serverRec = result.snapshot.val();
          return { committed: false, existingRecord: serverRec, records };
        }
        return { committed: true, record, records };
      }).catch(err => {
        console.warn('RTDB transaction error:', err);
        this.enqueuePending('saveAttendance', record);
        return Promise.reject(err);
      });
    }

    this.enqueuePending('saveAttendance', record);
    return Promise.reject(new Error('OFFLINE_QUEUED'));
  }

  // Attendance Save returning real Promise
  saveAttendanceRecord(record) {
    let records = JSON.parse(localStorage.getItem('almustaqbal_attendance_records') || '[]');
    const existingIndex = records.findIndex(r => r.id === record.id);
    if (existingIndex >= 0) {
      records[existingIndex] = record;
    } else {
      records.unshift(record);
    }
    localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));

    if (this.rtdb && this.isFirebaseReady) {
      return this.rtdb.ref(`attendance/${record.id}`).set(record).catch(err => {
        console.warn('Cloud sync error, queued for retry:', err);
        this.enqueuePending('saveAttendance', record);
        return Promise.reject(err);
      });
    }

    this.enqueuePending('saveAttendance', record);
    return Promise.reject(new Error('OFFLINE_QUEUED'));
  }

  // Attendance Delete returning real Promise
  deleteAttendanceRecord(recordId) {
    let records = JSON.parse(localStorage.getItem('almustaqbal_attendance_records') || '[]');
    records = records.filter(r => r.id !== recordId);
    localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));

    if (this.rtdb && this.isFirebaseReady) {
      return this.rtdb.ref(`attendance/${recordId}`).remove().catch(err => {
        console.warn('Cloud delete error, queued for retry:', err);
        this.enqueuePending('deleteAttendance', recordId);
        return Promise.reject(err);
      });
    }

    this.enqueuePending('deleteAttendance', recordId);
    return Promise.reject(new Error('OFFLINE_QUEUED'));
  }

  // Employee Save returning real Promise
  saveEmployee(emp) {
    let employees = JSON.parse(localStorage.getItem('almustaqbal_employees') || '[]');
    const existingIndex = employees.findIndex(e => e.id === emp.id);
    if (existingIndex >= 0) {
      employees[existingIndex] = emp;
    } else {
      employees.push(emp);
    }
    localStorage.setItem('almustaqbal_employees', JSON.stringify(employees));

    if (this.rtdb && this.isFirebaseReady) {
      return this.rtdb.ref(`employees/${emp.id}`).set(emp).catch(err => {
        console.warn('Cloud employee save error, queued for retry:', err);
        this.enqueuePending('saveEmployee', emp);
        return Promise.reject(err);
      });
    }

    this.enqueuePending('saveEmployee', emp);
    return Promise.reject(new Error('OFFLINE_QUEUED'));
  }

  // Employee Delete returning real Promise
  deleteEmployee(empId) {
    let employees = JSON.parse(localStorage.getItem('almustaqbal_employees') || '[]');
    employees = employees.filter(e => e.id !== empId);
    localStorage.setItem('almustaqbal_employees', JSON.stringify(employees));

    if (this.rtdb && this.isFirebaseReady) {
      return this.rtdb.ref(`employees/${empId}`).remove().catch(err => {
        console.warn('Cloud employee delete error, queued for retry:', err);
        this.enqueuePending('deleteEmployee', empId);
        return Promise.reject(err);
      });
    }

    this.enqueuePending('deleteEmployee', empId);
    return Promise.reject(new Error('OFFLINE_QUEUED'));
  }

  // Save Admin PIN returning real Promise
  saveAdminPin(newPin) {
    localStorage.setItem('almustaqbal_admin_pin', newPin);

    if (this.rtdb && this.isFirebaseReady) {
      return this.rtdb.ref('settings/admin_pin').set(newPin).catch(err => {
        console.warn('Cloud save pin error, queued for retry:', err);
        this.enqueuePending('saveAdminPin', newPin);
        return Promise.reject(err);
      });
    }

    this.enqueuePending('saveAdminPin', newPin);
    return Promise.reject(new Error('OFFLINE_QUEUED'));
  }
}

window.cloudStore = new CloudStore();
