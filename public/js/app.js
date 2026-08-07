// Global State
let currentStatus = 'clocked_out';
let activeShift = null;
let currentEvent = null;
let shiftSettings = {
  shift_hours: 8,
  break_mins: 15,
  lunch_mins: 30,
  lunch_after_hours: 4,
  warning_lead_mins: 3,
  ntfy_target: ''
};

let timerInterval = null;

// DOM Element References
const liveClockEl = document.getElementById('live-clock');
const statusBadgeEl = document.getElementById('status-badge');
const timerDisplayEl = document.getElementById('timer-display');
const timerSubtextEl = document.getElementById('timer-subtext');
const progressWrapperEl = document.getElementById('progress-wrapper');
const progressFillEl = document.getElementById('progress-fill');
const progressLabelEl = document.getElementById('progress-label');
const actionsGridEl = document.getElementById('actions-grid');

const metricWorkTimeEl = document.getElementById('metric-work-time');
const metricBreakTimeEl = document.getElementById('metric-break-time');
const metricLunchTimeEl = document.getElementById('metric-lunch-time');
const logsTbodyEl = document.getElementById('logs-tbody');

// Modals
const settingsModalEl = document.getElementById('settings-modal');
const manualLogModalEl = document.getElementById('manual-log-modal');

// Init application
document.addEventListener('DOMContentLoaded', () => {
  startLiveClock();
  fetchStatus();
  fetchLogs();
  fetchWeeklySummary();
  setupEventListeners();
  setupSse();
  initServiceWorker();
});

// Live Clock in Header
function startLiveClock() {
  function updateClock() {
    const now = new Date();
    liveClockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 1000);
}

// Fetch Status from Backend
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    currentStatus = data.status;
    activeShift = data.activeShift;
    currentEvent = data.currentEvent;
    if (data.settings) shiftSettings = data.settings;

    updateUI(data);
  } catch (err) {
    console.error('Error fetching status:', err);
  }
}

// Update UI based on current status
function updateUI(data) {
  // Update status badge
  statusBadgeEl.className = `status-badge status-${currentStatus}`;
  statusBadgeEl.textContent = currentStatus.replace('_', ' ').toUpperCase();

  // Update totals metrics
  if (data.todayTotals) {
    metricWorkTimeEl.textContent = formatMsToHM(data.todayTotals.workMs);
    metricBreakTimeEl.textContent = formatMsToHM(data.todayTotals.breakMs);
    metricLunchTimeEl.textContent = formatMsToHM(data.todayTotals.lunchMs);
  }

  // Render Action Buttons
  renderActionButtons();

  // Handle active timer loop
  if (timerInterval) clearInterval(timerInterval);

  if (currentStatus === 'clocked_out' || !currentEvent) {
    timerDisplayEl.textContent = '00:00:00';
    timerSubtextEl.textContent = 'Click below to clock in for your shift';
    progressWrapperEl.style.display = 'none';
    progressLabelEl.textContent = '';
  } else {
    runActiveTimer();
    timerInterval = setInterval(runActiveTimer, 1000);
  }
}

