/**
 * تطبيق نظام الحضور والانصراف الذكي - مركز المستقبل للخدمات التعليمية
 * يبدأ بدون موظفين ويتم تسجيل الموظفين وربط هواتفهم تلقائياً من أول مسح (Scan)
 * تطوير وبرمجة: م. أحمد مراد
 */

const DEFAULT_ADMIN_PIN = '1234';
const STATION_SECRET_TOKEN = 'MSTQ_HQ_OFFICE_2026';

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
    const urlParams = new URLSearchParams(window.location.search);
    const station = urlParams.get('station');

    if (station && (station === 'almustaqbal_hq' || station === STATION_SECRET_TOKEN)) {
      window.history.replaceState({}, document.title, window.location.pathname);

      if (this.currentEmployee) {
        this.processAttendanceScan(this.currentEmployee);
      } else {
        // First time scanning on this phone -> Prompt to enter Name & Register
        this.openSelfRegisterModal(true); // true = auto check-in after registration
      }
    }
  }

  // Live Digital Clock (Down to the second)
  startLiveClock() {
    const updateClock = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('ar-EG', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
      const secStr = String(now.getSeconds()).padStart(2, '0');
      const dateStr = now.toLocaleDateString('ar-EG', {
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
    const todayStr = new Date().toISOString().slice(0, 10);
    return this.attendanceRecords.find(r => r.empId === empId && r.date === todayStr);
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
        <div class="emp-avatar">${initials}</div>
        <div class="emp-info">
          <div class="emp-name">${this.currentEmployee.name}</div>
          <div class="emp-job">${this.currentEmployee.jobTitle || 'موظف بمركز المستقبل'} - ${this.currentEmployee.code || ''}</div>
        </div>
        <div class="emp-device-badge">
          <i class="fas fa-check-circle"></i> هاتفك مسجل ومربوط
        </div>
      </div>
    `;

    const todayRecord = this.getTodayRecord(this.currentEmployee.id);

    if (!todayRecord) {
      // 1st Scan available: Check-In
      actionsContainer.innerHTML = `
        <button class="btn-big-action check-in" onclick="app.triggerDirectScanAction()">
          <i class="fas fa-sign-in-alt"></i> تسجيل الحضور الآن (Scan 1)
        </button>
        <button class="btn-big-action scan-camera" onclick="app.openCameraScannerModal()" style="font-size: 1.05rem; padding: 0.85rem;">
          <i class="fas fa-camera"></i> مسح كود المقر بالكاميرا
        </button>
      `;
      if (todayStatusCard) todayStatusCard.style.display = 'none';
    } else if (todayRecord && !todayRecord.checkOutTime) {
      // 2nd Scan available: Check-Out
      actionsContainer.innerHTML = `
        <button class="btn-big-action check-out" onclick="app.triggerDirectScanAction()">
          <i class="fas fa-sign-out-alt"></i> تسجيل الانصراف الآن (Scan 2)
        </button>
        <button class="btn-big-action scan-camera" onclick="app.openCameraScannerModal()" style="font-size: 1.05rem; padding: 0.85rem;">
          <i class="fas fa-camera"></i> مسح كود المقر بالكاميرا
        </button>
      `;

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
              <div class="time-value time-mono">${todayRecord.checkInTimeFormatted}</div>
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
      `;

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
              <div class="time-value time-mono">${todayRecord.checkInTimeFormatted}</div>
            </div>
            <div class="timeline-box">
              <span class="label">وقت الانصراف:</span>
              <div class="time-value time-mono">${todayRecord.checkOutTimeFormatted}</div>
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
    const updateDuration = () => {
      const el = document.getElementById('live-shift-duration');
      if (!el) return;
      const start = new Date(checkInIso).getTime();
      const now = new Date().getTime();
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
    const name = document.getElementById('self-reg-name').value.trim();
    const jobTitle = document.getElementById('self-reg-job').value.trim();
    const phone = document.getElementById('self-reg-phone').value.trim();

    if (!name) {
      this.showToast('يرجى كتابة الاسم بالكامل', 'warning');
      return;
    }

    const newCode = 'EMP-' + String(this.employees.length + 1).padStart(2, '0');
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
    await window.cloudStore.saveEmployee(newEmp);

    this.closeModal('self-register-modal');
    this.showToast(`مرحباً بك يا ${name}! تم ربط هاتفك بنجاح`, 'success');

    // Automatically register 1st scan Check-in!
    await this.processAttendanceScan(newEmp);
  }

  // Attendance Scan execution (Check-in or Check-out)
  async processAttendanceScan(employee) {
    if (!employee) {
      this.openSelfRegisterModal(true);
      return;
    }

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const nowTimeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    const nowIso = now.toISOString();

    let record = this.getTodayRecord(employee.id);

    if (!record) {
      // 1st Scan: CHECK-IN
      record = {
        id: 'REC_' + employee.id + '_' + todayStr,
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
        deviceToken: this.deviceToken,
        createdAt: nowIso
      };

      await window.cloudStore.saveAttendanceRecord(record);
      this.attendanceRecords.unshift(record);

      if (window.soundEffects) window.soundEffects.playCheckInSuccess();
      this.showToast(`أهلاً بك يا ${employee.name} 👋 تم تسجيل حضورك بنجاح في تمام ${nowTimeStr}`, 'success');
      this.renderEmployeeView();
      this.renderAdminView();
    } else if (record && !record.checkOutTime) {
      // 2nd Scan: CHECK-OUT
      const checkInDate = new Date(record.checkInTimeRaw);
      const durationSeconds = Math.max(0, Math.floor((now.getTime() - checkInDate.getTime()) / 1000));
      
      const hours = Math.floor(durationSeconds / 3600);
      const mins = Math.floor((durationSeconds % 3600) / 60);
      const secs = durationSeconds % 60;

      record.checkOutTime = nowTimeStr;
      record.checkOutTimeFormatted = nowTimeStr;
      record.checkOutTimeRaw = nowIso;
      record.workSeconds = durationSeconds;
      record.status = 'مكتمل';
      record.updatedAt = nowIso;

      await window.cloudStore.saveAttendanceRecord(record);

      const idx = this.attendanceRecords.findIndex(r => r.id === record.id);
      if (idx >= 0) this.attendanceRecords[idx] = record;

      if (window.soundEffects) window.soundEffects.playCheckOutSuccess();
      this.showToast(`مع السلامة يا ${employee.name}! تم تسجيل انصرافك بنجاح. مدة العمل: ${hours} س و ${mins} د و ${secs} ث`, 'success');
      this.renderEmployeeView();
      this.renderAdminView();
    } else {
      this.showToast(`لقد قمت بتسجيل الحضور والانصراف لهذا اليوم بالفعل`, 'warning');
    }
  }

  triggerDirectScanAction() {
    if (this.currentEmployee) {
      this.processAttendanceScan(this.currentEmployee);
    } else {
      this.openSelfRegisterModal(true);
    }
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

    await window.cloudStore.saveAdminPin(newPinInput);
    this.adminPin = newPinInput;

    this.closeModal('change-pin-modal');
    this.showToast('تم تغيير وحفظ رمز مرور الإدارة بنجاح!', 'success');
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
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayRecords = this.attendanceRecords.filter(r => r.date === todayStr);

    const presentNowCount = todayRecords.filter(r => r.status === 'حاضر' && !r.checkOutTime).length;
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
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

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
    }).sort((a, b) => new Date(b.date + ' ' + (b.checkInTimeRaw || '00:00:00')) - new Date(a.date + ' ' + (a.checkInTimeRaw || '00:00:00')));
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
        badgeHtml = '<span class="badge badge-success"><i class="fas fa-circle"></i> متواجد الآن</span>';
      }

      return `
        <tr>
          <td style="font-weight: 700;">${r.date}</td>
          <td style="font-weight: 800; font-size: 1.1rem; color: #fff;">${r.empName}</td>
          <td class="time-mono" style="color: var(--gold-light); font-weight: 800;">${r.checkInTimeFormatted || r.checkInTime || '---'}</td>
          <td class="time-mono" style="color: ${r.checkOutTime ? 'var(--text-primary)' : 'var(--text-muted)'}; font-weight: 800;">
            ${r.checkOutTimeFormatted || r.checkOutTime || 'لم ينصرف بعد'}
          </td>
          <td class="time-mono" style="font-weight: 800; color: #fff;">${formattedDuration}</td>
          <td>${badgeHtml}</td>
          <td>
            <div style="display: flex; gap: 0.4rem;">
              <button class="btn-icon-action" title="تعديل السجل يدوياً" onclick="app.openEditRecordModal('${r.id}')">
                <i class="fas fa-edit"></i>
              </button>
              <button class="btn-icon-action delete" title="حذف السجل" onclick="app.deleteRecord('${r.id}')">
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
              <div style="font-size: 1.25rem; font-weight: 900; color: #fff;">${emp.name}</div>
              <div style="font-size: 0.9rem; color: var(--gold-light);">${emp.jobTitle || 'موظف'} - ${emp.code || ''}</div>
            </div>
            <span class="badge ${isBound ? 'badge-success' : 'badge-warning'}">
              <i class="fas ${isBound ? 'fa-mobile-alt' : 'fa-exclamation-triangle'}"></i>
              ${isBound ? 'هاتف مربوط' : 'غير مربوط'}
            </span>
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
              <button class="nav-btn outline" style="padding: 0.4rem 0.85rem; font-size: 0.9rem;" onclick="app.unbindEmployeeDevice('${emp.id}')" title="فك ربط الهاتف ليتمكن من ربط هاتف جديد">
                <i class="fas fa-unlink"></i> فك ربط الهاتف
              </button>
            ` : ''}
            <button class="nav-btn outline" style="padding: 0.4rem 0.85rem; font-size: 0.9rem;" onclick="app.openEditEmployeeModal('${emp.id}')">
              <i class="fas fa-user-edit"></i> تعديل
            </button>
            <button class="btn-icon-action delete" style="width: 34px; height: 34px;" onclick="app.deleteEmployee('${emp.id}')">
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
      this.employees.map(e => `<option value="${e.id}" ${e.id === currentVal ? 'selected' : ''}>${e.name}</option>`).join('');
  }

  exportExcelReport() {
    const filtered = this.getFilteredRecords();
    const dateFilter = document.getElementById('admin-date-filter');
    const dateLabel = dateFilter ? dateFilter.options[dateFilter.selectedIndex].text : 'الكل';

    if (window.ExcelExporter) {
      window.ExcelExporter.exportFullReport(this.attendanceRecords, this.employees, {
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

  startCameraScanner() {
    if (typeof Html5Qrcode === 'undefined') {
      this.showToast('مكتبة قارئ الكاميرا غير محملة', 'error');
      return;
    }

    const scannerEl = document.getElementById('qr-camera-reader');
    if (!scannerEl) return;

    if (this.html5QrCode) {
      try { this.html5QrCode.stop(); } catch (e) {}
    }

    this.html5QrCode = new Html5Qrcode('qr-camera-reader');
    const config = { fps: 10, qrbox: { width: 250, height: 250 } };

    this.html5QrCode.start(
      { facingMode: 'environment' },
      config,
      (decodedText) => {
        this.html5QrCode.stop().then(() => {
          this.closeModal('camera-scanner-modal');
          this.handleScannedQrResult(decodedText);
        }).catch(() => {
          this.closeModal('camera-scanner-modal');
          this.handleScannedQrResult(decodedText);
        });
      },
      (error) => {}
    ).catch(err => {
      console.warn('Camera start error:', err);
      this.showToast('تعذر تشغيل الكاميرا، يرجى السماح بالوصول للكاميرا في المتصفح', 'error');
    });
  }

  stopCameraScanner() {
    if (this.html5QrCode) {
      this.html5QrCode.stop().catch(err => console.warn(err));
    }
    this.closeModal('camera-scanner-modal');
  }

  handleScannedQrResult(decodedText) {
    if (decodedText.includes('station=almustaqbal_hq') || decodedText.includes(STATION_SECRET_TOKEN)) {
      if (this.currentEmployee) {
        this.processAttendanceScan(this.currentEmployee);
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
    document.getElementById('emp-form-code').value = 'EMP-' + String(this.employees.length + 1).padStart(2, '0');
    document.getElementById('emp-form-job').value = '';
    document.getElementById('emp-form-phone').value = '';
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

    let emp;
    if (id) {
      emp = this.employees.find(e => e.id === id);
      if (emp) {
        emp.name = name;
        emp.code = code;
        emp.jobTitle = jobTitle;
        emp.phone = phone;
      }
    } else {
      emp = {
        id: 'emp_' + Date.now(),
        name,
        code: code || ('EMP-' + String(this.employees.length + 1).padStart(2, '0')),
        jobTitle: jobTitle || 'موظف',
        phone,
        deviceToken: null,
        createdAt: new Date().toISOString()
      };
      this.employees.push(emp);
    }

    await window.cloudStore.saveEmployee(emp);
    this.closeModal('employee-form-modal');
    this.showToast('تم حفظ بيانات الموظف بنجاح', 'success');
    this.renderEmployeesGrid();
    this.populateEmployeeFilters();
  }

  async unbindEmployeeDevice(empId) {
    if (!confirm('هل أنت متأكد من فك ربط هذا الهاتف؟ سيمكن للموظف ربط هاتف جديد بعد ذلك.')) return;
    const emp = this.employees.find(e => e.id === empId);
    if (emp) {
      emp.deviceToken = null;
      await window.cloudStore.saveEmployee(emp);

      if (this.currentEmployee && this.currentEmployee.id === empId) {
        localStorage.removeItem('almustaqbal_bound_emp_id');
        this.currentEmployee = null;
      }

      this.showToast(`تم فك ربط الهاتف عن الموظف (${emp.name})`, 'info');
      this.renderEmployeeView();
      this.renderAdminView();
    }
  }

  async deleteEmployee(empId) {
    const emp = this.employees.find(e => e.id === empId);
    if (!emp) return;
    if (!confirm(`هل أنت متأكد من حذف الموظف (${emp.name}) نهائياً؟`)) return;

    this.employees = this.employees.filter(e => e.id !== empId);
    await window.cloudStore.deleteEmployee(empId);

    this.showToast('تم حذف الموظف بنجاح', 'success');
    this.renderEmployeesGrid();
    this.populateEmployeeFilters();
  }

  // Manual Attendance Record
  openManualRecordModal() {
    if (this.employees.length === 0) {
      this.showToast('يرجى إضافة موظف أولاً أو انتظار تسجيل أول موظف', 'warning');
      return;
    }

    document.getElementById('manual-rec-id').value = '';
    const empSelect = document.getElementById('manual-rec-emp');
    empSelect.innerHTML = this.employees.map(e => `<option value="${e.id}">${e.name}</option>`).join('');

    document.getElementById('manual-rec-date').value = new Date().toISOString().slice(0, 10);
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
    empSelect.innerHTML = this.employees.map(e => `<option value="${e.id}" ${e.id === rec.empId ? 'selected' : ''}>${e.name}</option>`).join('');

    document.getElementById('manual-rec-date').value = rec.date;
    
    let inTime = '09:00:00';
    if (rec.checkInTimeRaw) {
      inTime = new Date(rec.checkInTimeRaw).toTimeString().slice(0, 8);
    }
    let outTime = '';
    if (rec.checkOutTimeRaw) {
      outTime = new Date(rec.checkOutTimeRaw).toTimeString().slice(0, 8);
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

    const checkInDateTime = new Date(`${dateStr}T${checkInVal}`);
    const checkInFormatted = checkInDateTime.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    let checkOutDateTime = null;
    let checkOutFormatted = null;
    let durationSeconds = 0;
    let status = 'حاضر';

    if (checkOutVal) {
      checkOutDateTime = new Date(`${dateStr}T${checkOutVal}`);
      checkOutFormatted = checkOutDateTime.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      durationSeconds = Math.max(0, Math.floor((checkOutDateTime.getTime() - checkInDateTime.getTime()) / 1000));
      status = 'مكتمل';
    }

    const rec = {
      id: id || ('REC_' + emp.id + '_' + dateStr + '_' + Date.now().toString(36)),
      empId: emp.id,
      empName: emp.name,
      date: dateStr,
      checkInTime: checkInFormatted,
      checkInTimeFormatted: checkInFormatted,
      checkInTimeRaw: checkInDateTime.toISOString(),
      checkOutTime: checkOutFormatted,
      checkOutTimeFormatted: checkOutFormatted,
      checkOutTimeRaw: checkOutDateTime ? checkOutDateTime.toISOString() : null,
      workSeconds: durationSeconds,
      status: status,
      notes: notes || 'سجل يدوي معدل',
      updatedAt: new Date().toISOString()
    };

    await window.cloudStore.saveAttendanceRecord(rec);

    const idx = this.attendanceRecords.findIndex(r => r.id === rec.id);
    if (idx >= 0) {
      this.attendanceRecords[idx] = rec;
    } else {
      this.attendanceRecords.unshift(rec);
    }

    this.closeModal('manual-record-modal');
    this.showToast('تم حفظ سجل الحضور بنجاح!', 'success');
    this.renderAttendanceTable();
    this.renderAdminStats();
    this.renderEmployeesGrid();
  }

  async deleteRecord(recId) {
    if (!confirm('هل أنت متأكد من حذف هذا السجل نهائياً؟')) return;
    this.attendanceRecords = this.attendanceRecords.filter(r => r.id !== recId);
    await window.cloudStore.deleteAttendanceRecord(recId);

    this.showToast('تم حذف السجل بنجاح', 'info');
    this.renderAttendanceTable();
    this.renderAdminStats();
    this.renderEmployeesGrid();
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
    a.download = `نسخة_احتياطية_مركز_المستقبل_${new Date().toISOString().slice(0, 10)}.json`;
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
        if (parsed.employees && parsed.attendanceRecords) {
          this.employees = parsed.employees;
          this.attendanceRecords = parsed.attendanceRecords;
          localStorage.setItem('almustaqbal_employees', JSON.stringify(this.employees));
          localStorage.setItem('almustaqbal_attendance_records', JSON.stringify(this.attendanceRecords));
          this.showToast('تمت استعادة البيانات بنجاح!', 'success');
          this.renderEmployeeView();
          this.renderAdminView();
        } else {
          throw new Error('Invalid schema');
        }
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
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-triangle';
    if (type === 'warning') icon = 'fa-bell';

    toast.innerHTML = `<i class="fas ${icon}"></i> <span>${message}</span>`;
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
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new AttendanceApp();
});
