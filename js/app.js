/**
 * تطبيق نظام الحضور والانصراف الذكي - مركز المستقبل للخدمات التعليمية
 * يبدأ بدون موظفين ويتم تسجيل الموظفين وربط هواتفهم تلقائياً من أول مسح (Scan)
 * تطوير وبرمجة: م. أحمد مراد
 */

const DEFAULT_ADMIN_PIN = '1234';
const STATION_SECRET_TOKEN = 'MSTQ_HQ_OFFICE_2026';
const REQUIRE_TOKEN = true;
const MIN_SECONDS_BEFORE_CHECKOUT = 120;
const MAX_SHIFT_HOURS = 12;
const UNDO_WINDOW_SECONDS = 600;

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
window.esc = esc;

function isManualRecord(record) {
  if (!record) return false;
  if (record.notes && (record.notes.includes('يدوي') || record.notes.toLowerCase().includes('manual'))) {
    return true;
  }
  const standardPrefix = 'REC_' + record.empId + '_' + record.date;
  if (record.id !== standardPrefix) {
    return true;
  }
  return false;
}
window.isManualRecord = isManualRecord;

function cairoDate(d = new Date()) {
  const dateObj = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  return dateObj.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}
window.cairoDate = cairoDate;

function cairoOffsetMs(d = new Date()) {
  const dateObj = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const p = dtf.formatToParts(dateObj).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  const cairoUtcMs = Date.UTC(
    parseInt(p.year, 10),
    parseInt(p.month, 10) - 1,
    parseInt(p.day, 10),
    parseInt(p.hour, 10),
    parseInt(p.minute, 10),
    parseInt(p.second, 10)
  );
  return cairoUtcMs - dateObj.getTime();
}
window.cairoOffsetMs = cairoOffsetMs;

function cairoTimeToDate(dateStr, timeStr) {
  if (typeof window !== 'undefined' && window.cairoTimeToDate && window.cairoTimeToDate !== cairoTimeToDate) {
    return window.cairoTimeToDate(dateStr, timeStr);
  }
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const parts = String(timeStr || '00:00:00').split(':');
  const hh = parseInt(parts[0] || '0', 10);
  const mm = parseInt(parts[1] || '0', 10);
  const ss = parseInt(parts[2] || '0', 10);

  const targetUtcMs = Date.UTC(y, m - 1, d, hh, mm, ss);
  const guess1 = new Date(targetUtcMs);
  const offset1 = cairoOffsetMs(guess1);
  const guess2 = new Date(targetUtcMs - offset1);
  const offset2 = cairoOffsetMs(guess2);
  return new Date(targetUtcMs - offset2);
}
window.cairoTimeToDate = cairoTimeToDate;
window.cairoDateTimeToUtc = cairoTimeToDate;