// Active Timer tick function
function runActiveTimer() {
  if (!currentEvent) return;

  const now = new Date().getTime();
  const start = new Date(currentEvent.start_time).getTime();
  const elapsedMs = Math.max(0, now - start);
  const elapsedMins = elapsedMs / (1000 * 60);

  timerDisplayEl.textContent = formatMsToHMS(elapsedMs);

  const breakMins = parseFloat(shiftSettings.break_mins || 15);
  const lunchMins = parseFloat(shiftSettings.lunch_mins || 30);

  if (currentStatus === 'working') {
    timerSubtextEl.textContent = 'Working (Active Work Session)';
    progressWrapperEl.style.display = 'none';
    progressLabelEl.textContent = '';
  } else if (currentStatus === 'break') {
    timerSubtextEl.textContent = `On Break (${breakMins} min target)`;
    progressWrapperEl.style.display = 'block';

    const pct = Math.min(100, (elapsedMins / breakMins) * 100);
    progressFillEl.style.width = `${pct}%`;

    const remainingMins = breakMins - elapsedMins;
    if (remainingMins > 0) {
      const rm = Math.floor(remainingMins);
      const rs = Math.floor((remainingMins - rm) * 60);
      progressLabelEl.textContent = `⏳ ${rm}m ${rs}s remaining in break`;
      if (remainingMins <= parseFloat(shiftSettings.warning_lead_mins || 3)) {
        progressFillEl.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
      } else {
        progressFillEl.style.background = 'linear-gradient(90deg, #3b82f6, #f59e0b)';
      }
    } else {
      progressLabelEl.textContent = '⚠️ Break time expired! Please clock back into work.';
      progressFillEl.style.background = '#ef4444';
      if (!isAlarmActive) {
        startContinuousAudioAlarm('⏰ Break Time Expired!', `Your ${breakMins}-minute break is over. Please clock back in!`);
      }
    }
  } else if (currentStatus === 'lunch') {
    timerSubtextEl.textContent = `On Lunch (${lunchMins} min target)`;
    progressWrapperEl.style.display = 'block';

    const pct = Math.min(100, (elapsedMins / lunchMins) * 100);
    progressFillEl.style.width = `${pct}%`;

    const remainingMins = lunchMins - elapsedMins;
    if (remainingMins > 0) {
      const rm = Math.floor(remainingMins);
      const rs = Math.floor((remainingMins - rm) * 60);
      progressLabelEl.textContent = `⏳ ${rm}m ${rs}s remaining in lunch`;
      if (remainingMins <= parseFloat(shiftSettings.warning_lead_mins || 3)) {
        progressFillEl.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
      } else {
        progressFillEl.style.background = 'linear-gradient(90deg, #3b82f6, #f59e0b)';
      }
    } else {
      progressLabelEl.textContent = '⚠️ Lunch period expired! Please clock back into work.';
      progressFillEl.style.background = '#ef4444';
      if (!isAlarmActive) {
        startContinuousAudioAlarm('⏰ Lunch Period Expired!', `Your ${lunchMins}-minute lunch break is over. Please clock back in!`);
      }
    }
  }
}

