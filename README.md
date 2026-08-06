# ⏱️ Self-Hosted Time Tracker for Portainer

A lightweight, self-hosted web application designed specifically for tracking work hours, breaks, and lunches with automated notification warnings when break/lunch periods are approaching or about to end.

![Time Tracker Dashboard](https://raw.githubusercontent.com/placeholder/hero.png)

## ✨ Features

- ⏱️ **Clocking & Timer Controls**: One-click status actions (**Clock In**, **Take Break**, **Take Lunch**, **Clock Out**).
- 🔔 **Automated Warning Push Notifications**:
  - **Break/Lunch Ending Warning**: Alerts you X minutes before your break or lunch period ends.
  - **Break/Lunch Expired Alert**: Alerts you when your break/lunch duration is completed.
  - **Upcoming Lunch Warning**: Reminds you when you've been working for nearly 4 hours.
- 📱 **Multi-Channel Alerts**:
  - **Web Push API**: Native browser notifications on Desktop and Mobile PWAs.
  - **Ntfy / Gotify Integration**: Free push notifications directly to iOS/Android apps via [ntfy.sh](https://ntfy.sh) or self-hosted ntfy.
  - **In-App Toast & Sound Chimes**: Real-time visual and audio chime when browser tab is open.
- 📊 **Shift Logs & CSV Export**: Daily breakdown of total work, break, and lunch hours with CSV export and manual log adjustments.
- 🐳 **Portainer & Docker Native**: Embedded persistent SQLite database with zero external database dependencies.

---

## 🚀 Deployment Instructions for Portainer

### Method 1: Deploy as a Portainer Stack (Recommended)

1. Open your **Portainer** dashboard.
2. Go to **Stacks** -> **Add Stack**.
3. Name your stack (e.g., `time-tracker`).
4. Select **Web editor** and paste the content of `docker-compose.yml`:

```yaml
version: '3.8'

services:
  time-tracker:
    build: .
    image: time-tracker:latest
    container_name: time-tracker
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - PORT=8080
      - DATA_DIR=/app/data
      - NODE_ENV=production
      - TZ=America/New_York # Set your timezone
    volumes:
      - time_tracker_data:/app/data

volumes:
  time_tracker_data:
    driver: local
```

5. Click **Deploy the stack**.
6. Access the app at `http://your-server-ip:8080`.

---

### Method 2: Deploy using Docker CLI

```bash
# Clone or navigate to directory
cd "c:\Projects\Time Tracking"

# Build and start container
docker compose up -d --build
```

---

## ⚙️ Push Notification Configuration

1. Open the application at `http://your-server-ip:8080`.
2. Click the **⚙️ Settings** icon in the top right.
3. Configure your preferences:
   - **Standard Break Duration**: e.g., 15 minutes.
   - **Standard Lunch Duration**: e.g., 30 minutes.
   - **Warning Lead Time**: e.g., 3 minutes before break/lunch ends.
   - **Ntfy Topic**: Enter a topic name (e.g. `my-work-breaks-9821`) or full URL (e.g., `https://ntfy.sh/my-work-breaks-9821`). Download the Ntfy app on iOS/Android and subscribe to this topic name for instant mobile push notifications!
4. Click **🔔 Send Test Push** to verify alerts work.
