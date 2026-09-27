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
    this.config = this.loadStoredConfig() || DEFAULT_FIREBASE_CONFIG;
    this.initFirebase();
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
          if (val) {
            const records = Object.values(val);
            localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));
            this.notifySubscribers('attendance', records);
          }
        }, err => console.warn('RTDB attendance listener notice:', err));

        // Employees listener
        this.rtdb.ref('employees').on('value', snapshot => {
          const val = snapshot.val();
          if (val) {
            const emps = Object.values(val);
            localStorage.setItem('almustaqbal_employees', JSON.stringify(emps));
            this.notifySubscribers('employees', emps);
          }
        }, err => console.warn('RTDB employees listener notice:', err));

        // Settings / Admin PIN listener
        this.rtdb.ref('settings/admin_pin').on('value', snapshot => {
          const pin = snapshot.val();
          if (pin) {
            localStorage.setItem('almustaqbal_admin_pin', pin);
            this.notifySubscribers('admin_pin', pin);
          }
        }, err => console.warn('RTDB settings listener notice:', err));

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

  // Non-blocking Attendance Save
  saveAttendanceRecord(record) {
    // 1. Instant Local Storage Update (0ms, 100% reliable)
    let records = JSON.parse(localStorage.getItem('almustaqbal_attendance_records') || '[]');
    const existingIndex = records.findIndex(r => r.id === record.id);
    if (existingIndex >= 0) {
      records[existingIndex] = record;
    } else {
      records.unshift(record);
    }
    localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));

    // 2. Background Cloud Sync (Non-blocking)
    setTimeout(() => {
      try {
        if (this.rtdb) {
          this.rtdb.ref(`attendance/${record.id}`).set(record);
        } else if (this.firestoreDb) {
          this.firestoreDb.collection('attendance').doc(record.id).set(record, { merge: true });
        }
      } catch (err) {
        console.warn('Cloud sync background error:', err);
      }
    }, 10);

    return Promise.resolve(records);
  }

  // Non-blocking Attendance Delete
  deleteAttendanceRecord(recordId) {
    let records = JSON.parse(localStorage.getItem('almustaqbal_attendance_records') || '[]');
    records = records.filter(r => r.id !== recordId);
    localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));

    setTimeout(() => {
      try {
        if (this.rtdb) {
          this.rtdb.ref(`attendance/${recordId}`).remove();
        } else if (this.firestoreDb) {
          this.firestoreDb.collection('attendance').doc(recordId).delete();
        }
      } catch (err) {
        console.warn('Cloud delete background error:', err);
      }
    }, 10);

    return Promise.resolve(records);
  }

  // Non-blocking Employee Save
  saveEmployee(emp) {
    // 1. Instant Local Storage Update
    let employees = JSON.parse(localStorage.getItem('almustaqbal_employees') || '[]');
    const existingIndex = employees.findIndex(e => e.id === emp.id);
    if (existingIndex >= 0) {
      employees[existingIndex] = emp;
    } else {
      employees.push(emp);
    }
    localStorage.setItem('almustaqbal_employees', JSON.stringify(employees));

    // 2. Background Cloud Sync
    setTimeout(() => {
      try {
        if (this.rtdb) {
          this.rtdb.ref(`employees/${emp.id}`).set(emp);
        } else if (this.firestoreDb) {
          this.firestoreDb.collection('employees').doc(emp.id).set(emp, { merge: true });
        }
      } catch (err) {
        console.warn('Cloud save employee error:', err);
      }
    }, 10);

    return Promise.resolve(employees);
  }

  // Non-blocking Employee Delete
  deleteEmployee(empId) {
    let employees = JSON.parse(localStorage.getItem('almustaqbal_employees') || '[]');
    employees = employees.filter(e => e.id !== empId);
    localStorage.setItem('almustaqbal_employees', JSON.stringify(employees));

    setTimeout(() => {
      try {
        if (this.rtdb) {
          this.rtdb.ref(`employees/${empId}`).remove();
        } else if (this.firestoreDb) {
          this.firestoreDb.collection('employees').doc(empId).delete();
        }
      } catch (err) {
        console.warn('Cloud delete employee error:', err);
      }
    }, 10);

    return Promise.resolve(employees);
  }

  // Save Admin PIN in Cloud & Local
  saveAdminPin(newPin) {
    localStorage.setItem('almustaqbal_admin_pin', newPin);

    setTimeout(() => {
      try {
        if (this.rtdb) {
          this.rtdb.ref('settings/admin_pin').set(newPin);
        } else if (this.firestoreDb) {
          this.firestoreDb.collection('settings').doc('admin_auth').set({
            pin: newPin,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        }
      } catch (err) {
        console.warn('Cloud save pin error:', err);
      }
    }, 10);

    return Promise.resolve(newPin);
  }
}

window.cloudStore = new CloudStore();