function getCairoTimeInputVal(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const p = dtf.formatToParts(d).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${p.hour}:${p.minute}:${p.second}`;
}
window.getCairoTimeInputVal = getCairoTimeInputVal;

function normalizeNameKey(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .toLowerCase();
}
window.normalizeNameKey = normalizeNameKey;

class AttendanceApp {
  constructor() {
    this.currentView = 'employee';
    this.adminTab = 'overview';
    this.employees = [];
    this.attendanceRecords = [];
    this.currentEmployee = null;
    this.deviceToken = null;
    this.adminPin = localStorage.getItem('almustaqbal_admin_pin') || DEFAULT_ADMIN_PIN;
    this.html5QrCode = null;
    this.liveClockTimer = null;
    this.liveShiftTimer = null;
    this.scanBusy = false;

    this.init();
  }

  async init() {
    this.loadDeviceToken();
    this.loadData();
    this.bindEvents();
    this.startLiveClock();
    this.checkUrlParameters();
    this.initQRPoster();
    this.setupCloudStoreListeners();
  }

  // Persistent Device Token
  loadDeviceToken() {
    let token = localStorage.getItem('almustaqbal_device_token');
    if (!token) {
      token = 'DEV_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
      localStorage.setItem('almustaqbal_device_token', token);
    }
    this.deviceToken = token;
  }

  generateNextEmployeeCode() {
    let maxNum = 0;
    this.employees.forEach(e => {
      if (e && e.code) {
        const match = String(e.code).trim().match(/^EMP-(\d+)$/i);
        if (match) {
          const num = parseInt(match[1], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    });
    return 'EMP-' + String(maxNum + 1).padStart(2, '0');
  }

  // Load employees & attendance records (starts empty)
  loadData() {
    const storedEmps = localStorage.getItem('almustaqbal_employees');
    this.employees = storedEmps ? JSON.parse(storedEmps) : [];

    const storedRecords = localStorage.getItem('almustaqbal_attendance_records');
    this.attendanceRecords = storedRecords ? JSON.parse(storedRecords) : [];

    // Find if this device is already bound to an employee
    const boundEmpId = localStorage.getItem('almustaqbal_bound_emp_id');
    if (boundEmpId) {
      this.currentEmployee = this.employees.find(e => e.id === boundEmpId) || null;
    } else {
      this.currentEmployee = this.employees.find(e => e.deviceToken === this.deviceToken) || null;
      if (this.currentEmployee) {
        localStorage.setItem('almustaqbal_bound_emp_id', this.currentEmployee.id);
      }
    }

    this.renderEmployeeView();
    this.renderAdminView();
  }

  setupCloudStoreListeners() {
    if (window.cloudStore) {
      window.cloudStore.onSync((type, data) => {
        if (type === 'attendance') {
          this.attendanceRecords = data;
          this.renderEmployeeView();
          this.renderAdminView();
        } else if (type === 'employees') {
          this.employees = data;
          if (this.deviceToken) {
            const found = this.employees.find(e => e.deviceToken === this.deviceToken);
            if (found) {
              this.currentEmployee = found;
              localStorage.setItem('almustaqbal_bound_emp_id', found.id);
            }
          }
          this.renderEmployeeView();
          this.renderAdminView();
        } else if (type === 'admin_pin') {
          this.adminPin = data;
        }
      });
    }
  }

  // Triggered when mobile scans the QR Code link (?action=scan&station=...)
  checkUrlParameters() {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const station = urlParams.get('station');
      const token = urlParams.get('token');
      const isValid = station === 'almustaqbal_hq' && (token === STATION_SECRET_TOKEN || REQUIRE_TOKEN === false);

      if (isValid) {
        window.history.replaceState({}, document.title, window.location.pathname);

        if (this.currentEmployee) {
          this.processAttendanceScan(this.currentEmployee, 'qr');
        } else {
          // First time scanning on this phone -> Prompt to enter Name & Register
          this.openSelfRegisterModal(true); // true = auto check-in after registration
        }
      }
    } catch (e) {
      console.error('Error parsing URL parameters:', e);
    }
  }

  // Live Digital Clock (Down to the second)
  startLiveClock() {
    const updateClock = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('ar-EG', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      const secStr = String(now.getSeconds()).padStart(2, '0');
      const dateStr = now.toLocaleDateString('ar-EG', {
        timeZone: 'Africa/Cairo',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const clockEl = document.getElementById('hero-clock-time');
      const secEl = document.getElementById('hero-clock-sec');
      const dateEl = document.getElementById('hero-clock-date');
      const adminClockEl = document.getElementById('admin-live-time');

      if (clockEl) clockEl.textContent = timeStr;
      if (secEl) secEl.textContent = ':' + secStr;
      if (dateEl) dateEl.textContent = dateStr;
      if (adminClockEl) adminClockEl.textContent = `${dateStr} - ${timeStr}:${secStr}`;
    };

    updateClock();
    this.liveClockTimer = setInterval(updateClock, 1000);
  }

  getTodayRecord(empId) {
    const todayStr = cairoDate();
    return this.attendanceRecords.find(r => r.empId === empId && r.date === todayStr);
  }

  getActiveRecord(empId) {
    const now = (window.cloudStore && typeof window.cloudStore.getServerNow === 'function')
      ? window.cloudStore.getServerNow()
      : new Date();
    const todayStr = cairoDate(now);
    const todayRec = this.attendanceRecords.find(r => r.empId === empId && r.date === todayStr);
    if (todayRec) return todayRec;

    const openRecords = this.attendanceRecords.filter(r =>
      r.empId === empId &&
      !r.checkOutTime &&
      r.date !== todayStr
    );

    if (openRecords.length === 0) return null;

    openRecords.sort((a, b) => new Date(b.checkInTimeRaw || b.date) - new Date(a.checkInTimeRaw || a.date));
    const latestOpen = openRecords[0];

    const checkInDate = new Date(latestOpen.checkInTimeRaw || latestOpen.date);
    const diffHours = (now.getTime() - checkInDate.getTime()) / (1000 * 3600);

    if (diffHours >= 0 && diffHours < MAX_SHIFT_HOURS) {
      return latestOpen;
    }

    return null;
  }

  // =========================================================================
  // EMPLOYEE VIEW & SELF-REGISTRATION
  // =========================================================================
  renderEmployeeView() {
    const profileContainer = document.getElementById('employee-profile-box');
    const actionsContainer = document.getElementById('employee-action-buttons');
    const todayStatusCard = document.getElementById('today-status-card');

    if (!profileContainer || !actionsContainer) return;

    if (!this.currentEmployee) {
      // Unregistered Phone
      profileContainer.innerHTML = `
        <div style="text-align: center; padding: 1.5rem 0;">
          <div style="font-size: 3rem; margin-bottom: 0.75rem;">👋</div>
          <h3 style="font-size: 1.4rem; color: #fff; margin-bottom: 0.5rem; font-weight: 800;">مرحباً بك في مركز المستقبل</h3>
          <p style="color: var(--text-muted); font-size: 1rem; margin-bottom: 1.25rem;">
            هذا الهاتف غير مسجل في النظام بعد. اضغط بالأسفل لكتابة اسمك وربط هاتفك وتسجيل حضورك فوراً.
          </p>
          <button class="nav-btn primary" onclick="app.openSelfRegisterModal(false)" style="font-size: 1.15rem; padding: 0.85rem 1.75rem;">
            <i class="fas fa-user-plus"></i> تسجيل اسمي وربط الهاتف الآن
          </button>
        </div>
      `;

      actionsContainer.innerHTML = `
        <button class="btn-big-action scan-camera" onclick="app.openCameraScannerModal()">
          <i class="fas fa-qrcode"></i> مسح كيو ار المقر بالكاميرا
        </button>
      `;

      if (todayStatusCard) todayStatusCard.style.display = 'none';
      return;
    }

    // Registered Employee on this Phone
    const initials = this.currentEmployee.name.split(' ').map(n => n[0]).slice(0, 2).join('');
    profileContainer.innerHTML = `
      <div class="employee-profile-pill">
        <div class="emp-avatar">${esc(initials)}</div>
        <div class="emp-info">
          <div class="emp-name">${esc(this.currentEmployee.name)}</div>
          <div class="emp-job">${esc(this.currentEmployee.jobTitle || 'موظف بمركز المستقبل')} - ${esc(this.currentEmployee.code || '')}</div>
        </div>
        <div class="emp-device-badge">
          <i class="fas fa-check-circle"></i> هاتفك مسجل ومربوط
        </div>
      </div>
    `;

    const todayRecord = this.getActiveRecord(this.currentEmployee.id);

    const isDirectAllowed = !!(this.currentEmployee && this.currentEmployee.allowDirectButton);

    let undoButtonHtml = '';
    if (todayRecord && todayRecord.empId === this.currentEmployee.id && !isManualRecord(todayRecord)) {
      const now = (window.cloudStore && typeof window.cloudStore.getServerNow === 'function')
        ? window.cloudStore.getServerNow()
        : new Date();
      if (todayRecord.checkOutTime) {
        const outTime = new Date(todayRecord.checkOutTimeRaw || todayRecord.updatedAt || todayRecord.date).getTime();
        const elapsedSec = Math.max(0, Math.floor((now.getTime() - outTime) / 1000));
        if (elapsedSec <= UNDO_WINDOW_SECONDS) {
          const remainingMin = Math.ceil((UNDO_WINDOW_SECONDS - elapsedSec) / 60);
          undoButtonHtml = `
            <button class="nav-btn outline" onclick="app.undoLastAttendanceAction()" style="width: 100%; justify-content: center; margin-top: 0.75rem; color: #f87171; border-color: rgba(248, 113, 113, 0.4); padding: 0.75rem; font-size: 0.95rem;">
              <i class="fas fa-undo"></i> تراجع عن تسجيل الانصراف (${remainingMin} د متبقية)
            </button>
          `;
        }
      } else {
        const inTime = new Date(todayRecord.checkInTimeRaw || todayRecord.createdAt || todayRecord.date).getTime();
        const elapsedSec = Math.max(0, Math.floor((now.getTime() - inTime) / 1000));
        if (elapsedSec <= UNDO_WINDOW_SECONDS) {
          const remainingMin = Math.ceil((UNDO_WINDOW_SECONDS - elapsedSec) / 60);
          undoButtonHtml = `
            <button class="nav-btn outline" onclick="app.undoLastAttendanceAction()" style="width: 100%; justify-content: center; margin-top: 0.75rem; color: #f87171; border-color: rgba(248, 113, 113, 0.4); padding: 0.75rem; font-size: 0.95rem;">
              <i class="fas fa-undo"></i> تراجع عن تسجيل الحضور (${remainingMin} د متبقية)
            </button>
          `;
        }
      }
    }

    if (!todayRecord) {
      // 1st Scan available: Check-In
      actionsContainer.innerHTML = isDirectAllowed ? `
        <button class="btn-big-action check-in" onclick="app.triggerDirectScanAction()">
          <i class="fas fa-sign-in-alt"></i> تسجيل الحضور الآن
        </button>
        <button class="btn-big-action scan-camera" onclick="app.openCameraScannerModal()" style="font-size: 1.05rem; padding: 0.85rem;">
          <i class="fas fa-camera"></i> مسح كود المقر بالكاميرا
        </button>
      ` : `
        <button class="btn-big-action check-in" onclick="app.openCameraScannerModal()">
          <i class="fas fa-qrcode"></i> تسجيل الحضور (مسح الكود)
        </button>
      `;
      if (todayStatusCard) todayStatusCard.style.display = 'none';
    } else if (todayRecord && !todayRecord.checkOutTime) {
      // 2nd Scan available: Check-Out
      actionsContainer.innerHTML = (isDirectAllowed ? `
        <button class="btn-big-action check-out" onclick="app.triggerDirectScanAction()">
          <i class="fas fa-sign-out-alt"></i> تسجيل الانصراف الآن
        </button>
        <button class="btn-big-action scan-camera" onclick="app.openCameraScannerModal()" style="font-size: 1.05rem; padding: 0.85rem;">
          <i class="fas fa-camera"></i> مسح كود المقر بالكاميرا
        </button>
      ` : `
        <button class="btn-big-action check-out" onclick="app.openCameraScannerModal()">
          <i class="fas fa-qrcode"></i> تسجيل الانصراف (مسح الكود)
        </button>
      `) + undoButtonHtml;

      if (todayStatusCard) {
        todayStatusCard.style.display = 'block';
        todayStatusCard.innerHTML = `
          <div class="today-status-title">
            <span><i class="fas fa-clock"></i> سجل نشاطك اليوم</span>
            <span class="badge badge-success"><i class="fas fa-circle"></i> متواجد بالعمل الآن</span>
          </div>
          <div class="status-timeline">
            <div class="timeline-box active">
              <span class="label">وقت الحضور المسجل:</span>
              <div class="time-value time-mono">${esc(todayRecord.checkInTimeFormatted || todayRecord.checkInTime || '')}</div>
            </div>
            <div class="timeline-box">
              <span class="label">وقت الانصراف:</span>
              <div class="time-value" style="color: var(--text-muted); font-size: 1rem;">بانتظار مسح الانصراف</div>
            </div>
          </div>
          <div class="duration-banner" style="margin-top: 1rem;">
            <span><i class="fas fa-stopwatch"></i> مدة العمل حتى اللحظة:</span>
            <span class="duration-calc" id="live-shift-duration">جاري الحساب...</span>
          </div>
        `;
        this.startLiveShiftTimer(todayRecord.checkInTimeRaw);
      }
    } else {
      // Completed for today
      actionsContainer.innerHTML = `
        <button class="btn-big-action completed" disabled>
          <i class="fas fa-check-double"></i> تم تسجيل الحضور والانصراف بالكامل اليوم
        </button>
      ` + undoButtonHtml;

      const sec = todayRecord.workSeconds || 0;
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;

      if (todayStatusCard) {
        todayStatusCard.style.display = 'block';
        todayStatusCard.innerHTML = `
          <div class="today-status-title">
            <span><i class="fas fa-award" style="color: var(--gold-primary);"></i> تم اكتمال يوم العمل بنجاح</span>
            <span class="badge badge-info"><i class="fas fa-check"></i> مكتمل</span>
          </div>
          <div class="status-timeline">
            <div class="timeline-box">
              <span class="label">وقت الحضور:</span>
              <div class="time-value time-mono">${esc(todayRecord.checkInTimeFormatted || todayRecord.checkInTime || '')}</div>
            </div>
            <div class="timeline-box">
              <span class="label">وقت الانصراف:</span>
              <div class="time-value time-mono">${esc(todayRecord.checkOutTimeFormatted || todayRecord.checkOutTime || '')}</div>
            </div>
          </div>
          <div class="duration-banner" style="margin-top: 1rem;">
            <span><i class="fas fa-hourglass-half"></i> إجمالي ساعات العمل اليوم:</span>
            <span class="duration-calc">${h} ساعة و ${m} دقيقة و ${s} ثانية</span>
          </div>
        `;
      }
    }
  }

  startLiveShiftTimer(checkInIso) {
    if (this.liveShiftTimer) clearInterval(this.liveShiftTimer);
    if (!checkInIso && this.currentEmployee) {
      const active = this.getActiveRecord(this.currentEmployee.id);
      if (active) checkInIso = active.checkInTimeRaw;
    }
    if (!checkInIso) return;
    const updateDuration = () => {
      const el = document.getElementById('live-shift-duration');
      if (!el) return;
      const start = new Date(checkInIso).getTime();
      const now = (window.cloudStore && typeof window.cloudStore.getServerNow === 'function')
        ? window.cloudStore.getServerNow().getTime()
        : new Date().getTime();
      const diffSec = Math.max(0, Math.floor((now - start) / 1000));
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      const s = diffSec % 60;
      el.textContent = `${h} س و ${m} د و ${s} ث`;
    };
    updateDuration();
    this.liveShiftTimer = setInterval(updateDuration, 1000);
  }

  // Prompt employee to enter their name on first scan
  openSelfRegisterModal(autoCheckIn = false) {
    this.autoCheckInAfterRegister = autoCheckIn;
    document.getElementById('self-reg-name').value = '';
    document.getElementById('self-reg-job').value = '';
    document.getElementById('self-reg-phone').value = '';
    this.openModal('self-register-modal');
  }

  // Save new employee from their phone and link immediately
  async saveSelfRegistration() {
    const rawName = document.getElementById('self-reg-name').value;
    const name = rawName.replace(/\s+/g, ' ').trim();
    const jobTitle = document.getElementById('self-reg-job').value.trim();
    const phone = document.getElementById('self-reg-phone').value.trim();

    if (!name) {
      this.showToast('يرجى كتابة الاسم بالكامل', 'warning');
      return;
    }

    const nameKey = normalizeNameKey(name);
    const sameNameEmployees = this.employees.filter(e => normalizeNameKey(e.name) === nameKey);
    let existingSameName = null;
    if (sameNameEmployees.length > 0) {
      existingSameName = sameNameEmployees.find(e => !e.deviceToken)
        || sameNameEmployees.find(e => e.deviceToken === this.deviceToken)
        || sameNameEmployees[0];
    }

    if (existingSameName) {
      if (existingSameName.deviceToken === this.deviceToken) {
        // Already bound to this phone -> do not create duplicate, rebind in memory and proceed
        this.currentEmployee = existingSameName;
        localStorage.setItem('almustaqbal_bound_emp_id', existingSameName.id);
        this.closeModal('self-register-modal');
        this.renderEmployeeView();
        this.renderAdminView();
        await this.processAttendanceScan(existingSameName);
        return;
      }

      if (!existingSameName.deviceToken) {
        // Case A: Same name, empty deviceToken (e.g. added by admin)
        if (!confirm(`هل أنت فعلاً (${existingSameName.name})؟ سيتم ربط هذا الهاتف بحسابه`)) {
          return;
        }
        existingSameName.deviceToken = this.deviceToken;
        if (jobTitle && !existingSameName.jobTitle) existingSameName.jobTitle = jobTitle;
        if (phone && !existingSameName.phone) existingSameName.phone = phone;
        existingSameName.reboundAt = new Date().toISOString();
        this.currentEmployee = existingSameName;
        localStorage.setItem('almustaqbal_bound_emp_id', existingSameName.id);

        try {
          await window.cloudStore.saveEmployee(existingSameName);
          this.showToast(`مرحباً بك يا ${existingSameName.name}! تم ربط هاتفك بنجاح`, 'success');
        } catch (err) {
          this.showToast('تم التسجيل على هاتفك وسيتم الرفع عند توفر الإنترنت', 'warning');
        }

        this.closeModal('self-register-modal');
        this.renderEmployeeView();
        this.renderAdminView();

        // Automatically register 1st scan Check-in!
        await this.processAttendanceScan(existingSameName);
        return;
      } else {
        // Case B: Already bound to another phone
        this.showToast('هذا الاسم مسجل بالفعل على هاتف آخر، تواصل مع الإدارة لفك الربط', 'error');
        return;
      }
    }

    // Case C: New employee
    const newCode = this.generateNextEmployeeCode();
    const newEmp = {
      id: 'emp_' + Date.now(),
      name: name,
      code: newCode,
      jobTitle: jobTitle || 'موظف بمركز المستقبل',
      phone: phone || '',
      deviceToken: this.deviceToken,
      createdAt: new Date().toISOString()
    };

    this.employees.push(newEmp);
    this.currentEmployee = newEmp;
    localStorage.setItem('almustaqbal_bound_emp_id', newEmp.id);
    try {
      await window.cloudStore.saveEmployee(newEmp);
      this.showToast(`مرحباً بك يا ${name}! تم ربط هاتفك بنجاح`, 'success');
    } catch (err) {
      this.showToast('تم التسجيل على هاتفك وسيتم الرفع عند توفر الإنترنت', 'warning');
    }

    this.closeModal('self-register-modal');
    this.renderEmployeeView();
    this.renderAdminView();

    // Automatically register 1st scan Check-in!
    await this.processAttendanceScan(newEmp, 'qr');
  }

  // Attendance Scan execution (Check-in or Check-out)
  async processAttendanceScan(employee, method = 'qr') {
    if (this.scanBusy) return;
    this.scanBusy = true;

    const actionButtons = document.querySelectorAll('#employee-action-buttons button');
    actionButtons.forEach(b => { b.disabled = true; });

    try {
      if (!employee) {
        this.openSelfRegisterModal(true);
        return;
      }

      const now = (window.cloudStore && typeof window.cloudStore.getServerNow === 'function')
        ? window.cloudStore.getServerNow()
        : new Date();
      const serverOffset = (window.cloudStore && typeof window.cloudStore.serverTimeOffset === 'number')
        ? window.cloudStore.serverTimeOffset
        : 0;
      const hasSignificantSkew = Math.abs(serverOffset) > (2 * 60 * 1000);

      const todayStr = cairoDate(now);
      const nowTimeStr = now.toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      const nowIso = now.toISOString();

      let record = this.getActiveRecord(employee.id);
      const todayRecId = 'REC_' + employee.id + '_' + todayStr;

      // Check server copy before creating check-in to avoid overwriting checkout or concurrent scan
      if (!record && window.cloudStore && typeof window.cloudStore.fetchAttendanceRecord === 'function') {
        const serverCopy = await window.cloudStore.fetchAttendanceRecord(todayRecId);
        if (serverCopy) {
          record = serverCopy;
          const idx = this.attendanceRecords.findIndex(r => r.id === serverCopy.id);
          if (idx >= 0) this.attendanceRecords[idx] = serverCopy;
          else this.attendanceRecords.unshift(serverCopy);
          localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(this.attendanceRecords));
        }
      }

      if (!record) {
        // 1st Scan: CHECK-IN
        record = {
          id: todayRecId,
          empId: employee.id,
          empName: employee.name,
          date: todayStr,
          checkInTime: nowTimeStr,
          checkInTimeFormatted: nowTimeStr,
          checkInTimeRaw: nowIso,
          checkOutTime: null,
          checkOutTimeFormatted: null,
          checkOutTimeRaw: null,
          workSeconds: 0,
          status: 'حاضر',
          method: method === 'button' ? 'button' : 'qr',
          deviceToken: this.deviceToken,
          createdAt: nowIso
        };
        if (hasSignificantSkew) {
          record.clockSkewMs = serverOffset;
        }

        let isSynced = false;
        try {
          const txResult = await window.cloudStore.createAttendanceRecordTransaction(record);
          if (txResult && !txResult.committed && txResult.existingRecord) {
            record = txResult.existingRecord;
            const idx = this.attendanceRecords.findIndex(r => r.id === record.id);
            if (idx >= 0) this.attendanceRecords[idx] = record;
            else this.attendanceRecords.unshift(record);
            localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(this.attendanceRecords));
            this.showToast('تم العثور على سجل سابق لليوم', 'info');
            this.renderEmployeeView();
            this.renderAdminView();
            return;
          }
          isSynced = true;
        } catch (txErr) {
          isSynced = false;
        }

        const idx = this.attendanceRecords.findIndex(r => r.id === record.id);
        if (idx >= 0) this.attendanceRecords[idx] = record;
        else this.attendanceRecords.unshift(record);

        if (window.soundEffects) window.soundEffects.playCheckInSuccess();
        if (isSynced) {
          this.showToast(`أهلاً بك يا ${employee.name} 👋 تم تسجيل حضورك بنجاح في تمام ${nowTimeStr}`, 'success');
        } else {
          this.showToast('تم التسجيل على هاتفك وسيتم الرفع عند توفر الإنترنت', 'warning');
        }
        this.renderEmployeeView();
        this.renderAdminView();
      } else if (record && !record.checkOutTime) {
        // 2nd Scan: CHECK-OUT
        const checkInDate = new Date(record.checkInTimeRaw);
        const durationSeconds = Math.max(0, Math.floor((now.getTime() - checkInDate.getTime()) / 1000));
        
        if (durationSeconds < MIN_SECONDS_BEFORE_CHECKOUT) {
          this.showToast('تم تسجيل حضورك منذ لحظات، انتظر قليلاً قبل الانصراف', 'warning');
          return;
        }

        const hours = Math.floor(durationSeconds / 3600);
        const mins = Math.floor((durationSeconds % 3600) / 60);
        const secs = durationSeconds % 60;

        record.checkOutTime = nowTimeStr;
        record.checkOutTimeFormatted = nowTimeStr;
        record.checkOutTimeRaw = nowIso;
        record.workSeconds = durationSeconds;
        record.status = 'مكتمل';
        record.updatedAt = nowIso;
        if (hasSignificantSkew) {
          record.clockSkewMs = serverOffset;
        }

        let isSynced = false;
        try {
          await window.cloudStore.saveAttendanceRecord(record);
          isSynced = true;
        } catch (syncErr) {
          isSynced = false;
        }

        const idx = this.attendanceRecords.findIndex(r => r.id === record.id);
        if (idx >= 0) this.attendanceRecords[idx] = record;

        if (window.soundEffects) window.soundEffects.playCheckOutSuccess();
        if (isSynced) {
          this.showToast(`مع السلامة يا ${employee.name}! تم تسجيل انصرافك بنجاح. مدة العمل: ${hours} س و ${mins} د و ${secs} ث`, 'success');
        } else {
          this.showToast('تم التسجيل على هاتفك وسيتم الرفع عند توفر الإنترنت', 'warning');
        }
        this.renderEmployeeView();
        this.renderAdminView();
      } else {
        this.showToast(`لقد قمت بتسجيل الحضور والانصراف لهذا اليوم بالفعل`, 'warning');
      }
    } finally {
      this.scanBusy = false;
      this.renderEmployeeView();
    }
  }

  triggerDirectScanAction() {
    if (!this.currentEmployee) {
      this.openSelfRegisterModal(true);
      return;
    }
    // Safety check: if employee is not allowed direct button, open camera scanner, NEVER record
    if (!this.currentEmployee.allowDirectButton) {
      this.openCameraScannerModal();
      return;
    }
    this.processAttendanceScan(this.currentEmployee, 'button');
  }

  // =========================================================================
  // ADMIN DASHBOARD & SECURITY
  // =========================================================================
  switchView(viewName) {
    if (viewName === 'admin' && this.currentView !== 'admin') {
      this.openModal('admin-pin-modal');
      const pinInput = document.getElementById('admin-pin-input');
      if (pinInput) {
        pinInput.value = '';
        setTimeout(() => pinInput.focus(), 150);
      }
      return;
    }

    this.currentView = viewName;
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn[data-view]').forEach(el => el.classList.remove('active'));

    const activeView = document.getElementById(`view-${viewName}`);
    const activeNav = document.querySelector(`.nav-btn[data-view="${viewName}"]`);

    if (activeView) activeView.classList.add('active');
    if (activeNav) activeNav.classList.add('active');

    if (viewName === 'admin') {
      this.renderAdminView();
    } else {
      this.renderEmployeeView();
    }
  }

  verifyAdminPin() {
    const pinInput = document.getElementById('admin-pin-input');
    const enteredPin = pinInput ? pinInput.value.trim() : '';

    if (enteredPin === this.adminPin) {
      this.closeModal('admin-pin-modal');
      this.currentView = 'admin';
      document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-btn[data-view]').forEach(el => el.classList.remove('active'));

      const activeView = document.getElementById('view-admin');
      const activeNav = document.querySelector('.nav-btn[data-view="admin"]');
      if (activeView) activeView.classList.add('active');
      if (activeNav) activeNav.classList.add('active');

      this.renderAdminView();
      this.showToast('مرحباً بك في لوحة تحكم الإدارة', 'success');
    } else {
      if (window.soundEffects) window.soundEffects.playError();
      this.showToast('رمز الدخول غير صحيح!', 'error');
    }
  }

  // Change Admin Password / PIN
  openChangePinModal() {
    document.getElementById('current-admin-pin').value = '';
    document.getElementById('new-admin-pin').value = '';
    document.getElementById('confirm-admin-pin').value = '';
    this.openModal('change-pin-modal');
  }

  async saveNewAdminPin() {
    const currentPinInput = document.getElementById('current-admin-pin').value.trim();
    const newPinInput = document.getElementById('new-admin-pin').value.trim();
    const confirmPinInput = document.getElementById('confirm-admin-pin').value.trim();

    if (currentPinInput !== this.adminPin) {
      this.showToast('رمز المرور الحالي غير صحيح!', 'error');
      return;
    }

    if (!newPinInput || newPinInput.length < 4) {
      this.showToast('يجب أن يتكون رمز المرور الجديد من 4 خانات على الأقل', 'warning');
      return;
    }

    if (newPinInput !== confirmPinInput) {
      this.showToast('رمز المرور الجديد وتأكيده غير متطابقين!', 'error');
      return;
    }

    this.adminPin = newPinInput;
    this.closeModal('change-pin-modal');
    try {
      await window.cloudStore.saveAdminPin(newPinInput);
      this.showToast('تم تغيير وحفظ رمز مرور الإدارة بنجاح!', 'success');
    } catch (err) {
      this.showToast('تم تغيير رمز المرور محلياً وسيتم الحفظ عند توفر الإنترنت', 'warning');
    } finally {
      this.renderAdminView();
    }
  }

  switchAdminTab(tabName) {
    this.adminTab = tabName;
    document.querySelectorAll('.admin-tabs .tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    const btn = document.querySelector(`.admin-tabs .tab-btn[data-tab="${tabName}"]`);
    const panel = document.getElementById(`tab-panel-${tabName}`);

    if (btn) btn.classList.add('active');
    if (panel) panel.classList.add('active');

    if (tabName === 'poster') {
      this.initQRPoster();
    }
  }

  renderAdminView() {
    this.renderAdminStats();
    this.renderAttendanceTable();
    this.renderEmployeesGrid();
    this.populateEmployeeFilters();
  }

  // Calculate live statistics
  renderAdminStats() {
    const todayStr = cairoDate();
    const todayRecords = this.attendanceRecords.filter(r => r.date === todayStr);

    const presentNowCount = this.employees.filter(emp => {
      const active = this.getActiveRecord(emp.id);
      return active && !active.checkOutTime;
    }).length;
    const completedTodayCount = todayRecords.filter(r => r.checkOutTime).length;
    const totalStaffCount = this.employees.length;
    const absentCount = Math.max(0, totalStaffCount - (presentNowCount + completedTodayCount));

    const totalSecondsToday = todayRecords.reduce((acc, r) => acc + (r.workSeconds || 0), 0);
    const totalHoursToday = (totalSecondsToday / 3600).toFixed(1);

    const elStaff = document.getElementById('stat-total-staff');
    const elPresent = document.getElementById('stat-present-now');
    const elCompleted = document.getElementById('stat-completed-today');
    const elAbsent = document.getElementById('stat-absent-today');
    const elHours = document.getElementById('stat-hours-today');

    if (elStaff) elStaff.textContent = totalStaffCount;
    if (elPresent) elPresent.textContent = presentNowCount;
    if (elCompleted) elCompleted.textContent = completedTodayCount;
    if (elAbsent) elAbsent.textContent = absentCount;
    if (elHours) elHours.textContent = `${totalHoursToday} س`;
  }

  getFilteredRecords() {
    const searchInput = document.getElementById('admin-search-input');
    const dateFilter = document.getElementById('admin-date-filter');
    const empFilter = document.getElementById('admin-emp-filter');

    const search = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const dateType = dateFilter ? dateFilter.value : 'all';
    const selectedEmpId = empFilter ? empFilter.value : 'all';

    const now = new Date();
    const todayStr = cairoDate(now);
    const [y, m, d] = todayStr.split('-').map(Number);
    const yesterdayDate = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
    const yesterdayStr = cairoDate(yesterdayDate);

    return this.attendanceRecords.filter(r => {
      if (selectedEmpId !== 'all' && r.empId !== selectedEmpId) return false;
      if (search && !r.empName.toLowerCase().includes(search) && !r.date.includes(search)) return false;

      if (dateType === 'today' && r.date !== todayStr) return false;
      if (dateType === 'yesterday' && r.date !== yesterdayStr) return false;
      if (dateType === 'month') {
        const currentMonthPrefix = todayStr.substring(0, 7);
        if (!r.date.startsWith(currentMonthPrefix)) return false;
      }

      return true;
    }).sort((a, b) => new Date(b.checkInTimeRaw || b.date) - new Date(a.checkInTimeRaw || a.date));
  }

  renderAttendanceTable() {
    const tbody = document.getElementById('attendance-table-body');
    if (!tbody) return;

    const filtered = this.getFilteredRecords();

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; padding: 2.5rem; color: var(--text-muted);">
            <i class="fas fa-folder-open" style="font-size: 2.5rem; margin-bottom: 0.75rem; display: block; opacity: 0.5;"></i>
            <span style="font-size: 1.15rem; font-weight: 700;">لا توجد سجلات حضور مسجلة حتى الآن</span>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(r => {
      const sec = r.workSeconds || 0;
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      const formattedDuration = sec > 0 ? `${h}س و ${m}د و ${s}ث` : (r.status === 'حاضر' ? '<span style="color: #34d399; font-weight:700;"><i class="fas fa-spinner fa-spin"></i> قيد العمل</span>' : '---');

      let badgeHtml = '<span class="badge badge-info">مكتمل</span>';
      if (r.status === 'حاضر' && !r.checkOutTime) {
        const checkInDate = new Date(r.checkInTimeRaw || r.date);
        const now = (window.cloudStore && typeof window.cloudStore.getServerNow === 'function')
          ? window.cloudStore.getServerNow()
          : new Date();
        const elapsedHours = (now.getTime() - checkInDate.getTime()) / (1000 * 3600);

        if (elapsedHours >= MAX_SHIFT_HOURS) {
          badgeHtml = '<span class="badge badge-warning" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);"><i class="fas fa-exclamation-triangle"></i> نسي الانصراف</span>';
        } else {
          badgeHtml = '<span class="badge badge-success"><i class="fas fa-circle"></i> متواجد الآن</span>';
        }
      }

      return `
        <tr>
          <td style="font-weight: 700;">${esc(r.date)}</td>
          <td style="font-weight: 800; font-size: 1.1rem; color: #fff;">
            ${esc(r.empName)}
            ${r.method === 'button' ? '<span class="badge" style="font-size: 0.75rem; margin-right: 0.35rem; background: rgba(212,175,55,0.18); color: var(--gold-light); border: 1px solid rgba(212,175,55,0.35);"><i class="fas fa-hand-pointer"></i> زرار</span>' : ''}
            ${(r.undoCount > 0) ? '<span class="badge" style="font-size: 0.75rem; margin-right: 0.35rem; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);"><i class="fas fa-undo"></i> تراجع</span>' : ''}
          </td>
          <td class="time-mono" style="color: var(--gold-light); font-weight: 800;">${esc(r.checkInTimeFormatted || r.checkInTime || '---')}</td>
          <td class="time-mono" style="color: ${r.checkOutTime ? 'var(--text-primary)' : 'var(--text-muted)'}; font-weight: 800;">
            ${esc(r.checkOutTimeFormatted || r.checkOutTime || 'لم ينصرف بعد')}
          </td>
          <td class="time-mono" style="font-weight: 800; color: #fff;">${formattedDuration}</td>
          <td>${badgeHtml}</td>
          <td>
            <div style="display: flex; gap: 0.4rem;">
              <button class="btn-icon-action" title="تعديل السجل يدوياً" onclick="app.openEditRecordModal('${esc(r.id)}')">
                <i class="fas fa-edit"></i>
              </button>
              <button class="btn-icon-action delete" title="حذف السجل" onclick="app.deleteRecord('${esc(r.id)}')">
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  renderEmployeesGrid() {
    const grid = document.getElementById('employees-summary-grid');
    if (!grid) return;

    if (this.employees.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; background: var(--bg-card); border-radius: var(--radius-lg); border: 1px dashed var(--border-color);">
          <div style="font-size: 3rem; margin-bottom: 1rem;">👥</div>
          <h3 style="font-size: 1.3rem; color: #fff; margin-bottom: 0.5rem;">لا يوجد موظفون مضافون بعد</h3>
          <p style="color: var(--text-muted); font-size: 0.95rem;">
            سيتم إضافة الموظفين تلقائياً هنا بمجرد قيام كل موظف بمسح كود المقر بهاتفه لأول مرة وكتابة اسمه.
          </p>
        </div>
      `;
      return;
    }

    grid.innerHTML = this.employees.map(emp => {
      const empRecords = this.attendanceRecords.filter(r => r.empId === emp.id && r.workSeconds > 0);
      const totalDays = empRecords.length;
      const totalSec = empRecords.reduce((acc, r) => acc + (r.workSeconds || 0), 0);
      const totalHours = Math.floor(totalSec / 3600);
      const totalMinutes = Math.floor((totalSec % 3600) / 60);

      const isBound = !!emp.deviceToken;

      return `
        <div class="emp-summary-card">
          <div class="emp-summary-header">
            <div>
              <div style="font-size: 1.25rem; font-weight: 900; color: #fff;">${esc(emp.name)}</div>
              <div style="font-size: 0.9rem; color: var(--gold-light);">${esc(emp.jobTitle || 'موظف')} - ${esc(emp.code || '')}</div>
            </div>
            <div style="display: flex; gap: 0.35rem; flex-wrap: wrap; justify-content: flex-end;">
              ${emp.allowDirectButton ? `
                <span class="badge" style="background: rgba(212,175,55,0.18); color: var(--gold-light); border: 1px solid rgba(212,175,55,0.35);">
                  <i class="fas fa-hand-pointer"></i> زرار مباشر
                </span>
              ` : ''}
              <span class="badge ${isBound ? 'badge-success' : 'badge-warning'}">
                <i class="fas ${isBound ? 'fa-mobile-alt' : 'fa-exclamation-triangle'}"></i>
                ${isBound ? 'هاتف مربوط' : 'غير مربوط'}
              </span>
            </div>
          </div>

          <div class="emp-metrics-row">
            <div class="metric-mini-box">
              <div class="title">أيام الحضور</div>
              <div class="value">${totalDays}</div>
            </div>
            <div class="metric-mini-box">
              <div class="title">إجمالي الساعات</div>
              <div class="value">${totalHours} س و ${totalMinutes} د</div>
            </div>
          </div>

          <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 0.85rem;">
            ${isBound ? `
              <button class="nav-btn outline" style="padding: 0.4rem 0.85rem; font-size: 0.9rem;" onclick="app.unbindEmployeeDevice('${esc(emp.id)}')" title="فك ربط الهاتف ليتمكن من ربط هاتف جديد">
                <i class="fas fa-unlink"></i> فك ربط الهاتف
              </button>
            ` : ''}
            <button class="nav-btn outline" style="padding: 0.4rem 0.85rem; font-size: 0.9rem;" onclick="app.openEditEmployeeModal('${esc(emp.id)}')">
              <i class="fas fa-user-edit"></i> تعديل
            </button>
            <button class="btn-icon-action delete" style="width: 34px; height: 34px;" onclick="app.deleteEmployee('${esc(emp.id)}')">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  populateEmployeeFilters() {
    const filterSelect = document.getElementById('admin-emp-filter');
    if (!filterSelect) return;
    const currentVal = filterSelect.value;
    filterSelect.innerHTML = '<option value="all">جميع الموظفين</option>' +
      this.employees.map(e => `<option value="${esc(e.id)}" ${e.id === currentVal ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
  }

  exportExcelReport() {
    const filtered = this.getFilteredRecords();
    const dateFilter = document.getElementById('admin-date-filter');
    const dateLabel = dateFilter ? dateFilter.options[dateFilter.selectedIndex].text : 'الكل';

    if (window.ExcelExporter) {
      window.ExcelExporter.exportFullReport(filtered, this.employees, {
        dateFilterLabel: dateLabel
      });
      this.showToast('تم تصدير ملف الإكسيل بنجاح!', 'success');
    } else {
      this.showToast('مكتبة الإكسيل غير متوفرة', 'error');
    }
  }

  initQRPoster() {
    const container = document.getElementById('poster-qr-target');
    if (!container) return;
    container.innerHTML = '';

    const baseUrl = window.location.origin + window.location.pathname;
    const fixedScanUrl = `${baseUrl}?action=scan&station=almustaqbal_hq&token=${STATION_SECRET_TOKEN}`;

    if (typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: fixedScanUrl,
        width: 260,
        height: 260,
        colorDark: '#0b0f19',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } else {
      container.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(fixedScanUrl)}" alt="كود المقر" style="width: 260px; height: 260px;" />`;
    }
  }

  printQRPoster() {
    window.print();
  }

  // Camera Scanner
  openCameraScannerModal() {
    this.openModal('camera-scanner-modal');
    setTimeout(() => {
      this.startCameraScanner();
    }, 300);
  }

  getCameraErrorMessage(err) {
    const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const iosNote = isIOS ? ' (لمستخدمي Safari: تأكد من تفعيل إذن الكاميرا من إعدادات الموقع aA)' : '';

    if (typeof window !== 'undefined' && !window.isSecureContext && location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      return 'يتطلب تشغيل الكاميرا اتصالاً آمناً (HTTPS). يرجى فتح الموقع عبر رابط آمن' + iosNote;
    }

    const errStr = (err && (err.name || err.message || String(err))) || '';
    if (errStr.includes('NotAllowedError') || errStr.includes('PermissionDeniedError') || errStr.toLowerCase().includes('permission')) {
      return 'تم رفض إذن الوصول للكاميرا. يرجى السماح بالوصول للكاميرا في إعدادات المتصفح' + iosNote;
    }
    if (errStr.includes('NotFoundError') || errStr.includes('DevicesNotFoundError') || errStr.toLowerCase().includes('not found') || errStr.toLowerCase().includes('no camera')) {
      return 'لم يتم العثور على كاميرا في هذا الجهاز' + iosNote;
    }
    if (errStr.includes('NotReadableError') || errStr.includes('TrackStartError')) {
      return 'الكاميرا قيد الاستخدام بواسطة تطبيق آخر أو غير متاحة حالياً' + iosNote;
    }

    return 'تعذر تشغيل الكاميرا، يرجى التأكد من إعطاء الإذن وإعادة المحاولة' + iosNote;
  }

  startCameraScanner() {
    if (typeof window !== 'undefined' && !window.isSecureContext && location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      this.showToast(this.getCameraErrorMessage(new Error('InsecureContext')), 'error');
      return;
    }

    if (typeof Html5Qrcode === 'undefined') {
      this.showToast('مكتبة قارئ الكاميرا غير محملة', 'error');
      return;
    }

    const scannerEl = document.getElementById('qr-camera-reader');
    if (!scannerEl) return;

    if (this.html5QrCode) {
      try {
        if (this.html5QrCode.isScanning) {
          this.html5QrCode.stop().catch(() => {});
        }
        this.html5QrCode.clear();
      } catch (e) {}
      this.html5QrCode = null;
    }

    const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
    const iosHint = document.getElementById('ios-camera-hint');
    if (iosHint) {
      iosHint.style.display = isIOS ? 'block' : 'none';
    }

    this.html5QrCode = new Html5Qrcode('qr-camera-reader');
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    this.html5QrCode.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => {
        const scanner = this.html5QrCode;
        if (scanner && scanner.isScanning) {
          scanner.stop().then(() => {
            try { scanner.clear(); } catch (e) {}
            this.html5QrCode = null;
            this.closeModal('camera-scanner-modal');
            this.handleScannedQrResult(decodedText);
          }).catch(() => {
            try { scanner.clear(); } catch (e) {}
            this.html5QrCode = null;
            this.closeModal('camera-scanner-modal');
            this.handleScannedQrResult(decodedText);
          });
        } else {
          this.closeModal('camera-scanner-modal');
          this.handleScannedQrResult(decodedText);
        }
      },
      (error) => {}
    ).catch(err => {
      console.warn('Camera start error:', err);
      const errorMsg = this.getCameraErrorMessage(err);
      this.showToast(errorMsg, 'error');
    });
  }

  async stopCameraScanner() {
    if (this.html5QrCode) {
      const scanner = this.html5QrCode;
      this.html5QrCode = null;
      try {
        if (scanner.isScanning) {
          await scanner.stop();
        }
      } catch (err) {
        console.warn('Error stopping scanner:', err);
      }
      try {
        scanner.clear();
      } catch (err) {
        console.warn('Error clearing scanner:', err);
      }
    }
    const scannerEl = document.getElementById('qr-camera-reader');
    if (scannerEl) scannerEl.innerHTML = '';
    this.closeModal('camera-scanner-modal');
  }

  handleScannedQrResult(decodedText) {
    let isValid = false;
    try {
      let searchParams;
      if (typeof decodedText === 'string' && (decodedText.startsWith('http://') || decodedText.startsWith('https://'))) {
        searchParams = new URL(decodedText).searchParams;
      } else {
        const qIdx = typeof decodedText === 'string' ? decodedText.indexOf('?') : -1;
        const queryStr = qIdx !== -1 ? decodedText.slice(qIdx) : (decodedText || '');
        searchParams = new URLSearchParams(queryStr);
      }
      const station = searchParams.get('station');
      const token = searchParams.get('token');
      isValid = station === 'almustaqbal_hq' && (token === STATION_SECRET_TOKEN || REQUIRE_TOKEN === false);
    } catch (e) {
      isValid = false;
    }

    if (isValid) {
      if (this.currentEmployee) {
        this.processAttendanceScan(this.currentEmployee, 'qr');
      } else {
        this.openSelfRegisterModal(true);
      }
    } else {
      if (window.soundEffects) window.soundEffects.playError();
      this.showToast('كود QR غير معتمد لمركز المستقبل!', 'error');
    }
  }

  // Employee Form (Admin Manual Add)
  openAddEmployeeModal() {
    document.getElementById('emp-modal-title').textContent = 'إضافة موظف جديد';
    document.getElementById('emp-form-id').value = '';
    document.getElementById('emp-form-name').value = '';
    document.getElementById('emp-form-code').value = this.generateNextEmployeeCode();
    document.getElementById('emp-form-job').value = '';
    document.getElementById('emp-form-phone').value = '';
    const directChk = document.getElementById('emp-form-direct-btn');
    if (directChk) directChk.checked = false;
    this.openModal('employee-form-modal');
  }

  openEditEmployeeModal(empId) {
    const emp = this.employees.find(e => e.id === empId);
    if (!emp) return;

    document.getElementById('emp-modal-title').textContent = 'تعديل بيانات الموظف';
    document.getElementById('emp-form-id').value = emp.id;
    document.getElementById('emp-form-name').value = emp.name;
    document.getElementById('emp-form-code').value = emp.code || '';
    document.getElementById('emp-form-job').value = emp.jobTitle || '';
    document.getElementById('emp-form-phone').value = emp.phone || '';
    const directChk = document.getElementById('emp-form-direct-btn');
    if (directChk) directChk.checked = !!emp.allowDirectButton;
    this.openModal('employee-form-modal');
  }

  async saveEmployeeForm() {
    const id = document.getElementById('emp-form-id').value;
    const name = document.getElementById('emp-form-name').value.trim();
    const code = document.getElementById('emp-form-code').value.trim();
    const jobTitle = document.getElementById('emp-form-job').value.trim();
    const phone = document.getElementById('emp-form-phone').value.trim();

    if (!name) {
      this.showToast('يرجى إدخال اسم الموظف', 'warning');
      return;
    }

    const allowDirectButton = !!(document.getElementById('emp-form-direct-btn')?.checked);

    let emp;
    if (id) {
      emp = this.employees.find(e => e.id === id);
      if (emp) {
        emp.name = name;
        emp.code = code;
        emp.jobTitle = jobTitle;
        emp.phone = phone;
        emp.allowDirectButton = allowDirectButton;
      }
    } else {
      emp = {
        id: 'emp_' + Date.now(),
        name,
        code: code || this.generateNextEmployeeCode(),
        jobTitle: jobTitle || 'موظف',
        phone,
        deviceToken: null,
        allowDirectButton,
        createdAt: new Date().toISOString()
      };
      this.employees.push(emp);
    }

    if (this.currentEmployee && this.currentEmployee.id === emp.id) {
      this.currentEmployee.allowDirectButton = allowDirectButton;
      this.renderEmployeeView();
    }

    try {
      await window.cloudStore.saveEmployee(emp);
      this.showToast('تم حفظ بيانات الموظف بنجاح', 'success');
    } catch (err) {
      this.showToast('تم الحفظ محلياً وسيتم الرفع عند توفر الإنترنت', 'warning');
    }
    this.closeModal('employee-form-modal');
    this.renderEmployeesGrid();
    this.populateEmployeeFilters();
  }

  async unbindEmployeeDevice(empId) {
    if (!confirm('هل أنت متأكد من فك ربط هذا الهاتف؟ سيمكن للموظف ربط هاتف جديد بعد ذلك.')) return;
    const emp = this.employees.find(e => e.id === empId);
    if (emp) {
      emp.deviceToken = null;
      if (this.currentEmployee && this.currentEmployee.id === empId) {
        localStorage.removeItem('almustaqbal_bound_emp_id');
        this.currentEmployee = null;
      }
      try {
        await window.cloudStore.saveEmployee(emp);
        this.showToast(`تم فك ربط الهاتف عن الموظف (${emp.name})`, 'info');
      } catch (err) {
        this.showToast('تم فك ربط الهاتف محلياً وسيتم المزامنة عند توفر الإنترنت', 'warning');
      } finally {
        this.renderEmployeeView();
        this.renderAdminView();
      }
    }
  }

  async deleteEmployee(empId) {
    const emp = this.employees.find(e => e.id === empId);
    if (!emp) return;
    if (!confirm(`هل أنت متأكد من حذف الموظف (${emp.name}) نهائياً؟`)) return;

    this.employees = this.employees.filter(e => e.id !== empId);
    try {
      await window.cloudStore.deleteEmployee(empId);
      this.showToast('تم حذف الموظف بنجاح', 'success');
    } catch (err) {
      this.showToast('تم حذف الموظف محلياً وسيتم المزامنة عند توفر الإنترنت', 'warning');
    } finally {
      this.renderEmployeesGrid();
      this.populateEmployeeFilters();
    }
  }

  // Manual Attendance Record
  openManualRecordModal() {
    if (this.employees.length === 0) {
      this.showToast('يرجى إضافة موظف أولاً أو انتظار تسجيل أول موظف', 'warning');
      return;
    }

    document.getElementById('manual-rec-id').value = '';
    const empSelect = document.getElementById('manual-rec-emp');
    empSelect.innerHTML = this.employees.map(e => `<option value="${esc(e.id)}">${esc(e.name)}</option>`).join('');

    document.getElementById('manual-rec-date').value = cairoDate();
    document.getElementById('manual-rec-checkin').value = '09:00:00';
    document.getElementById('manual-rec-checkout').value = '17:00:00';
    document.getElementById('manual-rec-notes').value = 'تسجيل يدوي بواسطة الإدارة';

    this.openModal('manual-record-modal');
  }

  openEditRecordModal(recId) {
    const rec = this.attendanceRecords.find(r => r.id === recId);
    if (!rec) return;

    document.getElementById('manual-rec-id').value = rec.id;
    const empSelect = document.getElementById('manual-rec-emp');
    empSelect.innerHTML = this.employees.map(e => `<option value="${esc(e.id)}" ${e.id === rec.empId ? 'selected' : ''}>${esc(e.name)}</option>`).join('');

    document.getElementById('manual-rec-date').value = rec.date;
    
    let inTime = '09:00:00';
    if (rec.checkInTimeRaw) {
      inTime = getCairoTimeInputVal(rec.checkInTimeRaw);
    }
    let outTime = '';
    if (rec.checkOutTimeRaw) {
      outTime = getCairoTimeInputVal(rec.checkOutTimeRaw);
    }

    document.getElementById('manual-rec-checkin').value = inTime;
    document.getElementById('manual-rec-checkout').value = outTime;
    document.getElementById('manual-rec-notes').value = rec.notes || '';

    this.openModal('manual-record-modal');
  }

  async saveManualRecord() {
    const id = document.getElementById('manual-rec-id').value;
    const empId = document.getElementById('manual-rec-emp').value;
    const dateStr = document.getElementById('manual-rec-date').value;
    const checkInVal = document.getElementById('manual-rec-checkin').value;
    const checkOutVal = document.getElementById('manual-rec-checkout').value;
    const notes = document.getElementById('manual-rec-notes').value;

    const emp = this.employees.find(e => e.id === empId);
    if (!emp || !dateStr || !checkInVal) {
      this.showToast('يرجى ملء جميع الحقول الإلزامية', 'warning');
      return;
    }

    let existingRec = null;
    if (id) {
      existingRec = this.attendanceRecords.find(r => r.id === id);
    } else {
      const existingForDay = this.attendanceRecords.find(r => r.empId === empId && r.date === dateStr);
      if (existingForDay) {
        if (!confirm(`يوجد بالفعل سجل حضور للموظف (${emp.name}) في تاريخ (${dateStr}).\nهل تريد تعديل هذا السجل بدلاً من إنشاء سجل مكرر؟`)) {
          return;
        }
        existingRec = existingForDay;
      }
    }

    const checkInDateTime = cairoTimeToDate(dateStr, checkInVal);
    const checkInFormatted = checkInDateTime.toLocaleTimeString('ar-EG', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    let checkOutDateTime = null;
    let checkOutFormatted = null;
    let durationSeconds = 0;
    let status = 'حاضر';

    if (checkOutVal) {
      checkOutDateTime = cairoTimeToDate(dateStr, checkOutVal);
      // Overnight manual shift: if checkout <= checkin, checkout occurred the next day
      if (checkOutDateTime.getTime() <= checkInDateTime.getTime()) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const nextDayUtc = new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0));
        const nextDayStr = cairoDate(nextDayUtc);
        checkOutDateTime = cairoTimeToDate(nextDayStr, checkOutVal);
      }
      checkOutFormatted = checkOutDateTime.toLocaleTimeString('ar-EG', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      durationSeconds = Math.max(0, Math.floor((checkOutDateTime.getTime() - checkInDateTime.getTime()) / 1000));
      status = 'مكتمل';
    }

    // Merge into existing record if found, preserving deviceToken, createdAt, clockSkewMs and unknown fields
    const rec = existingRec ? { ...existingRec } : {
      id: 'REC_' + emp.id + '_' + dateStr,
      empId: emp.id,
      empName: emp.name,
      deviceToken: null,
      createdAt: new Date().toISOString()
    };

    rec.empName = emp.name;
    rec.date = dateStr;
    rec.checkInTime = checkInFormatted;
    rec.checkInTimeFormatted = checkInFormatted;
    rec.checkInTimeRaw = checkInDateTime.toISOString();
    rec.checkOutTime = checkOutFormatted;
    rec.checkOutTimeFormatted = checkOutFormatted;
    rec.checkOutTimeRaw = checkOutDateTime ? checkOutDateTime.toISOString() : null;
    rec.workSeconds = durationSeconds;
    rec.status = status;
    rec.notes = notes || 'سجل يدوي معدل';
    rec.updatedAt = new Date().toISOString();

    let isSynced = false;
    try {
      await window.cloudStore.saveAttendanceRecord(rec);
      isSynced = true;
    } catch (err) {
      isSynced = false;
    }

    const idx = this.attendanceRecords.findIndex(r => r.id === rec.id);
    if (idx >= 0) {
      this.attendanceRecords[idx] = rec;
    } else {
      this.attendanceRecords.unshift(rec);
    }

    this.closeModal('manual-record-modal');
    if (isSynced) {
      this.showToast('تم حفظ سجل الحضور بنجاح!', 'success');
    } else {
      this.showToast('تم الحفظ محلياً وسيتم الرفع عند توفر الإنترنت', 'warning');
    }
    this.renderAttendanceTable();
    this.renderAdminStats();
    this.renderEmployeesGrid();
  }

  async undoLastAttendanceAction() {
    if (this.scanBusy) return;
    this.scanBusy = true;

    const actionButtons = document.querySelectorAll('#employee-action-buttons button');
    actionButtons.forEach(b => { b.disabled = true; });

    try {
      if (!this.currentEmployee) return;
      const record = this.getActiveRecord(this.currentEmployee.id);
      if (!record || record.empId !== this.currentEmployee.id) {
        this.showToast('لا يوجد سجل حضور أو انصراف نشط للتراجع عنه', 'warning');
        return;
      }

      if (isManualRecord(record)) {
        this.showToast('لا يمكن التراجع عن السجلات اليدوية المضافة من الإدارة', 'warning');
        return;
      }

      const now = (window.cloudStore && typeof window.cloudStore.getServerNow === 'function')
        ? window.cloudStore.getServerNow()
        : new Date();

      if (record.checkOutTime) {
        // Undo Check-out: revert checkout fields within UNDO_WINDOW_SECONDS
        const outTime = new Date(record.checkOutTimeRaw || record.updatedAt || record.date).getTime();
        const elapsedSec = Math.max(0, Math.floor((now.getTime() - outTime) / 1000));
        if (elapsedSec > UNDO_WINDOW_SECONDS) {
          this.showToast('انتهت مهلة التراجع المسموحة (10 دقائق)!', 'warning');
          return;
        }

        if (!confirm('هل تريد بالتأكيد التراجع عن تسجيل الانصراف والعودة لحالة الحضور؟')) return;

        record.checkOutTime = null;
        record.checkOutTimeFormatted = null;
        record.checkOutTimeRaw = null;
        record.workSeconds = 0;
        record.status = 'حاضر';
        record.undoneCheckOutAt = now.toISOString();
        record.undoCount = (record.undoCount || 0) + 1;
        record.updatedAt = now.toISOString();

        try {
          await window.cloudStore.saveAttendanceRecord(record);
          this.showToast('تم التراجع عن تسجيل الانصراف بنجاح، يمكنك متابعة العمل أو الانصراف لاحقاً', 'success');
        } catch (err) {
          this.showToast('تم التراجع محلياً وسيتم المزامنة عند توفر الإنترنت', 'warning');
        }
      } else {
        // Undo Check-in: delete the open check-in record within UNDO_WINDOW_SECONDS
        const inTime = new Date(record.checkInTimeRaw || record.createdAt || record.date).getTime();
        const elapsedSec = Math.max(0, Math.floor((now.getTime() - inTime) / 1000));
        if (elapsedSec > UNDO_WINDOW_SECONDS) {
          this.showToast('انتهت مهلة التراجع المسموحة (10 دقائق)!', 'warning');
          return;
        }

        if (!confirm('هل تريد بالتأكيد التراجع عن تسجيل الحضور وحذف التسجيل؟')) return;

        this.attendanceRecords = this.attendanceRecords.filter(r => r.id !== record.id);
        localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(this.attendanceRecords));

        try {
          await window.cloudStore.deleteAttendanceRecord(record.id);
          this.showToast('تم التراجع عن تسجيل الحضور وحذف السجل بنجاح', 'success');
        } catch (err) {
          this.showToast('تم حذف السجل محلياً وسيتم المزامنة عند توفر الإنترنت', 'warning');
        }
      }
    } finally {
      this.scanBusy = false;
      this.renderEmployeeView();
      this.renderAdminView();
    }
  }

  async deleteRecord(recId) {
    if (!confirm('هل أنت متأكد من حذف هذا السجل نهائياً؟')) return;
    this.attendanceRecords = this.attendanceRecords.filter(r => r.id !== recId);
    try {
      await window.cloudStore.deleteAttendanceRecord(recId);
      this.showToast('تم حذف السجل بنجاح', 'info');
    } catch (err) {
      this.showToast('تم حذف السجل محلياً وسيتم المزامنة عند توفر الإنترنت', 'warning');
    } finally {
      this.renderAttendanceTable();
      this.renderAdminStats();
      this.renderEmployeesGrid();
    }
  }

  // Backup & JSON
  exportJsonBackup() {
    const data = {
      app: 'Al-Mustaqbal Attendance System',
      developer: 'Eng. Ahmed Mourad',
      exportedAt: new Date().toISOString(),
      employees: this.employees,
      attendanceRecords: this.attendanceRecords
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `نسخة_احتياطية_مركز_المستقبل_${cairoDate()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('تم تحميل ملف النسخة الاحتياطية بنجاح', 'success');
  }

  importJsonBackup(fileInput) {
    const file = fileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);

        // ── Schema validation ────────────────────────────────────────
        if (!Array.isArray(parsed.employees) || !Array.isArray(parsed.attendanceRecords)) {
          throw new Error('Invalid schema');
        }
        for (const r of parsed.attendanceRecords) {
          if (!r.id || !r.empId || !r.date) throw new Error('Invalid record schema');
        }

        // ── Employees merge ──────────────────────────────────────────
        // These fields must never be overwritten by an import
        const EMP_PROTECTED = ['deviceToken', 'allowDirectButton'];

        let empNew = 0, empUpdated = 0, empSkipped = 0;
        const empById = Object.fromEntries(this.employees.map(e => [e.id, e]));

        for (const incoming of parsed.employees) {
          if (!incoming.id) { empSkipped++; continue; }
          const existing = empById[incoming.id];
          if (!existing) {
            const safe = { ...incoming };
            EMP_PROTECTED.forEach(k => { delete safe[k]; });
            empById[incoming.id] = safe;
            empNew++;
          } else {
            const inTs = incoming.updatedAt ? new Date(incoming.updatedAt).getTime() : 0;
            const exTs = existing.updatedAt  ? new Date(existing.updatedAt).getTime()  : 0;
            if (inTs > exTs) {
              const safe = { ...incoming };
              EMP_PROTECTED.forEach(k => { safe[k] = existing[k]; });
              empById[incoming.id] = safe;
              empUpdated++;
            } else {
              empSkipped++;
            }
          }
        }
        this.employees = Object.values(empById);

        // ── Attendance records merge ─────────────────────────────────
        const REC_PROTECTED = ['deviceToken'];
        let recNew = 0, recUpdated = 0, recSkipped = 0;
        const recById = Object.fromEntries(this.attendanceRecords.map(r => [r.id, r]));

        for (const incoming of parsed.attendanceRecords) {
          if (!incoming.id || !incoming.empId || !incoming.date) { recSkipped++; continue; }
          const existing = recById[incoming.id];
          if (!existing) {
            recById[incoming.id] = { ...incoming };
            recNew++;
          } else {
            const inTs = incoming.updatedAt ? new Date(incoming.updatedAt).getTime() : 0;
            const exTs = existing.updatedAt  ? new Date(existing.updatedAt).getTime()  : 0;
            if (inTs > exTs) {
              const safe = { ...incoming };
              REC_PROTECTED.forEach(k => { safe[k] = existing[k]; });
              recById[incoming.id] = safe;
              recUpdated++;
            } else {
              recSkipped++;
            }
          }
        }
        this.attendanceRecords = Object.values(recById);

        // ── Persist locally ──────────────────────────────────────────
        localStorage.setItem('almustaqbal_employees', JSON.stringify(this.employees));
        localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(this.attendanceRecords));

        // Push to cloud (best-effort, non-blocking)
        (async () => {
          try {
            await window.cloudStore.saveAllEmployees(this.employees);
            await window.cloudStore.saveAllAttendanceRecords(this.attendanceRecords);
          } catch (_) {
            this.showToast('تم الحفظ محلياً وسيتم الرفع عند توفر الإنترنت', 'warning');
          }
        })();

        const total = recNew + recUpdated + recSkipped;
        this.showToast(
          `الاستيراد مكتمل — ${recNew} جديد، ${recUpdated} محدَث، ${recSkipped} تجاهل (من ${total} سجل)`,
          'success'
        );
        this.renderEmployeeView();
        this.renderAdminView();
      } catch (err) {
        this.showToast('الملف غير صالح أو تالف', 'error');
      }
    };
    reader.readAsText(file);
  }

  // Modals & Toasts
  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add('active');
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove('active');

    if (modalId === 'camera-scanner-modal' && this.html5QrCode) {
      const scanner = this.html5QrCode;
      this.html5QrCode = null;
      try {
        if (scanner.isScanning) {
          scanner.stop().catch(() => {}).finally(() => {
            try { scanner.clear(); } catch (e) {}
          });
        } else {
          try { scanner.clear(); } catch (e) {}
        }
      } catch (e) {}
      const scannerEl = document.getElementById('qr-camera-reader');
      if (scannerEl) scannerEl.innerHTML = '';
    }
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let iconClass = 'fa-info-circle';
    if (type === 'success') iconClass = 'fa-check-circle';
    if (type === 'error') iconClass = 'fa-exclamation-triangle';
    if (type === 'warning') iconClass = 'fa-bell';

    const iconEl = document.createElement('i');
    iconEl.className = `fas ${iconClass}`;
    const textEl = document.createElement('span');
    textEl.textContent = message;

    toast.appendChild(iconEl);
    toast.appendChild(textEl);
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  bindEvents() {
    const searchInput = document.getElementById('admin-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => this.renderAttendanceTable());
    }

    const dateFilter = document.getElementById('admin-date-filter');
    if (dateFilter) {
      dateFilter.addEventListener('change', () => this.renderAttendanceTable());
    }

    const empFilter = document.getElementById('admin-emp-filter');
    if (empFilter) {
      empFilter.addEventListener('change', () => this.renderAttendanceTable());
    }

    this.registerServiceWorker();
    this.setupPwaInstallPrompt();
  }

  // =========================================================================
  // PWA & MOBILE INSTALLATION (تثبيت التطبيق على الهاتف)
  // =========================================================================
  registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        console.log('✅ Service Worker registered:', reg.scope);

        // Listen for an updated SW becoming available
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // A new SW is waiting — the activate event will postMessage us
            }
          });
        });
      }).catch(err => {
        console.warn('Service Worker registration failed:', err);
      });

      // Receive SW_UPDATED message from the newly activated service worker
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'SW_UPDATED') {
          this.showToast('تم تحديث التطبيق — يرجى إعادة تحميل الصفحة للحصول على آخر التحديثات 🔄', 'info');
        }
      });
    });
  }

  setupPwaInstallPrompt() {
    this.deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      const installBtn = document.getElementById('btn-install-app');
      if (installBtn) {
        installBtn.style.display = 'inline-flex';
      }
    });

    window.addEventListener('appinstalled', () => {
      this.showToast('تم تثبيت تطبيق مركز المستقبل على هاتفك بنجاح! 🎉', 'success');
      const installBtn = document.getElementById('btn-install-app');
      if (installBtn) installBtn.style.display = 'none';
    });
  }

  promptInstallApp() {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    if (isIOS) {
      this.openModal('ios-install-modal');
      return;
    }

    if (this.deferredPrompt) {
      this.deferredPrompt.prompt();
      this.deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          this.showToast('جاري تثبيت التطبيق...', 'info');
        }
        this.deferredPrompt = null;
      });
    } else {
      // If prompt already dismissed or in Chrome desktop/Android menu
      this.showToast('يمكنك تثبيت التطبيق من قائمة خيارات المتصفح (⋮) ثم اختيار "تثبيت التطبيق" أو "إضافة للشاشة الرئيسية"', 'info');
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new AttendanceApp();
});