// Render dynamic action buttons
function renderActionButtons() {
  actionsGridEl.innerHTML = '';

  if (currentStatus === 'clocked_out') {
    actionsGridEl.innerHTML = `
      <button class="btn btn-success btn-lg" onclick="handleClockAction('clock_in')">
        <span>▶</span> Clock In Now
      </button>
      <button class="btn btn-secondary btn-lg" onclick="openCustomClockInModal()">
        <span>🕒</span> Custom Start Time
      </button>
    `;
  } else if (currentStatus === 'working') {
    const shiftStartTimeStr = activeShift ? new Date(activeShift.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    actionsGridEl.innerHTML = `
      <button class="btn btn-warning" onclick="handleClockAction('start_break')">
        <span>☕</span> Take Break
      </button>
      <button class="btn btn-primary" onclick="handleClockAction('start_lunch')">
        <span>🥪</span> Take Lunch
      </button>
      <button class="btn btn-danger" onclick="handleClockAction('clock_out')">
        <span>⏹</span> Clock Out
      </button>
      <div style="width: 100%; margin-top: 0.75rem;">
        <button class="btn btn-secondary btn-sm" onclick="openEditStartTimeModal()" style="font-size: 0.8rem;">
          ✏️ Edit Start Time (Started at ${shiftStartTimeStr})
        </button>
      </div>
    `;
  } else if (currentStatus === 'break') {
    actionsGridEl.innerHTML = `
      <button class="btn btn-success btn-lg" onclick="handleClockAction('end_break')">
        <span>💼</span> End Break & Resume Work
      </button>
      <button class="btn btn-danger" onclick="handleClockAction('clock_out')">
        <span>⏹</span> Clock Out
      </button>
    `;
  } else if (currentStatus === 'lunch') {
    actionsGridEl.innerHTML = `
      <button class="btn btn-success btn-lg" onclick="handleClockAction('end_lunch')">
        <span>💼</span> End Lunch & Resume Work
      </button>
      <button class="btn btn-danger" onclick="handleClockAction('clock_out')">
        <span>⏹</span> Clock Out
      </button>
    `;
  }
}

// Handle clock button action click
async function handleClockAction(action) {
  stopContinuousAudioAlarm();
  try {
    const res = await fetch('/api/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const data = await res.json();

    if (!res.ok) {
      showToast('Error', data.error || 'Clock action failed', 'danger');
      return;
    }

    showToast('Success', data.message, 'success');
    await fetchStatus();
    await fetchLogs();
    await fetchWeeklySummary(currentWeekStartStr || '');
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
}

// Weekly Summary State & Functions
let currentWeekStartStr = null;
let cachedWeeklyData = null;

async function fetchWeeklySummary(weekStartStr = '') {
  try {
    const res = await fetch(`/api/weekly-summary?week_start=${weekStartStr}`);
    const data = await res.json();
    cachedWeeklyData = data;
    currentWeekStartStr = data.week_start;

    document.getElementById('week-range-label').textContent = `Mon ${data.week_start} - Sun ${data.week_end}`;
    document.getElementById('week-total-hours').textContent = data.total_work_hours;

    const tbody = document.getElementById('weekly-tbody');
    tbody.innerHTML = data.days.map(d => {
      const isWork = parseFloat(d.work_hours) > 0;
      const hoursClass = isWork ? 'week-hours-highlight' : '';
      return `
        <tr>
          <td><strong>${d.day_name}</strong></td>
          <td>${d.short_date}</td>
          <td>${d.first_clock_in}</td>
          <td>${d.lunch_out}</td>
          <td>${d.lunch_in}</td>
          <td>${d.last_clock_out}</td>
          <td>${d.lunch_hours}</td>
          <td class="${hoursClass}">${d.work_hours}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching weekly summary:', err);
  }
}

function navigateWeek(offsetDays) {
  if (!currentWeekStartStr) return;
  const current = new Date(currentWeekStartStr + 'T00:00:00');
  current.setDate(current.getDate() + offsetDays);
  const newStartStr = current.toISOString().split('T')[0];
  fetchWeeklySummary(newStartStr);
}

function copyAgile1Summary() {
  if (!cachedWeeklyData) return;
  const data = cachedWeeklyData;

  let text = `Agile1 / PPM Timesheet Summary (${data.week_start} to ${data.week_end})\n`;
  text += `----------------------------------------------------------------------\n`;
  data.days.forEach(d => {
    if (parseFloat(d.work_hours) > 0) {
      let punchText = `In: ${d.first_clock_in}`;
      if (d.lunch_out !== '-') {
        punchText += ` | Lunch: ${d.lunch_out} - ${d.lunch_in}`;
      }
      punchText += ` | Out: ${d.last_clock_out}`;
      text += `${d.day_name.slice(0, 3)} (${d.short_date}): ${d.work_hours} hrs  [${punchText}]\n`;
    } else {
      text += `${d.day_name.slice(0, 3)} (${d.short_date}): 0.00 hrs\n`;
    }
  });
  text += `----------------------------------------------------------------------\n`;
  text += `Total Net Work Hours: ${data.total_work_hours} hrs\n`;

  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied!', 'Weekly decimal hours & lunch punches copied to clipboard for Agile1 / PPM.', 'success');
  }).catch(err => {
    // Fallback if clipboard API restricted
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    showToast('Copied!', 'Weekly decimal hours & lunch punches copied to clipboard.', 'success');
  });
}

let cachedShiftLogs = [];

// Fetch logs list
async function fetchLogs() {
  try {
    const res = await fetch('/api/logs');
    const logs = await res.json();
    cachedShiftLogs = logs;

    if (!Array.isArray(logs) || logs.length === 0) {
      logsTbodyEl.innerHTML = `
        <tr>
          <td colspan="9" class="text-center">No shift records found yet.</td>
        </tr>
      `;
      return;
    }

    logsTbodyEl.innerHTML = logs.map(shift => {
      const clockIn = new Date(shift.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const clockOut = shift.end_time ? new Date(shift.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active';
      const lunchOut = shift.lunchOut ? new Date(shift.lunchOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-';
      const lunchIn = shift.lunchIn ? new Date(shift.lunchIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (shift.lunchOut ? 'On Lunch' : '-');
      const statusBadge = `<span class="status-badge status-${shift.status}">${shift.status.replace('_', ' ')}</span>`;

      return `
        <tr>
          <td><strong>${shift.date}</strong></td>
          <td>${clockIn}</td>
          <td>${lunchOut}</td>
          <td>${lunchIn}</td>
          <td>${clockOut}</td>
          <td>${formatMsToHM(shift.workMs)}</td>
          <td>${formatMsToHM(shift.lunchMs)}</td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="openEditShiftModal(${shift.id})">✏️ Edit</button>
            <button class="btn btn-danger btn-sm" onclick="deleteLog(${shift.id})">🗑️ Delete</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading logs:', err);
  }
}

// Open Edit Shift Punches Modal
function openEditShiftModal(shiftId) {
  const shift = cachedShiftLogs.find(s => s.id === Number(shiftId));
  if (!shift) return;

  const formatIsoLocal = (dStr) => {
    if (!dStr) return '';
    const d = new Date(dStr);
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  document.getElementById('edit-shift-id').value = shift.id;
  document.getElementById('edit-shift-date').value = shift.date;
  document.getElementById('edit-clock-in').value = formatIsoLocal(shift.start_time);
  document.getElementById('edit-lunch-out').value = formatIsoLocal(shift.lunchOut);
  document.getElementById('edit-lunch-in').value = formatIsoLocal(shift.lunchIn);
  document.getElementById('edit-clock-out').value = formatIsoLocal(shift.end_time);

  document.getElementById('edit-shift-modal').style.display = 'flex';
}

// Save Edit Shift Punches
async function saveEditShift(e) {
  e.preventDefault();
  const shiftId = document.getElementById('edit-shift-id').value;
  const clockInVal = document.getElementById('edit-clock-in').value;
  const clockOutVal = document.getElementById('edit-clock-out').value;
  const lunchOutVal = document.getElementById('edit-lunch-out').value;
  const lunchInVal = document.getElementById('edit-lunch-in').value;

  const payload = {
    date: document.getElementById('edit-shift-date').value,
    start_time: clockInVal ? new Date(clockInVal).toISOString() : null,
    lunch_out: lunchOutVal ? new Date(lunchOutVal).toISOString() : null,
    lunch_in: lunchInVal ? new Date(lunchInVal).toISOString() : null,
    end_time: clockOutVal ? new Date(clockOutVal).toISOString() : null
  };

  try {
    const res = await fetch(`/api/logs/${shiftId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Updated', 'Shift punches updated successfully!', 'success');
      document.getElementById('edit-shift-modal').style.display = 'none';
      fetchLogs();
      fetchWeeklySummary();
      fetchStatus();
    } else {
      showToast('Error', data.error || 'Failed to update punches', 'danger');
    }
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
}

// Delete Log
async function deleteLog(id) {
  if (!confirm('Are you sure you want to delete this shift log?')) return;
  try {
    const res = await fetch(`/api/logs/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Deleted', 'Shift log removed', 'success');
      fetchLogs();
      fetchWeeklySummary();
      fetchStatus();
    }
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
}

// Event Listeners setup
function setupEventListeners() {
  // Settings Modal open/close
  document.getElementById('btn-open-settings').addEventListener('click', openSettingsModal);
  document.getElementById('btn-close-settings').addEventListener('click', () => settingsModalEl.style.display = 'none');
  document.getElementById('btn-cancel-settings').addEventListener('click', () => settingsModalEl.style.display = 'none');
  document.getElementById('settings-form').addEventListener('submit', saveSettings);

  // Manual Log Modal open/close
  document.getElementById('btn-open-manual-log').addEventListener('click', openManualLogModal);
  document.getElementById('btn-close-manual-log').addEventListener('click', () => manualLogModalEl.style.display = 'none');
  document.getElementById('btn-cancel-manual-log').addEventListener('click', () => manualLogModalEl.style.display = 'none');
  document.getElementById('manual-log-form').addEventListener('submit', saveManualLog);

  // Notification Test & WebPush buttons
  document.getElementById('btn-test-notification').addEventListener('click', sendTestNotification);
  document.getElementById('btn-enable-webpush').addEventListener('click', enableWebPush);

  // CSV Export
  document.getElementById('btn-export-csv').addEventListener('click', exportCsv);

  // Custom Clock In Modal open/close/submit
  const customClockInModalEl = document.getElementById('custom-clockin-modal');
  document.getElementById('btn-close-custom-clockin').addEventListener('click', () => customClockInModalEl.style.display = 'none');
  document.getElementById('btn-cancel-custom-clockin').addEventListener('click', () => customClockInModalEl.style.display = 'none');
  document.getElementById('custom-clockin-form').addEventListener('submit', submitCustomClockIn);

  // Weekly Timesheet Navigation & Copy
  document.getElementById('btn-prev-week').addEventListener('click', () => navigateWeek(-7));
  document.getElementById('btn-current-week').addEventListener('click', () => fetchWeeklySummary());
  document.getElementById('btn-next-week').addEventListener('click', () => navigateWeek(7));
  document.getElementById('btn-copy-agile1').addEventListener('click', copyAgile1Summary);

  // Alarm Banner Mute button
  const stopAlarmBtn = document.getElementById('btn-stop-alarm');
  if (stopAlarmBtn) {
    stopAlarmBtn.addEventListener('click', stopContinuousAudioAlarm);
  }

  // Edit Shift Punches Modal open/close/submit
  const editShiftModalEl = document.getElementById('edit-shift-modal');
  document.getElementById('btn-close-edit-shift').addEventListener('click', () => editShiftModalEl.style.display = 'none');
  document.getElementById('btn-cancel-edit-shift').addEventListener('click', () => editShiftModalEl.style.display = 'none');
  document.getElementById('edit-shift-form').addEventListener('submit', saveEditShift);
}

// Open Settings Modal
async function openSettingsModal() {
  try {
    const res = await fetch('/api/settings');
    const settings = await res.json();
    shiftSettings = settings;

    document.getElementById('set-shift-hours').value = settings.shift_hours || 8;
    document.getElementById('set-break-mins').value = settings.break_mins || 15;
    document.getElementById('set-lunch-mins').value = settings.lunch_mins || 30;
    document.getElementById('set-break-after').value = settings.break_after_hours || 2;
    document.getElementById('set-lunch-after').value = settings.lunch_after_hours || 4;
    document.getElementById('set-warning-lead').value = settings.warning_lead_mins || 3;
    document.getElementById('set-ntfy-target').value = settings.ntfy_target || '';

    updatePushStatusText();
    settingsModalEl.style.display = 'flex';
  } catch (err) {
    showToast('Error', 'Failed to load settings', 'danger');
  }
}

// Save Settings
async function saveSettings(e) {
  e.preventDefault();
  const payload = {
    shift_hours: document.getElementById('set-shift-hours').value,
    break_mins: document.getElementById('set-break-mins').value,
    lunch_mins: document.getElementById('set-lunch-mins').value,
    break_after_hours: document.getElementById('set-break-after').value,
    lunch_after_hours: document.getElementById('set-lunch-after').value,
    warning_lead_mins: document.getElementById('set-warning-lead').value,
    ntfy_target: document.getElementById('set-ntfy-target').value
  };

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('Saved', 'Settings updated successfully', 'success');
      settingsModalEl.style.display = 'none';
      fetchStatus();
    }
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
}

// Open Manual Log Modal
function openManualLogModal() {
  const now = new Date();
  document.getElementById('log-date').value = now.toISOString().split('T')[0];
  
  // Format YYYY-MM-THH:mm
  const formatIsoLocal = (d) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  };

  const eightHoursAgo = new Date(now.getTime() - (8 * 60 * 60 * 1000));
  document.getElementById('log-start-time').value = formatIsoLocal(eightHoursAgo);
  document.getElementById('log-end-time').value = formatIsoLocal(now);

  manualLogModalEl.style.display = 'flex';
}

// Save Manual Log
async function saveManualLog(e) {
  e.preventDefault();
  const clockInVal = document.getElementById('log-start-time').value;
  const clockOutVal = document.getElementById('log-end-time').value;
  const lunchOutVal = document.getElementById('log-lunch-out').value;
  const lunchInVal = document.getElementById('log-lunch-in').value;

  const payload = {
    date: document.getElementById('log-date').value,
    start_time: clockInVal ? new Date(clockInVal).toISOString() : null,
    lunch_out: lunchOutVal ? new Date(lunchOutVal).toISOString() : null,
    lunch_in: lunchInVal ? new Date(lunchInVal).toISOString() : null,
    end_time: clockOutVal ? new Date(clockOutVal).toISOString() : null
  };

  try {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast('Success', 'Manual shift punches logged', 'success');
      manualLogModalEl.style.display = 'none';
      fetchLogs();
      fetchWeeklySummary();
      fetchStatus();
    }
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
}

// Open Custom Clock In Modal
function openCustomClockInModal() {
  const now = new Date();
  const formatIsoLocal = (d) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  };
  document.getElementById('custom-clockin-time').value = formatIsoLocal(now);
  document.getElementById('custom-clockin-modal').style.display = 'flex';
}

// Submit Custom Clock In
async function submitCustomClockIn(e) {
  e.preventDefault();
  const timeVal = document.getElementById('custom-clockin-time').value;
  if (!timeVal) return;

  try {
    const res = await fetch('/api/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'clock_in',
        custom_start_time: new Date(timeVal).toISOString()
      })
    });
    const data = await res.json();
    if (!res.ok) {
      showToast('Error', data.error || 'Clock in failed', 'danger');
      return;
    }

    showToast('Success', data.message, 'success');
    document.getElementById('custom-clockin-modal').style.display = 'none';
    await fetchStatus();
    await fetchLogs();
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
}

// Open Edit Start Time Modal for Active Shift
function openEditStartTimeModal() {
  const customClockInModalEl = document.getElementById('custom-clockin-modal');
  const now = activeShift ? new Date(activeShift.start_time) : new Date();
  const formatIsoLocal = (d) => {
    const tzOffset = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
  };
  document.getElementById('custom-clockin-time').value = formatIsoLocal(now);
  
  const form = document.getElementById('custom-clockin-form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const timeVal = document.getElementById('custom-clockin-time').value;
    try {
      const res = await fetch('/api/clock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_start_time',
          custom_start_time: new Date(timeVal).toISOString()
        })
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Updated', 'Shift start time adjusted', 'success');
        customClockInModalEl.style.display = 'none';
        form.onsubmit = submitCustomClockIn;
        fetchStatus();
        fetchLogs();
      } else {
        showToast('Error', data.error || 'Update failed', 'danger');
      }
    } catch (err) {
      showToast('Error', err.message, 'danger');
    }
  };

  customClockInModalEl.style.display = 'flex';
}

