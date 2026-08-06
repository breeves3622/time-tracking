const webPush = require('web-push');
const db = require('./db');

let vapidKeysInitialized = false;

function initVapidKeys() {
  let pubKey = db.getSetting('vapid_public_key');
  let privKey = db.getSetting('vapid_private_key');
  let email = db.getSetting('vapid_email') || 'mailto:admin@example.com';

  if (!pubKey || !privKey) {
    const keys = webPush.generateVAPIDKeys();
    pubKey = keys.publicKey;
    privKey = keys.privateKey;
    db.setSetting('vapid_public_key', pubKey);
    db.setSetting('vapid_private_key', privKey);
  }

  webPush.setVapidDetails(email, pubKey, privKey);
  vapidKeysInitialized = true;
  return pubKey;
}

function getVapidPublicKey() {
  if (!vapidKeysInitialized) {
    return initVapidKeys();
  }
  return db.getSetting('vapid_public_key');
}

// Global SSE clients list for real-time frontend updates
const sseClients = new Set();

function addSseClient(res) {
  sseClients.add(res);
}

function removeSseClient(res) {
  sseClients.delete(res);
}

function broadcastSse(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

async function sendPushNotification(title, message, options = {}) {
  const settings = db.getSettings();

  // 1. Broadcast to SSE active tabs
  broadcastSse('notification', { title, message, ...options });

  // 2. Dispatch Ntfy / Gotify if target is set
  if (settings.ntfy_target && settings.ntfy_target.trim()) {
    let targetUrl = settings.ntfy_target.trim();

    // Check if Gotify URL format (contains /message or token=)
    const isGotify = targetUrl.includes('/message') || targetUrl.includes('token=');

    try {
      if (isGotify) {
        // Gotify JSON payload format
        const priorityNum = options.priority === 'max' ? 10 : (options.priority === 'high' ? 8 : 5);
        await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            title: title,
            message: message,
            priority: priorityNum
          })
        });
        console.log(`[Notification] Gotify alert dispatched to ${targetUrl}`);
      } else {
        // Ntfy plain text format
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
          targetUrl = `https://ntfy.sh/${targetUrl}`;
        }
        await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Title': title,
            'Priority': options.priority || 'high',
            'Tags': options.tags || 'alarm_clock,warning',
          },
          body: message
        });
        console.log(`[Notification] Ntfy alert dispatched to ${targetUrl}`);
      }
    } catch (err) {
      console.error('[Notification] Error sending push alert:', err.message);
    }
  }

  // 3. Dispatch Web Push to subscribed browser endpoints
  if (!vapidKeysInitialized) {
    initVapidKeys();
  }

  const subscriptions = db.getPushSubscriptions();
  const pushPayload = JSON.stringify({
    title,
    body: message,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: options.tag || 'time-tracker-alert',
    data: options.data || {}
  });

  for (const subRow of subscriptions) {
    try {
      const subObj = JSON.parse(subRow.subscription_json);
      await webPush.sendNotification(subObj, pushPayload);
      console.log(`[Notification] Web push sent to subscription #${subRow.id}`);
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        // Expired subscription, remove from DB
        db.deletePushSubscription(subRow.id);
        console.log(`[Notification] Removed expired push subscription #${subRow.id}`);
      } else {
        console.error(`[Notification] Error sending web push to #${subRow.id}:`, err.message);
      }
    }
  }
}

module.exports = {
  initVapidKeys,
  getVapidPublicKey,
  sendPushNotification,
  addSseClient,
  removeSseClient,
  broadcastSse
};
