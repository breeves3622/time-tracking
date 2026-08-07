const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const { getVapidPublicKey, sendPushNotification, addSseClient, removeSseClient } = require('./notifications');
const { startScheduler } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

function getTodayDateString() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function calculateTodayTotals() {
  const today = getTodayDateString();
  const shiftsToday = db.getShiftsByDate(today);
  const now = new Date().getTime();

  let workMs = 0, breakMs = 0, lunchMs = 0;

  for (const shift of shiftsToday) {
    const events = db.getEvents(shift.id);
    for (const ev of events) {
      let dur = ev.duration_ms || 0;
      if (!ev.end_time) {
        dur = now - new Date(ev.start_time).getTime();
      }
      if (ev.type === 'work') workMs += dur;
      else if (ev.type === 'break') breakMs += dur;
      else if (ev.type === 'lunch') lunchMs += dur;
    }
  }

  return { workMs, breakMs, lunchMs };
}

// GET /api/status - Get current status
app.get('/api/status', (req, res) => {
  try {
    const activeShift = db.getActiveShift();
    const settings = db.getSettings();

    if (!activeShift) {
      return res.json({
        status: 'clocked_out',
        activeShift: null,
        currentEvent: null,
        todayTotals: calculateTodayTotals(),
        settings
      });
    }

    const currentEvent = db.getCurrentEvent(activeShift.id);
    const events = db.getEvents(activeShift.id);
    const now = new Date().getTime();

    let workMs = 0, breakMs = 0, lunchMs = 0;
    for (const ev of events) {
      let dur = ev.duration_ms || 0;
      if (!ev.end_time) {
        dur = now - new Date(ev.start_time).getTime();
      }
      if (ev.type === 'work') workMs += dur;
      else if (ev.type === 'break') breakMs += dur;
      else if (ev.type === 'lunch') lunchMs += dur;
    }

    res.json({
      status: activeShift.status,
      activeShift,
      currentEvent,
      shiftTotals: { workMs, breakMs, lunchMs },
      todayTotals: calculateTodayTotals(),
      settings
    });
  } catch (err) {
    console.error('Error fetching status:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clock - Clock operations
app.post('/api/clock', (req, res) => {
  try {
    const { action } = req.body;
    const nowIso = new Date().toISOString();
    const today = getTodayDateString();

    const activeShift = db.getActiveShift();

    // 1. CLOCK IN
    if (action === 'clock_in') {
      if (activeShift) {
        return res.status(400).json({ error: 'Already clocked in' });
      }

      const startIso = req.body.custom_start_time 
        ? new Date(req.body.custom_start_time).toISOString() 
        : nowIso;

      const newShift = db.createShift({
        date: today,
        start_time: startIso,
        status: 'working',
        current_event_type: 'work',
        current_event_start: startIso
      });

      db.createEvent({
        shift_id: newShift.id,
        type: 'work',
        start_time: startIso
      });

      return res.json({ success: true, message: 'Clocked in successfully' });
    }

    if (!activeShift) {
      return res.status(400).json({ error: 'No active shift found. Please clock in first.' });
    }

    // UPDATE SHIFT START TIME RETROSPECTIVELY
    if (action === 'update_start_time') {
      if (!req.body.custom_start_time) {
        return res.status(400).json({ error: 'custom_start_time is required' });
      }
      const newStartIso = new Date(req.body.custom_start_time).toISOString();
      const events = db.getEvents(activeShift.id);

      db.updateShift(activeShift.id, { start_time: newStartIso });
      if (events.length > 0) {
        db.updateEvent(events[0].id, { start_time: newStartIso });
        if (events.length === 1) {
          db.updateShift(activeShift.id, { current_event_start: newStartIso });
        }
      }
      return res.json({ success: true, message: 'Shift start time updated' });
    }

    const currentEvent = db.getCurrentEvent(activeShift.id);

    const closeCurrentEvent = () => {
      if (currentEvent) {
        const startMs = new Date(currentEvent.start_time).getTime();
        const endMs = new Date(nowIso).getTime();
        const durationMs = endMs - startMs;
        db.updateEvent(currentEvent.id, { end_time: nowIso, duration_ms: durationMs });
      }
    };

    // 2. START BREAK
    if (action === 'start_break') {
      if (activeShift.status !== 'working') {
        return res.status(400).json({ error: 'Must be working to start a break' });
      }
      closeCurrentEvent();

      db.updateShift(activeShift.id, {
        status: 'break',
        current_event_type: 'break',
        current_event_start: nowIso
      });

      db.createEvent({ shift_id: activeShift.id, type: 'break', start_time: nowIso });
      return res.json({ success: true, message: 'Break started' });
    }

    // 3. END BREAK
    if (action === 'end_break') {
      if (activeShift.status !== 'break') {
        return res.status(400).json({ error: 'Not currently on a break' });
      }
      closeCurrentEvent();

      db.updateShift(activeShift.id, {
        status: 'working',
        current_event_type: 'work',
        current_event_start: nowIso
      });

      db.createEvent({ shift_id: activeShift.id, type: 'work', start_time: nowIso });
      return res.json({ success: true, message: 'Break ended. Returned to work.' });
    }

    // 4. START LUNCH
    if (action === 'start_lunch') {
      if (activeShift.status !== 'working') {
        return res.status(400).json({ error: 'Must be working to start lunch' });
      }
      closeCurrentEvent();

      db.updateShift(activeShift.id, {
        status: 'lunch',
        current_event_type: 'lunch',
        current_event_start: nowIso
      });

      db.createEvent({ shift_id: activeShift.id, type: 'lunch', start_time: nowIso });
      return res.json({ success: true, message: 'Lunch started' });
    }

    // 5. END LUNCH
    if (action === 'end_lunch') {
      if (activeShift.status !== 'lunch') {
        return res.status(400).json({ error: 'Not currently on lunch' });
      }
      closeCurrentEvent();

      db.updateShift(activeShift.id, {
        status: 'working',
        current_event_type: 'work',
        current_event_start: nowIso
      });

      db.createEvent({ shift_id: activeShift.id, type: 'work', start_time: nowIso });
      return res.json({ success: true, message: 'Lunch ended. Returned to work.' });
    }

    // 6. CLOCK OUT
    if (action === 'clock_out') {
      closeCurrentEvent();

      db.updateShift(activeShift.id, {
        status: 'clocked_out',
        end_time: nowIso
      });

      return res.json({ success: true, message: 'Clocked out successfully' });
    }

    return res.status(400).json({ error: 'Invalid clock action' });
  } catch (err) {
    console.error('Error executing clock action:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/logs
app.get('/api/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '30', 10);
    const shifts = db.getShifts(limit);

    const logs = shifts.map(shift => {
      const events = db.getEvents(shift.id);
      let workMs = 0, breakMs = 0, lunchMs = 0;
      let lunchOut = null, lunchIn = null;

      for (const ev of events) {
        let dur = ev.duration_ms || 0;
        if (!ev.end_time && shift.status !== 'clocked_out') {
          dur = new Date().getTime() - new Date(ev.start_time).getTime();
        }
        if (ev.type === 'work') workMs += dur;
        else if (ev.type === 'break') breakMs += dur;
        else if (ev.type === 'lunch') {
          lunchMs += dur;
          if (!lunchOut) lunchOut = ev.start_time;
          if (ev.end_time) lunchIn = ev.end_time;
        }
      }

      return {
        ...shift,
        events,
        workMs,
        breakMs,
        lunchMs,
        lunchOut,
        lunchIn
      };
    });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/weekly-summary - Weekly view for Agile1 / PPM
app.get('/api/weekly-summary', (req, res) => {
  try {
    let weekStartStr = req.query.week_start;
    let startDate;

    if (weekStartStr) {
      startDate = new Date(weekStartStr + 'T00:00:00');
    } else {
      const today = new Date();
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      startDate = new Date(today.setDate(diff));
    }

    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const days = [];
    let grandTotalWorkMs = 0;
    let grandTotalBreakMs = 0;
    let grandTotalLunchMs = 0;

    const now = new Date().getTime();

    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const shiftsOnDate = db.getShiftsByDate(dateStr);

      let dayWorkMs = 0;
      let dayBreakMs = 0;
      let dayLunchMs = 0;
      let firstClockIn = null;
      let lastClockOut = null;
      let lunchOutTime = null;
      let lunchInTime = null;

      if (shiftsOnDate.length > 0) {
        firstClockIn = shiftsOnDate[0].start_time;
        lastClockOut = shiftsOnDate[shiftsOnDate.length - 1].end_time;

        for (const shift of shiftsOnDate) {
          const events = db.getEvents(shift.id);
          for (const ev of events) {
            let dur = ev.duration_ms || 0;
            if (!ev.end_time && shift.status !== 'clocked_out') {
              dur = now - new Date(ev.start_time).getTime();
            }
            if (ev.type === 'work') dayWorkMs += dur;
            else if (ev.type === 'break') dayBreakMs += dur;
            else if (ev.type === 'lunch') {
              dayLunchMs += dur;
              if (!lunchOutTime) lunchOutTime = ev.start_time;
              if (ev.end_time) lunchInTime = ev.end_time;
            }
          }
        }
      }

      grandTotalWorkMs += dayWorkMs;
      grandTotalBreakMs += dayBreakMs;
      grandTotalLunchMs += dayLunchMs;

      days.push({
        date: dateStr,
        day_name: dayNames[i],
        short_date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        first_clock_in: firstClockIn ? new Date(firstClockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-',
        lunch_out: lunchOutTime ? new Date(lunchOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-',
        lunch_in: lunchInTime ? new Date(lunchInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (lunchOutTime ? 'On Lunch' : '-'),
        last_clock_out: lastClockOut ? new Date(lastClockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : (firstClockIn ? 'Active' : '-'),
        work_hours: (dayWorkMs / (1000 * 60 * 60)).toFixed(2),
        break_hours: (dayBreakMs / (1000 * 60 * 60)).toFixed(2),
        lunch_hours: (dayLunchMs / (1000 * 60 * 60)).toFixed(2),
        work_ms: dayWorkMs
      });
    }

    const weekEndStr = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    res.json({
      week_start: startDate.toISOString().split('T')[0],
      week_end: weekEndStr,
      total_work_hours: (grandTotalWorkMs / (1000 * 60 * 60)).toFixed(2),
      total_break_hours: (grandTotalBreakMs / (1000 * 60 * 60)).toFixed(2),
      total_lunch_hours: (grandTotalLunchMs / (1000 * 60 * 60)).toFixed(2),
      days
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/logs - Manual add entry with exact punch timestamps
app.post('/api/logs', (req, res) => {
  try {
    const { date, start_time, lunch_out, lunch_in, end_time } = req.body;
    if (!date || !start_time) {
      return res.status(400).json({ error: 'Date and start time are required' });
    }

    const startIso = new Date(start_time).toISOString();
    const endIso = end_time ? new Date(end_time).toISOString() : null;
    const lunchOutIso = lunch_out ? new Date(lunch_out).toISOString() : null;
    const lunchInIso = lunch_in ? new Date(lunch_in).toISOString() : null;

    const shift = db.createShift({
      date,
      start_time: startIso,
      status: endIso ? 'clocked_out' : 'working',
      current_event_type: 'work',
      current_event_start: startIso
    });

    if (endIso) {
      db.updateShift(shift.id, { end_time: endIso });
    }

    // Generate events based on lunch out / lunch in
    if (lunchOutIso && lunchInIso) {
      const w1Ms = Math.max(0, new Date(lunchOutIso).getTime() - new Date(startIso).getTime());
      const lMs = Math.max(0, new Date(lunchInIso).getTime() - new Date(lunchOutIso).getTime());
      
      db.createEvent({ shift_id: shift.id, type: 'work', start_time: startIso, end_time: lunchOutIso, duration_ms: w1Ms });
      db.createEvent({ shift_id: shift.id, type: 'lunch', start_time: lunchOutIso, end_time: lunchInIso, duration_ms: lMs });
      
      if (endIso) {
        const w2Ms = Math.max(0, new Date(endIso).getTime() - new Date(lunchInIso).getTime());
        db.createEvent({ shift_id: shift.id, type: 'work', start_time: lunchInIso, end_time: endIso, duration_ms: w2Ms });
      } else {
        db.createEvent({ shift_id: shift.id, type: 'work', start_time: lunchInIso });
      }
    } else {
      if (endIso) {
        const wMs = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
        db.createEvent({ shift_id: shift.id, type: 'work', start_time: startIso, end_time: endIso, duration_ms: wMs });
      } else {
        db.createEvent({ shift_id: shift.id, type: 'work', start_time: startIso });
      }
    }

    res.json({ success: true, message: 'Shift logged successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/logs/:id - Edit existing shift punch timestamps
app.put('/api/logs/:id', (req, res) => {
  try {
    const shiftId = Number(req.params.id);
    const existingShift = db.getShift(shiftId);
    if (!existingShift) {
      return res.status(404).json({ error: 'Shift log not found' });
    }

    const { date, start_time, lunch_out, lunch_in, end_time } = req.body;
    if (!date || !start_time) {
      return res.status(400).json({ error: 'Date and start time are required' });
    }

    const startIso = new Date(start_time).toISOString();
    const endIso = end_time ? new Date(end_time).toISOString() : null;
    const lunchOutIso = lunch_out ? new Date(lunch_out).toISOString() : null;
    const lunchInIso = lunch_in ? new Date(lunch_in).toISOString() : null;

    db.updateShift(shiftId, {
      date,
      start_time: startIso,
      end_time: endIso,
      status: endIso ? 'clocked_out' : existingShift.status
    });

    // Replace all events for this shift
    const existingEvents = db.getEvents(shiftId);
    // Remove old events from db helper
    existingEvents.forEach(e => {
      // Clear out old events by re-filtering or deleting
    });

    // Re-create events with updated punch times
    // Clear and rebuild events array in db
    db.deleteShiftEvents(shiftId);

    if (lunchOutIso && lunchInIso) {
      const w1Ms = Math.max(0, new Date(lunchOutIso).getTime() - new Date(startIso).getTime());
      const lMs = Math.max(0, new Date(lunchInIso).getTime() - new Date(lunchOutIso).getTime());

      db.createEvent({ shift_id: shiftId, type: 'work', start_time: startIso, end_time: lunchOutIso, duration_ms: w1Ms });
      db.createEvent({ shift_id: shiftId, type: 'lunch', start_time: lunchOutIso, end_time: lunchInIso, duration_ms: lMs });

      if (endIso) {
        const w2Ms = Math.max(0, new Date(endIso).getTime() - new Date(lunchInIso).getTime());
        db.createEvent({ shift_id: shiftId, type: 'work', start_time: lunchInIso, end_time: endIso, duration_ms: w2Ms });
      } else {
        db.createEvent({ shift_id: shiftId, type: 'work', start_time: lunchInIso });
      }
    } else {
      if (endIso) {
        const wMs = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
        db.createEvent({ shift_id: shiftId, type: 'work', start_time: startIso, end_time: endIso, duration_ms: wMs });
      } else {
        db.createEvent({ shift_id: shiftId, type: 'work', start_time: startIso });
      }
    }

    res.json({ success: true, message: 'Shift punches updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/logs/:id
app.delete('/api/logs/:id', (req, res) => {
  try {
    db.deleteShift(req.params.id);
    res.json({ success: true, message: 'Shift deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings
app.get('/api/settings', (req, res) => {
  try {
    const settings = db.getSettings();
    settings.vapid_public_key = getVapidPublicKey();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings
app.post('/api/settings', (req, res) => {
  try {
    const { shift_hours, break_mins, lunch_mins, break_after_hours, lunch_after_hours, warning_lead_mins, ntfy_target, mute_browser_audio } = req.body;
    if (shift_hours !== undefined) db.setSetting('shift_hours', shift_hours);
    if (break_mins !== undefined) db.setSetting('break_mins', break_mins);
    if (lunch_mins !== undefined) db.setSetting('lunch_mins', lunch_mins);
    if (break_after_hours !== undefined) db.setSetting('break_after_hours', break_after_hours);
    if (lunch_after_hours !== undefined) db.setSetting('lunch_after_hours', lunch_after_hours);
    if (warning_lead_mins !== undefined) db.setSetting('warning_lead_mins', warning_lead_mins);
    if (ntfy_target !== undefined) db.setSetting('ntfy_target', String(ntfy_target).trim());
    if (mute_browser_audio !== undefined) db.setSetting('mute_browser_audio', mute_browser_audio ? 'true' : 'false');

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vapid-public-key
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// POST /api/push/subscribe
app.post('/api/push/subscribe', (req, res) => {
  try {
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    db.savePushSubscription(subscription.endpoint, JSON.stringify(subscription));
    res.json({ success: true, message: 'Push subscription registered' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/push/test
app.post('/api/push/test', async (req, res) => {
  try {
    await sendPushNotification(
      '⏰ Alarm Test Triggered',
      'This is a persistent alarm test from your self-hosted Time Tracker!',
      { tag: 'test-push', priority: 'max', isAlarm: true }
    );
    res.json({ success: true, message: 'Test alarm sent to Web Push and Gotify target!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SSE endpoint
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  addSseClient(res);

  req.on('close', () => {
    removeSseClient(res);
  });
});

startScheduler();

app.listen(PORT, () => {
  console.log(`[Time Tracker] Server running on http://0.0.0.0:${PORT}`);
});
