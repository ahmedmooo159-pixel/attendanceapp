/**
 * Firebase Firestore & Realtime Sync Layer - Al-Mustaqbal System
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
    this.db = null;
    this.subscribers = [];
    this.config = this.loadStoredConfig() || DEFAULT_FIREBASE_CONFIG;
    this.initFirebase();
  }

  loadStoredConfig() {
    try {
      const saved = localStorage.getItem('almustaqbal_firebase_config');
      return saved ? JSON.parse(saved) : DEFAULT_FIREBASE_CONFIG;
    } catch (e) {
      console.warn('Error loading firebase config from storage:', e);
      return DEFAULT_FIREBASE_CONFIG;
    }
  }

  saveConfig(configObject) {
    localStorage.setItem('almustaqbal_firebase_config', JSON.stringify(configObject));
    this.config = configObject;
    return this.initFirebase();
  }

  initFirebase() {
    if (!this.config || !this.config.apiKey || !this.config.projectId) {
      console.log('Running in Local Offline Mode');
      this.isFirebaseReady = false;
      return false;
    }

    try {
      if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
          firebase.initializeApp(this.config);
        }
        this.db = firebase.firestore();
        this.isFirebaseReady = true;
        console.log('✅ Firebase Firestore connected successfully to project:', this.config.projectId);
        this.startRealtimeListeners();
        return true;
      }
    } catch (err) {
      console.error('Firebase initialization error:', err);
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
    if (!this.isFirebaseReady || !this.db) return;

    // 1. Listen to attendance updates in real time
    this.db.collection('attendance').onSnapshot(snapshot => {
      const records = [];
      snapshot.forEach(doc => {
        records.push({ id: doc.id, ...doc.data() });
      });
      localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));
      this.notifySubscribers('attendance', records);
    }, err => {
      console.warn('Firestore attendance listen error:', err);
    });

    // 2. Listen to employees updates in real time
    this.db.collection('employees').onSnapshot(snapshot => {
      const emps = [];
      snapshot.forEach(doc => {
        emps.push({ id: doc.id, ...doc.data() });
      });
      localStorage.setItem('almustaqbal_employees', JSON.stringify(emps));
      this.notifySubscribers('employees', emps);
    }, err => {
      console.warn('Firestore employees listen error:', err);
    });

    // 3. Listen to settings (Admin PIN)
    this.db.collection('settings').doc('admin_auth').onSnapshot(doc => {
      if (doc.exists && doc.data().pin) {
        const remotePin = doc.data().pin;
        localStorage.setItem('almustaqbal_admin_pin', remotePin);
        this.notifySubscribers('admin_pin', remotePin);
      }
    }, err => {
      console.warn('Firestore settings listen error:', err);
    });
  }

  // Save / Update Attendance Record
  async saveAttendanceRecord(record) {
    let records = JSON.parse(localStorage.getItem('almustaqbal_attendance_records') || '[]');
    const existingIndex = records.findIndex(r => r.id === record.id);
    if (existingIndex >= 0) {
      records[existingIndex] = record;
    } else {
      records.unshift(record);
    }
    localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));

    if (this.isFirebaseReady && this.db) {
      try {
        await this.db.collection('attendance').doc(record.id).set(record, { merge: true });
      } catch (err) {
        console.error('Firestore record save error:', err);
      }
    }
    return records;
  }

  // Delete Record
  async deleteAttendanceRecord(recordId) {
    let records = JSON.parse(localStorage.getItem('almustaqbal_attendance_records') || '[]');
    records = records.filter(r => r.id !== recordId);
    localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(records));

    if (this.isFirebaseReady && this.db) {
      try {
        await this.db.collection('attendance').doc(recordId).delete();
      } catch (err) {
        console.error('Firestore record delete error:', err);
      }
    }
    return records;
  }

  // Save / Update Employee
  async saveEmployee(emp) {
    let employees = JSON.parse(localStorage.getItem('almustaqbal_employees') || '[]');
    const existingIndex = employees.findIndex(e => e.id === emp.id);
    if (existingIndex >= 0) {
      employees[existingIndex] = emp;
    } else {
      employees.push(emp);
    }
    localStorage.setItem('almustaqbal_employees', JSON.stringify(employees));

    if (this.isFirebaseReady && this.db) {
      try {
        await this.db.collection('employees').doc(emp.id).set(emp, { merge: true });
      } catch (err) {
        console.error('Firestore employee save error:', err);
      }
    }
    return employees;
  }

  // Delete Employee
  async deleteEmployee(empId) {
    let employees = JSON.parse(localStorage.getItem('almustaqbal_employees') || '[]');
    employees = employees.filter(e => e.id !== empId);
    localStorage.setItem('almustaqbal_employees', JSON.stringify(employees));

    if (this.isFirebaseReady && this.db) {
      try {
        await this.db.collection('employees').doc(empId).delete();
      } catch (err) {
        console.error('Firestore employee delete error:', err);
      }
    }
    return employees;
  }

  // Save Admin PIN in Cloud & Local
  async saveAdminPin(newPin) {
    localStorage.setItem('almustaqbal_admin_pin', newPin);
    if (this.isFirebaseReady && this.db) {
      try {
        await this.db.collection('settings').doc('admin_auth').set({
          pin: newPin,
          updatedAt: new Date().toISOString()
        }, { merge: true });
      } catch (err) {
        console.error('Firestore saveAdminPin error:', err);
      }
    }
    return newPin;
  }
}

window.cloudStore = new CloudStore();
