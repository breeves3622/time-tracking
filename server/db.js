const fs = require('fs');
const path = require('path');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbFilePath = path.join(dataDir, 'timetracker.json');

const defaultData = {
  shifts: [],
  events: [],
  settings: {
    shift_hours: '8',
    break_mins: '15',
    lunch_mins: '30',
    break_after_hours: '2',
    lunch_after_hours: '4',
    warning_lead_mins: '3',
    ntfy_target: '',
    vapid_public_key: '',
    vapid_private_key: '',
    vapid_email: 'mailto:admin@example.com'
  },
  push_subscriptions: [],
  sent_notifications: [],
  auto_inc: {
    shifts: 1,
    events: 1,
    push_subscriptions: 1,
    sent_notifications: 1
  }
};

let data = { ...defaultData };

function loadData() {
  if (fs.existsSync(dbFilePath)) {
    try {
      const content = fs.readFileSync(dbFilePath, 'utf8');
      const parsed = JSON.parse(content);
      data = {
        shifts: parsed.shifts || [],
        events: parsed.events || [],
        settings: { ...defaultData.settings, ...(parsed.settings || {}) },
        push_subscriptions: parsed.push_subscriptions || [],
        sent_notifications: parsed.sent_notifications || [],
        auto_inc: parsed.auto_inc || { shifts: 1, events: 1, push_subscriptions: 1, sent_notifications: 1 }
      };
    } catch (e) {
      console.error('[DB] Error reading JSON DB, initializing fresh store:', e.message);
      saveData();
    }
  } else {
    saveData();
  }
}

function saveData() {
  try {
    const tmpPath = `${dbFilePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmpPath, dbFilePath);
  } catch (e) {
    fs.writeFileSync(dbFilePath, JSON.stringify(data, null, 2), 'utf8');
  }
}

loadData();

const db = {
  getSettings() {
    return { ...data.settings };
  },

  getSetting(key) {
    return data.settings[key];
  },

  setSetting(key, value) {
    data.settings[key] = String(value);
    saveData();
  },

  getActiveShift() {
    const active = data.shifts.filter(s => s.status !== 'clocked_out');
    if (active.length === 0) return null;
    return active[active.length - 1];
  },

  getShift(id) {
    return data.shifts.find(s => s.id === Number(id)) || null;
  },

  getShifts(limit = 30) {
    const sorted = [...data.shifts].sort((a, b) => b.id - a.id);
    return sorted.slice(0, limit);
  },

  getShiftsByDate(dateStr) {
    return data.shifts.filter(s => s.date === dateStr);
  },

  createShift({ date, start_time, status, current_event_type, current_event_start }) {
    const newShift = {
      id: data.auto_inc.shifts++,
      date,
      start_time,
      end_time: null,
      status: status || 'working',
      current_event_type: current_event_type || 'work',
      current_event_start,
      created_at: new Date().toISOString()
    };
    data.shifts.push(newShift);
    saveData();
    return newShift;
  },

  updateShift(id, updates) {
    const shift = data.shifts.find(s => s.id === Number(id));
    if (shift) {
      Object.assign(shift, updates);
      saveData();
    }
    return shift;
  },

  deleteShift(id) {
    const numId = Number(id);
    data.shifts = data.shifts.filter(s => s.id !== numId);
    data.events = data.events.filter(e => e.shift_id !== numId);
    data.sent_notifications = data.sent_notifications.filter(n => n.shift_id !== numId);
    saveData();
  },

  getEvents(shift_id) {
    return data.events.filter(e => e.shift_id === Number(shift_id));
  },

  getCurrentEvent(shift_id) {
    const openEvents = data.events.filter(e => e.shift_id === Number(shift_id) && !e.end_time);
    return openEvents.length ? openEvents[openEvents.length - 1] : null;
  },

  createEvent({ shift_id, type, start_time, end_time = null, duration_ms = 0 }) {
    const newEvent = {
      id: data.auto_inc.events++,
      shift_id: Number(shift_id),
      type,
      start_time,
      end_time,
      duration_ms
    };
    data.events.push(newEvent);
    saveData();
    return newEvent;
  },

  updateEvent(id, updates) {
    const ev = data.events.find(e => e.id === Number(id));
    if (ev) {
      Object.assign(ev, updates);
      saveData();
    }
    return ev;
  },

  getPushSubscriptions() {
    return [...data.push_subscriptions];
  },

  savePushSubscription(endpoint, subscription_json) {
    const existing = data.push_subscriptions.find(s => s.endpoint === endpoint);
    if (existing) {
      existing.subscription_json = subscription_json;
    } else {
      data.push_subscriptions.push({
        id: data.auto_inc.push_subscriptions++,
        endpoint,
        subscription_json,
        created_at: new Date().toISOString()
      });
    }
    saveData();
  },

  deletePushSubscription(id) {
    data.push_subscriptions = data.push_subscriptions.filter(s => s.id !== Number(id));
    saveData();
  },

  checkNotificationSent(shift_id, notification_key) {
    return data.sent_notifications.some(n => n.shift_id === Number(shift_id) && n.notification_key === notification_key);
  },

  markNotificationSent(shift_id, notification_key) {
    if (!this.checkNotificationSent(shift_id, notification_key)) {
      data.sent_notifications.push({
        id: data.auto_inc.sent_notifications++,
        shift_id: Number(shift_id),
        notification_key,
        sent_at: new Date().toISOString()
      });
      saveData();
    }
  }
};

module.exports = db;
