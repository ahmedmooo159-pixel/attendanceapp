/**
 * Shared Time & Cairo Timezone Utilities - Al-Mustaqbal System
 * Africa/Cairo timezone handling with two-pass offset calculation and DST safety
 */

function cairoDate(d = new Date()) {
  const dateObj = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  return dateObj.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

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

function cairoTimeToDate(dateStr, timeStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const parts = String(timeStr || '00:00:00').split(':');
  const hh = parseInt(parts[0] || '0', 10);
  const mm = parseInt(parts[1] || '0', 10);
  const ss = parseInt(parts[2] || '0', 10);

  const targetUtcMs = Date.UTC(y, m - 1, d, hh, mm, ss);

  // Pass 1: Initial estimate
  const guess1 = new Date(targetUtcMs);
  const offset1 = cairoOffsetMs(guess1);
  const guess2 = new Date(targetUtcMs - offset1);

  // Pass 2: Refined estimate near target transition
  const offset2 = cairoOffsetMs(guess2);
  return new Date(targetUtcMs - offset2);
}

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

if (typeof window !== 'undefined') {
  window.cairoDate = cairoDate;
  window.cairoOffsetMs = cairoOffsetMs;
  window.cairoTimeToDate = cairoTimeToDate;
  window.cairoDateTimeToUtc = cairoTimeToDate; // backward compatibility
  window.getCairoTimeInputVal = getCairoTimeInputVal;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cairoDate,
    cairoOffsetMs,
    cairoTimeToDate,
    getCairoTimeInputVal
  };
}
