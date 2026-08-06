# ⏱️ Self-Hosted Time Tracker with Gotify for Portainer

A lightweight, self-hosted web application designed specifically for tracking work hours, breaks, and lunches with automated notification warnings delivered to your self-hosted **Gotify** push notification server.

## ✨ Features

- ⏱️ **Clocking & Timer Controls**: One-click status actions (**Clock In**, **Take Break**, **Take Lunch**, **Clock Out**).
- 🔔 **Automated Warning Push Notifications**:
  - **Break/Lunch Ending Warning**: Alerts you X minutes before your break or lunch period ends.
  - **Break/Lunch Expired Alert**: Alerts you when your break/lunch duration is completed.
  - **Upcoming Lunch Warning**: Reminds you when you've been working for nearly 4 hours.
- 📱 **Multi-Channel Alerts**:
  - **Self-Hosted Gotify**: Direct push notifications to Gotify Android / Web apps.
  - **Ntfy Integration**: Free push notifications via [ntfy.sh](https://ntfy.sh).
  - **Web Push API**: Native browser push notifications.
- 📊 **Shift Logs & CSV Export**: Daily breakdown of total work, break, and lunch hours with CSV export and manual log adjustments.
- 🐳 **1-Click Portainer Deployment**: Bundles both **Time Tracker** and **Gotify** in a single Docker Compose stack!

---

## 🚀 Portainer Stack Deployment (Time Tracker + Gotify)

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

  gotify:
    image: gotify/server:latest
    container_name: gotify
    restart: unless-stopped
    ports:
      - "8088:80"
    environment:
      - GOTIFY_SERVER_PORT=80
      - TZ=America/New_York
    volumes:
      - gotify_data:/app/data

volumes:
  time_tracker_data:
    driver: local
  gotify_data:
    driver: local
```

4. Click **Deploy the stack**.

---

## ⚙️ Initial Gotify & Time Tracker Configuration

### 1. Set Up Gotify
1. Open Gotify in your browser at `http://your-server-ip:8088`.
2. Log in with default credentials:
   - **Username**: `admin`
   - **Password**: `admin` *(Change this immediately under User settings!)*
3. Click **Apps** $\rightarrow$ **Create Application**.
4. Name it `Time Tracker` and click **CREATE**.
5. Copy the generated **App Token** (e.g., `A1b2C3d4E5f6`).

### 2. Connect Time Tracker to Gotify
1. Open Time Tracker in your browser at `http://your-server-ip:8880`.
2. Click **⚙️ Settings** in the top right.
3. In **Push Notification Endpoint**, enter the internal or external Gotify URL:
   - Internal Docker URL: `http://gotify/message?token=YOUR_APP_TOKEN`
   - External URL: `http://your-server-ip:8088/message?token=YOUR_APP_TOKEN`
4. Click **🔔 Send Test Push** to test push notification delivery to Gotify!
