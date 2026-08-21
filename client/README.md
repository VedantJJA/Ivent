# Ivent Client Application

This is the Next.js frontend client for the Ivent Event Management and QR Check-In System.

---

## Features
- **PWA & Offline Capability**: Service Worker pre-caching, Offline Ticket rendering via WebCrypto TOTP, and IndexedDB scanner outbox.
- **Scanner View**: HTML5 camera-based QR scanner and manual email-based check-in input.
- **Live Telemetry**: Real-time Socket.io updates on organizer dashboards.
- **Role-Based Views**: Admin Developer portal, Club Organizer dashboard, and Attendee ticket views.

---

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment (`.env.local`):
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

3. Run development server:
   ```bash
   npm run dev
   ```

4. Build production bundle:
   ```bash
   npm run build
   ```