// CSV Export
async function exportCsv() {
  try {
    const res = await fetch('/api/logs?limit=500');
    const logs = await res.json();

    if (!logs.length) {
      showToast('Notice', 'No logs to export', 'warning');
      return;
    }

    let csvContent = 'data:text/csv;charset=utf-8,Date,Clock In,Clock Out,Work Hours,Break Hours,Lunch Hours,Status\n';
    logs.forEach(s => {
      const inTime = new Date(s.start_time).toISOString();
      const outTime = s.end_time ? new Date(s.end_time).toISOString() : '';
      const workH = (s.workMs / (1000 * 60 * 60)).toFixed(2);
      const breakH = (s.breakMs / (1000 * 60 * 60)).toFixed(2);
      const lunchH = (s.lunchMs / (1000 * 60 * 60)).toFixed(2);
      csvContent += `${s.date},${inTime},${outTime},${workH},${breakH},${lunchH},${s.status}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `time_tracker_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (err) {
    showToast('Error', 'Failed to export CSV', 'danger');
  }
}

// Continuous Audio Alarm loop & Banner Controller
let alarmAudioInterval = null;
let isAlarmActive = false;

function startContinuousAudioAlarm(title, message) {
  isAlarmActive = true;
  const banner = document.getElementById('alarm-banner');
  if (banner) {
    document.getElementById('alarm-banner-title').textContent = title || '⏰ ALARM: Time Limit Reached!';
    document.getElementById('alarm-banner-msg').textContent = message || 'Please clock back in or resume work.';
    banner.style.display = 'flex';
  }

  playNotificationAudio();
  if (alarmAudioInterval) clearInterval(alarmAudioInterval);
  alarmAudioInterval = setInterval(() => {
    if (isAlarmActive) {
      playNotificationAudio();
    } else {
      clearInterval(alarmAudioInterval);
    }
  }, 1200);
}

function stopContinuousAudioAlarm() {
  isAlarmActive = false;
  if (alarmAudioInterval) {
    clearInterval(alarmAudioInterval);
    alarmAudioInterval = null;
  }
  const banner = document.getElementById('alarm-banner');
  if (banner) {
    banner.style.display = 'none';
  }
}

// SSE Connection for live alerts
function setupSse() {
  const evtSource = new EventSource('/api/events');
  evtSource.addEventListener('notification', (e) => {
    const data = JSON.parse(e.data);
    showToast(data.title, data.message, 'warning');
    // Trigger continuous audio alarm & visual banner!
    startContinuousAudioAlarm(data.title, data.message);
  });
}

// Global AudioContext for browser autoplay compatibility
let globalAudioCtx = null;

function getGlobalAudioContext() {
  if (!globalAudioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      globalAudioCtx = new AudioContextClass();
    }
  }
  if (globalAudioCtx && globalAudioCtx.state === 'suspended') {
    globalAudioCtx.resume();
  }
  return globalAudioCtx;
}

// Auto-unlock audio context on any user click or touch
['click', 'touchstart', 'keydown'].forEach(evt => {
  document.addEventListener(evt, () => {
    getGlobalAudioContext();
  }, { once: false });
});

// Play loud alarm audio chime
function playNotificationAudio() {
  try {
    const ctx = getGlobalAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(587.33, ctx.currentTime + 0.2);
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.4);

    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.7);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.7);
  } catch (e) {
    console.error('Audio alert playback error:', e);
  }
}

