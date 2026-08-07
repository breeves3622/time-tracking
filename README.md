# ⏱️ Self-Hosted Time Tracker with Gotify & Ntfy for Portainer

A lightweight, self-hosted web application designed specifically for tracking work hours, breaks, and lunches with automated notification warnings delivered to your self-hosted **Gotify** or **Ntfy** push notification servers.

## ✨ Features

- ⏱️ **Clocking & Timer Controls**: One-click status actions (**Clock In**, **Take Break**, **Take Lunch**, **Clock Out**).
- 🚨 **Persistent Audio Siren & Visual Banner**: Loud repeating alarm loop and flashing banner when break/lunch limits expire.
- 📱 **Multi-Channel Alerts**:
  - **Self-Hosted Gotify**: Direct push notifications to Gotify Android / Web apps (`http://your-server-ip:8090`).
  - **Self-Hosted Ntfy**: Self-hosted Ntfy server for Android / iOS push notifications (`http://your-server-ip:8095`).
  - **Web Push API**: Native browser push notifications with pinned screen banners.
- 📊 **Weekly Timesheet View (Agile1 / PPM)**: Decimal hours (`#.##`) format with 1-click clipboard summary export and explicit **Lunch Out** and **Lunch In** punch timestamps.
- ✏️ **Retroactive Punch Editing**: Edit Clock In, Lunch Out, Lunch In, Clock Out, and Date for any shift.
- 🐳 **1-Click Portainer Deployment**: Bundles **Time Tracker**, **Gotify**, and **Ntfy** in a single Docker Compose stack!

---

## 🚀 Portainer Stack Deployment (Time Tracker + Gotify + Ntfy)

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
      - gotify
      - ntfy

  gotify:
    image: gotify/server:latest
    container_name: gotify
    restart: unless-stopped
    ports:
      - "8090:80"
    environment:
      - GOTIFY_SERVER_PORT=80
      - TZ=America/New_York
    volumes:
      - gotify_data:/app/data

  ntfy:
    image: heckel/ntfy:latest
    container_name: ntfy
    command:
      - serve
    restart: unless-stopped
    ports:
      - "8095:80"
    environment:
      - NTFY_BASE_URL=http://localhost:8095
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
  gotify_data:
    driver: local
  ntfy_cache:
    driver: local
  ntfy_lib:
    driver: local
```

4. Click **Deploy the stack**.

---

## ⚙️ Push Notification Setup (Gotify & Ntfy)

### Option A: Self-Hosted Ntfy Setup
1. Access your self-hosted **Ntfy** web UI at `http://your-server-ip:8095`.
2. Subscribe to your topic (e.g. `time-tracker-alerts`) in the Ntfy web app or Ntfy mobile app (Android / iOS).
3. In **Time Tracker** $\rightarrow$ **⚙️ Settings**, enter the Push Notification Endpoint:
   - Internal Docker URL: `http://ntfy/time-tracker-alerts`
   - External URL: `http://your-server-ip:8095/time-tracker-alerts`
4. Click **🔔 Send Test Push**!

### Option B: Self-Hosted Gotify Setup
1. Access **Gotify** at `http://your-server-ip:8090` (default login: `admin` / `admin`).
2. Click **Apps** $\rightarrow$ **Create Application**, name it `Time Tracker`, and copy the App Token.
3. In **Time Tracker** $\rightarrow$ **⚙️ Settings**, enter:
   - Internal Docker URL: `http://gotify/message?token=YOUR_APP_TOKEN`
   - External URL: `http://your-server-ip:8090/message?token=YOUR_APP_TOKEN`
4. Click **🔔 Send Test Push**!
