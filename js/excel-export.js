/**
 * Excel (.xlsx) Report Generator for Al-Mustaqbal Attendance System
 * Built on SheetJS (xlsx.full.min.js)
 * Developer: Eng. Ahmed Mourad
 */

class ExcelExporter {
  static exportFullReport(records, employees, options = {}) {
    if (typeof XLSX === 'undefined') {
      alert('مكتبة الإكسيل غير محملة، يرجى التحقق من اتصال الإنترنت.');
      return;
    }

    const wb = XLSX.utils.book_new();

    // 1. Prepare Summary Sheet Data (ملخص الموظفين)
    const summaryData = [];
    summaryData.push(['تقرير ملخص ساعات عمل الموظفين - مركز المستقبل للخدمات التعليمية']);
    summaryData.push(['تاريخ استخراج التقرير:', new Date().toLocaleDateString('ar-EG', { dateStyle: 'full' })]);
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
        emp.code || '---',
        emp.name,
        emp.jobTitle || 'موظف',
        totalDays,
        `${totalHours} س و ${totalMinutes} د`,
        parseFloat(decimalHours),
        totalDays > 0 ? `${avgHours} س و ${avgMins} د` : '0'
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
    detailData.push(['الفترة:', options.dateFilterLabel || 'الكل']);
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
    const sortedRecords = [...records].sort((a, b) => new Date(b.date + ' ' + (b.checkInTimeRaw || '00:00:00')) - new Date(a.date + ' ' + (a.checkInTimeRaw || '00:00:00')));

    sortedRecords.forEach(r => {
      const emp = employees.find(e => e.id === r.empId) || { name: r.empName || 'غير معروف', code: '---' };
      const d = new Date(r.date);
      const dayName = isNaN(d.getTime()) ? '' : d.toLocaleDateString('ar-EG', { weekday: 'long' });
      
      const totalSec = r.workSeconds || 0;
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const formattedDuration = totalSec > 0 ? `${h} س و ${m} د و ${s} ث` : (r.status === 'حاضر' ? 'قيد العمل الآن' : '---');
      const decimalHours = totalSec > 0 ? parseFloat((totalSec / 3600).toFixed(2)) : 0;

      detailData.push([
        r.date,
        dayName,
        emp.code || '---',
        emp.name,
        r.checkInTimeFormatted || r.checkInTime || '---',
        r.checkOutTimeFormatted || r.checkOutTime || 'لم ينصرف بعد',
        formattedDuration,
        decimalHours,
        r.status || 'مكتمل',
        r.notes || ''
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
    const nowStr = new Date().toISOString().slice(0, 10);
    const fileName = `تقرير_حضور_وانصراف_مركز_المستقبل_${nowStr}.xlsx`;

    // Download file
    XLSX.writeFile(wb, fileName);
  }
}

window.ExcelExporter = ExcelExporter;
