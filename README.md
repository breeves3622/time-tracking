# ⏱️ Self-Hosted Time Tracker with Ntfy for Portainer

A lightweight, self-hosted web application designed specifically for tracking work hours, breaks, and lunches with automated notification warnings delivered to your self-hosted **Ntfy** push notification server.

## ✨ Features

- ⏱️ **Clocking & Timer Controls**: One-click status actions (**Clock In**, **Take Break**, **Take Lunch**, **Clock Out**).
- 🚨 **Persistent Audio Siren & Visual Banner**: Loud repeating alarm loop and flashing banner when break/lunch limits expire.
- 📱 **Multi-Channel Alerts**:
  - **Self-Hosted Ntfy**: Self-hosted Ntfy server for Android / iOS push notifications (`https://ntfy.clanhanoi.net` or `http://your-server-ip:8095`).
  - **Web Push API**: Native browser push notifications with pinned screen banners.
- 📊 **Weekly Timesheet View (Agile1 / PPM)**: Decimal hours (`#.##`) format with 1-click clipboard summary export and explicit **Lunch Out** and **Lunch In** punch timestamps.
- ✏️ **Retroactive Punch Editing**: Edit Clock In, Lunch Out, Lunch In, Clock Out, and Date for any shift.
- 🐳 **1-Click Portainer Deployment**: Bundles **Time Tracker** and **Ntfy** in a single Docker Compose stack!

---

## 🚀 Portainer Stack Deployment (Time Tracker + Ntfy)

1. Open your **Portainer** dashboard $\rightarrow$ **Stacks** $\rightarrow$ **Add Stack**.
2. Name the stack `time-tracker`.
3. Paste the contents of `docker-compose.yml`:

```yaml
version: '3.8'

services:
  time-tracker:
    build: .
    container_name: time-tracker
    restart: unless-stopped
    ports:
      - "8880:8080"
    environment:
      - PORT=8080
      - DATA_DIR=/app/data
      - NODE_ENV=production
      - TZ=America/New_York # Set your timezone
    volumes:
      - time_tracker_data:/app/data
    depends_on:
      - ntfy

  ntfy:
    image: binwiederhier/ntfy:latest
    container_name: ntfy
    command:
      - serve
    restart: unless-stopped
    ports:
      - "8095:80"
    environment:
      - NTFY_BASE_URL=${NTFY_BASE_URL:-https://ntfy.clanhanoi.net}
      - NTFY_CACHE_FILE=/var/cache/ntfy/cache.db
      - NTFY_AUTH_FILE=/var/lib/ntfy/user.db
      - NTFY_AUTH_DEFAULT_ACCESS=read-write
      - TZ=America/New_York
    volumes:
      - ntfy_cache:/var/cache/ntfy
      - ntfy_lib:/var/lib/ntfy

volumes:
  time_tracker_data:
    driver: local
  ntfy_cache:
    driver: local
  ntfy_lib:
    driver: local
```

4. Click **Deploy the stack**.

---

## ⚙️ Ntfy Push Notification Setup

1. Access your self-hosted **Ntfy** web UI at `https://ntfy.clanhanoi.net` or `http://your-server-ip:8095`.
2. Subscribe to your topic (e.g. `time-tracker-alerts`) in the Ntfy web app or Ntfy mobile app (Android / iOS).
3. In **Time Tracker** $\rightarrow$ **⚙️ Settings**, enter the Push Notification Endpoint:
   - Cloudflare Tunnel URL: `https://ntfy.clanhanoi.net/time-tracker-alerts`
   - Internal Docker URL: `http://ntfy/time-tracker-alerts`
4. Click **🔔 Send Test Push**!