// Web Push Registration
async function initServiceWorker() {
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.error('Service worker registration failed:', err);
    }
  }
}

async function enableWebPush() {
  if (!('Notification' in window)) {
    alert('Browser does not support desktop notifications');
    return;
  }

  const permission = await Notification.requestPermission();
  updatePushStatusText();

  if (permission === 'granted') {
    try {
      const registration = await navigator.serviceWorker.ready;
      const res = await fetch('/api/vapid-public-key');
      const { publicKey } = await res.json();

      if (!publicKey) return;

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });

      showToast('Enabled', 'Web Push notifications subscribed!', 'success');
    } catch (err) {
      console.error('Failed to subscribe to Web Push:', err);
      showToast('Push Error', err.message, 'danger');
    }
  }
}

function updatePushStatusText() {
  const el = document.getElementById('push-status-text');
  if (!el) return;
  if (!('Notification' in window)) {
    el.textContent = 'Notifications unsupported on this device';
  } else if (Notification.permission === 'granted') {
    el.textContent = '✅ Web Push notifications are enabled on this browser.';
  } else if (Notification.permission === 'denied') {
    el.textContent = '❌ Push notifications blocked by browser settings.';
  } else {
    el.textContent = 'Click "Enable Web Push" to grant permission for warning alerts.';
  }
}

