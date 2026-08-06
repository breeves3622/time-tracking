const db = require('./db');
const { sendPushNotification } = require('./notifications');

let intervalId = null;

function checkShiftAlerts() {
  try {
    const activeShift = db.getActiveShift();
    if (!activeShift) return;

    const settings = db.getSettings();

    const breakMins = parseFloat(settings.break_mins || '15');
    const lunchMins = parseFloat(settings.lunch_mins || '30');
    const lunchAfterHours = parseFloat(settings.lunch_after_hours || '4');
    const warningLeadMins = parseFloat(settings.warning_lead_mins || '3');

    const now = new Date();
    const currentEventStart = new Date(activeShift.current_event_start);
    const elapsedMs = now.getTime() - currentEventStart.getTime();
    const elapsedMins = elapsedMs / (1000 * 60);

    // Case 1: Currently ON BREAK
    if (activeShift.status === 'break') {
      const remainingMins = breakMins - elapsedMins;

      // Break ending warning
      if (remainingMins <= warningLeadMins && remainingMins > 0) {
        if (!db.checkNotificationSent(activeShift.id, 'break_warning')) {
          db.markNotificationSent(activeShift.id, 'break_warning');
          const minsText = Math.ceil(remainingMins);
          sendPushNotification(
            '☕ Break Ending Soon!',
            `Your ${breakMins}-minute break will end in ${minsText} minute${minsText === 1 ? '' : 's'}. Get ready to clock back in!`,
            { tag: 'break-warning', priority: 'high' }
          );
        }
      }

      // Break time is up
      if (elapsedMins >= breakMins) {
        if (!db.checkNotificationSent(activeShift.id, 'break_over')) {
          db.markNotificationSent(activeShift.id, 'break_over');
          sendPushNotification(
            '⏰ Break Over!',
            `Your ${breakMins}-minute break has ended. Please clock back in to work.`,
            { tag: 'break-over', priority: 'max' }
          );
        }
      }
    }

    // Case 2: Currently ON LUNCH
    else if (activeShift.status === 'lunch') {
      const remainingMins = lunchMins - elapsedMins;

      // Lunch ending warning
      if (remainingMins <= warningLeadMins && remainingMins > 0) {
        if (!db.checkNotificationSent(activeShift.id, 'lunch_warning')) {
          db.markNotificationSent(activeShift.id, 'lunch_warning');
          const minsText = Math.ceil(remainingMins);
          sendPushNotification(
            '🥪 Lunch Period Ending Soon!',
            `Your ${lunchMins}-minute lunch break ends in ${minsText} minute${minsText === 1 ? '' : 's'}.`,
            { tag: 'lunch-warning', priority: 'high' }
          );
        }
      }

      // Lunch time is up
      if (elapsedMins >= lunchMins) {
        if (!db.checkNotificationSent(activeShift.id, 'lunch_over')) {
          db.markNotificationSent(activeShift.id, 'lunch_over');
          sendPushNotification(
            '⏰ Lunch Time Over!',
            `Your ${lunchMins}-minute lunch break is over. Please clock back in to work.`,
            { tag: 'lunch-over', priority: 'max' }
          );
        }
      }
    }

    // Case 3: Currently WORKING
    else if (activeShift.status === 'working') {
      const events = db.getEvents(activeShift.id);
      const completedWorkEvents = events.filter(e => e.type === 'work' && e.end_time);

      let totalWorkMs = completedWorkEvents.reduce((sum, e) => sum + (e.duration_ms || 0), 0);
      totalWorkMs += elapsedMs; // add current work segment

      const breakAfterHours = parseFloat(settings.break_after_hours || '2');

      // 3A. Upcoming Break Alert (for current continuous work stretch)
      const currentSegmentHours = elapsedMs / (1000 * 60 * 60);
      const breakMinsRemaining = (breakAfterHours - currentSegmentHours) * 60;

      if (breakMinsRemaining <= warningLeadMins && breakMinsRemaining > 0) {
        const eventKey = `upcoming_break_${activeShift.id}_${Math.floor(elapsedMins)}`;
        if (!db.checkNotificationSent(activeShift.id, 'upcoming_break')) {
          db.markNotificationSent(activeShift.id, 'upcoming_break');
          const minsText = Math.ceil(breakMinsRemaining);
          sendPushNotification(
            '☕ Break Recommended Soon',
            `You have been working continuously for nearly ${breakAfterHours} hours. Recommended break in ${minsText} minute${minsText === 1 ? '' : 's'}!`,
            { tag: 'upcoming-break', priority: 'default' }
          );
        }
      }

      // 3B. Upcoming Lunch Alert (total work time today)
      const totalWorkHours = totalWorkMs / (1000 * 60 * 60);
      const hasTakenLunch = events.some(e => e.type === 'lunch');
      const targetLunchHours = lunchAfterHours;
      const hoursRemaining = targetLunchHours - totalWorkHours;
      const minsRemaining = hoursRemaining * 60;

      if (!hasTakenLunch && minsRemaining <= warningLeadMins && minsRemaining > 0) {
        if (!db.checkNotificationSent(activeShift.id, 'upcoming_lunch')) {
          db.markNotificationSent(activeShift.id, 'upcoming_lunch');
          const minsText = Math.ceil(minsRemaining);
          sendPushNotification(
            '🥪 Lunch Time Approaching',
            `You have been working for nearly ${targetLunchHours} hours today. Recommended lunch break in ${minsText} minute${minsText === 1 ? '' : 's'}!`,
            { tag: 'upcoming-lunch', priority: 'default' }
          );
        }
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error checking shift alerts:', err);
  }
}

function startScheduler() {
  if (intervalId) clearInterval(intervalId);
  // Check every 10 seconds
  intervalId = setInterval(checkShiftAlerts, 10000);
  console.log('[Scheduler] Background notification warning engine started (10s interval)');
}

module.exports = { startScheduler };
