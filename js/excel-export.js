/**
 * Excel (.xlsx) Report Generator for Al-Mustaqbal Attendance System
 * Built on SheetJS (xlsx.full.min.js)
 * Developer: Eng. Ahmed Mourad
 */

function sanitizeExcelCell(val) {
  if (typeof val === 'string' && val.length > 0) {
    const firstChar = val.charAt(0);
    if (firstChar === '=' || firstChar === '+' || firstChar === '-' || firstChar === '@') {
      return "'" + val;
    }
  }
  return val;
}

class ExcelExporter {
  static exportFullReport(records, employees, options = {}) {
    if (typeof XLSX === 'undefined') {
      alert('مكتبة الإكسيل غير محملة، يرجى التحقق من اتصال الإنترنت.');
      return;
    }

    if (!records || records.length === 0) {
      alert('لا توجد سجلات مطابقة للتصدير في هذه الفترة.');
      return;
    }

    const wb = XLSX.utils.book_new();

    // 1. Prepare Summary Sheet Data (ملخص الموظفين)
    const summaryData = [];
    summaryData.push(['تقرير ملخص ساعات عمل الموظفين - مركز المستقبل للخدمات التعليمية']);
    summaryData.push(['تاريخ استخراج التقرير:', new Date().toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'full' })]);
    summaryData.push([]); // Empty row
    summaryData.push([
      'كود الموظف',
      'اسم الموظف',
      'المسمى الوظيفي',
      'إجمالي أيام الحضور',
      'إجمالي ساعات العمل (ساعات ودقائق)',
      'إجمالي الساعات (رقم عشري)',
      'متوسط ساعات العمل اليومي'
    ]);

    employees.forEach(emp => {
      const empRecords = records.filter(r => r.empId === emp.id && r.workSeconds > 0);
      const totalDays = empRecords.length;
      const totalSeconds = empRecords.reduce((acc, r) => acc + (r.workSeconds || 0), 0);
      
      const totalHours = Math.floor(totalSeconds / 3600);
      const totalMinutes = Math.floor((totalSeconds % 3600) / 60);
      const decimalHours = (totalSeconds / 3600).toFixed(2);
      
      const avgSeconds = totalDays > 0 ? (totalSeconds / totalDays) : 0;
      const avgHours = Math.floor(avgSeconds / 3600);
      const avgMins = Math.floor((avgSeconds % 3600) / 60);

      summaryData.push([
        sanitizeExcelCell(emp.code || '---'),
        sanitizeExcelCell(emp.name),
        sanitizeExcelCell(emp.jobTitle || 'موظف'),
        totalDays,
        sanitizeExcelCell(`${totalHours} س و ${totalMinutes} د`),
        parseFloat(decimalHours),
        sanitizeExcelCell(totalDays > 0 ? `${avgHours} س و ${avgMins} د` : '0')
      ]);
    });

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    
    // Set RTL and column widths for Summary sheet
    wsSummary['!views'] = [{ RTL: true }];
    wsSummary['!cols'] = [
      { wch: 14 },
      { wch: 25 },
      { wch: 22 },
      { wch: 18 },
      { wch: 30 },
      { wch: 22 },
      { wch: 24 }
    ];

    XLSX.utils.book_append_sheet(wb, wsSummary, 'ملخص_الموظفين');

    // 2. Prepare Detailed Daily Log Sheet (السجل التفصيلي اليومي)
    const detailData = [];
    detailData.push(['سجل الحضور والانصراف التفصيلي بالثانية - مركز المستقبل']);
    detailData.push(['الفترة:', sanitizeExcelCell(options.dateFilterLabel || 'الكل')]);
    detailData.push([]); // Empty row
    detailData.push([
      'التاريخ',
      'اليوم',
      'كود الموظف',
      'اسم الموظف',
      'وقت الحضور (بالثانية)',
      'وقت الانصراف (بالثانية)',
      'مدة العمل (بالساعات والدقائق)',
      'مدة العمل (عشري)',
      'حالة السجل',
      'ملاحظات'
    ]);

    // Sort records chronologically descending
    const sortedRecords = [...records].sort((a, b) => new Date(b.checkInTimeRaw || b.date) - new Date(a.checkInTimeRaw || a.date));

    sortedRecords.forEach(r => {
      const emp = employees.find(e => e.id === r.empId) || { name: r.empName || 'غير معروف', code: '---' };
      
      // Parse YYYY-MM-DD manually to prevent UTC timezone shift
      let dayName = '';
      if (r.date) {
        const parts = String(r.date).split('-').map(Number);
        if (parts.length === 3 && !parts.some(isNaN)) {
          const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
          dayName = d.toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long' });
        }
      }
      
      const totalSec = r.workSeconds || 0;
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const formattedDuration = totalSec > 0 ? `${h} س و ${m} د و ${s} ث` : (r.status === 'حاضر' ? 'قيد العمل الآن' : '---');
      const decimalHours = totalSec > 0 ? parseFloat((totalSec / 3600).toFixed(2)) : 0;

      detailData.push([
        sanitizeExcelCell(r.date),
        sanitizeExcelCell(dayName),
        sanitizeExcelCell(emp.code || '---'),
        sanitizeExcelCell(emp.name),
        sanitizeExcelCell(r.checkInTimeFormatted || r.checkInTime || '---'),
        sanitizeExcelCell(r.checkOutTimeFormatted || r.checkOutTime || 'لم ينصرف بعد'),
        sanitizeExcelCell(formattedDuration),
        decimalHours,
        sanitizeExcelCell(r.status || 'مكتمل'),
        sanitizeExcelCell(r.notes || '')
      ]);
    });

    const wsDetail = XLSX.utils.aoa_to_sheet(detailData);
    wsDetail['!views'] = [{ RTL: true }];
    wsDetail['!cols'] = [
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 25 },
      { wch: 22 },
      { wch: 22 },
      { wch: 28 },
      { wch: 18 },
      { wch: 16 },
      { wch: 25 }
    ];

    XLSX.utils.book_append_sheet(wb, wsDetail, 'السجل_التفصيلي_اليومي');

    // Generate filename
    const nowStr = typeof cairoDate === 'function' ? cairoDate() : new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
    const fileName = `تقرير_حضور_وانصراف_مركز_المستقبل_${nowStr}.xlsx`;

    // Download file
    XLSX.writeFile(wb, fileName);
  }
}

window.ExcelExporter = ExcelExporter;