async function sendTestNotification() {
  try {
    const res = await fetch('/api/push/test', { method: 'POST' });
    const data = await res.json();
    showToast('Test Sent', data.message, 'success');
  } catch (err) {
    showToast('Error', err.message, 'danger');
  }
}

// Helpers
function formatMsToHMS(ms) {
  const totalSecs = Math.floor(ms / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatMsToHM(ms) {
  const totalMins = Math.floor(ms / (1000 * 60));
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return `${hrs}h ${mins}m`;
}

function showToast(title, message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div>
      <div class="toast-title">${title}</div>
      <div class="toast-body">${message}</div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 6000);
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Tab switcher between Weekly Timesheet View and Shift History
function switchMainTab(tab) {
  const weeklyContainer = document.getElementById('view-weekly-container');
  const historyContainer = document.getElementById('view-history-container');
  const btnWeekly = document.getElementById('tab-btn-weekly');
  const btnHistory = document.getElementById('tab-btn-history');
  const btnBoth = document.getElementById('tab-btn-both');

  btnWeekly.classList.remove('active');
  btnHistory.classList.remove('active');
  btnBoth.classList.remove('active');

  if (tab === 'weekly') {
    btnWeekly.classList.add('active');
    weeklyContainer.style.display = 'block';
    historyContainer.style.display = 'none';
  } else if (tab === 'history') {
    btnHistory.classList.add('active');
    weeklyContainer.style.display = 'none';
    historyContainer.style.display = 'block';
  } else if (tab === 'both') {
    btnBoth.classList.add('active');
    weeklyContainer.style.display = 'block';
    historyContainer.style.display = 'block';
  }
}
