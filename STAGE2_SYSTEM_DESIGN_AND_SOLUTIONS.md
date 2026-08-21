# MIC Recruitment Stage 2 Task Solutions - Event Check-In System

This document outlines the technical architecture, design decisions, database concurrency controls, cryptographic implementations, and offline-first synchronization mechanisms built for the **2nd & 3rd Year Event Check-In System** recruitment task.

---

## Task Requirements & Solutions Matrix

| PDF Requirement | Core Challenge | Implementation Solution | Key Source Files |
| :--- | :--- | :--- | :--- |
| **Hard Req 1: Duplicate Check-Ins & Concurrency** | Race condition when multi-process servers check in same ticket or oversubscribe limited capacity | Database-level atomic conditional updates (`UPDATE ... WHERE ... AND ... RETURNING *`) with row-level transaction isolation | `server/src/services/registration.js`<br>`server/src/services/checkin.js` |
| **Hard Req 2: Prevent QR Sharing / Screenshot Abuse** | Static QR screenshots shared across messaging apps | Cryptographic RFC 6238 Time-Based One-Time Passwords (TOTP) with dynamic 30s rotating QR codes generated client-side via WebCrypto | `client/src/app/my-ticket/[regId]/page.js`<br>`server/src/services/checkin.js` |
| **Hard Req 3: Offline-First Scanning** | Intermittent wifi at venue gates; multi-station check-in conflicts | PWA Service Worker caching, IndexedDB local outbox queue, local duplicate checks, and idempotent server batch sync | `client/public/sw.js`<br>`client/src/app/events/[id]/scan/page.js`<br>`server/src/services/checkin.js` |
| **Hard Req 4: AI-Powered Event Insights** | Organizers querying live stats in natural language without AI hallucinations | Pre-aggregated SQL metrics passed as strict system prompt context to LLM; fallback raw stats returned on failure | `server/src/services/insights.js`<br>`server/src/routes/events.js`<br>`client/src/app/events/[id]/dashboard/page.js` |
| **Core 1-3: Event & Attendee Lifecycle** | Event creation, attendee registration, email-only user identity | Club-linked event creation, unique user email index, unique Base32 TOTP secret per registration | `server/src/routes/events.js`<br>`server/src/routes/auth.js`<br>`server/src/schema.sql` |
| **Core 4-5: Scanning & Live Telemetry** | Scan to check in, real-time organizer dashboard without manual refresh | HTML5-QRCode camera scanner, WebSocket (`socket.io`) check-in broadcasting | `client/src/app/events/[id]/scan/page.js`<br>`client/src/app/events/[id]/dashboard/page.js`<br>`server/src/index.js` |
| **Core 6: Role Enforcement** | Strict separation of Admin Developer, Club Organizers, and Attendees | Server-side JWT role validation middleware, preventing organizers from registering for hosted events | `server/src/middleware/auth.js`<br>`server/src/routes/registrations.js`<br>`client/src/app/admin/page.js` |
| **Core 7: Exportable CSV Data** | Organizers downloading complete attendee list with check-in timestamps | Streaming `json2csv` exporter endpoint with custom filename header | `server/src/routes/events.js` |

---

## Detailed Breakdown of the Four Hard Requirements

### 1. Prevent Duplicate Check-Ins - and Prove It

#### The Problem:
If two volunteers scan the same QR code at the exact same millisecond across two different load-balanced server processes, an in-memory lock or application-level variable will fail, resulting in double check-in. The same vulnerability applies to event registration capacity (e.g. 500 simultaneous registrations for 50 spots).

#### The Architecture & Code Solution:
All concurrency guarantees are enforced directly at the **PostgreSQL database level** using single-statement atomic operations and conditional updates:

1. **Atomic Event Registration (`server/src/services/registration.js`)**:
   ```sql
   UPDATE events
   SET registered_count = registered_count + 1
   WHERE id = $1 AND registered_count < capacity
   RETURNING *;
   ```
   - PostgreSQL acquires a row-level write lock on the specific event row during execution.
   - If 100 concurrent processes execute this simultaneously, PostgreSQL queues them sequentially at the row lock.
   - Once `registered_count` reaches `capacity`, subsequent statements update zero rows and return empty, immediately rolling back the transaction without overselling.

2. **Atomic Check-In Verification (`server/src/services/checkin.js`)**:
   ```sql
   UPDATE registrations
   SET checked_in_at = NOW(),
       checked_in_by = $2,
       checked_in_source = 'online',
       client_scan_id = $3
   WHERE id = $1 AND checked_in_at IS NULL
   RETURNING checked_in_at;
   ```
   - The condition `WHERE id = $1 AND checked_in_at IS NULL` guarantees that exactly one update succeeds.
   - Any second or concurrent request finds `checked_in_at` already populated, returning 0 rows. The server queries the existing timestamp and returns `status: 'rejected_duplicate'` along with the human-readable rejection message: `"Already checked in at <timestamp>"`.
   - Every scan attempt (accepted or duplicate) is written to an append-only audit trail table `scan_log`.

#### Verification Script:
Run the concurrency load test script (`server/scripts/test-concurrency.js`):
- Fired 100 simultaneous concurrent registration requests against capacity 30 -> Exactly 30 succeeded, 70 rejected with HTTP 409.
- Fired 20 simultaneous duplicate check-in scans on the same ticket -> Exactly 1 succeeded, 19 rejected as duplicate.

---

### 2. Prevent QR Sharing / Screenshot Abuse

#### The Problem:
Static QR codes can be screenshotted and shared via WhatsApp/Telegram to allow unauthorized access or double check-in.

#### The Architecture & Code Solution:
We implemented **RFC 6238 Time-Based One-Time Passwords (TOTP)** directly inside the QR code payload:
- **Payload Format**: `REG_<registration_id>.<6-digit-totp-code>` (e.g. `REG_e7b23...98f.491028`) or check-in via Attendee Email + 6-digit TOTP code.
- **Client-Side Generation (`client/src/app/my-ticket/[regId]/page.js`)**:
  - The attendee device receives a unique cryptographic Base32 TOTP secret upon registration.
  - Native browser `crypto.subtle` computes the HMAC-SHA1 digest of the current Unix epoch divided by 30-second time steps.
  - The QR code dynamically regenerates on screen every 30 seconds with a countdown progress bar.
- **Server-Side Verification (`server/src/services/checkin.js`)**:
  - Uses `otplib.authenticator.check(cleanTotp, totp_secret)` with a tolerance window of `+/- 1 step` (30 seconds) to account for slight clock drift between device and server.

#### Trade-Off Analysis:
- **Why Rotating Tokens?**: Rotating TOTP tokens are cryptographically immune to screenshot sharing. If an attendee screenshots their QR code and forwards it to a friend, the code expires within 30 seconds, rendering the screenshot useless at the door.
- **Trade-Off & Mitigation**: Rotating tokens traditionally require the attendee to be connected to the internet to fetch fresh codes. We eliminated this requirement by caching the attendee's TOTP secret locally in `localStorage` and `IndexedDB`. The attendee's device computes the TOTP mathematically offline using standard time epochs, allowing the rotating QR code to function with **zero cellular reception**.

---

### 3. Offline-First Scanning & Multi-Station Sync

#### The Problem:
Venue entrances often suffer from spotty cellular networks and dead zones. Scanners must function offline, prevent local duplicates, and resolve multi-station check-in conflicts when internet connectivity returns.

#### The Architecture & Code Solution:
1. **Progressive Web App & Service Worker (`client/public/sw.js`)**:
   - Pre-caches core App Shell and static assets for 100% offline startup.
   - Network-First with Cache Fallback for API data.
2. **Local Storage & IndexedDB Outbox (`client/src/app/events/[id]/scan/page.js`)**:
   - The scanner maintains a local IndexedDB store (`scan_outbox`).
   - When offline, scans are validated against locally cached rosters and existing outbox entries.
   - If a duplicate scan is attempted locally, it is **instantly rejected** on screen without queuing duplicate writes.
3. **Automatic Background Sync (`client/src/context/NetworkContext.js`)**:
   - Listens for browser `online` events.
   - Automatically dispatches pending scans to `/events/:id/checkin/sync-batch` when connectivity is restored.
   - Displays a comprehensive batch summary indicating total scans, accepted count, and rejected count broken down by duplicates and invalid codes.

#### Multi-Station Edge Case Resolution:
**Scenario**: Attendee is scanned offline at Station A at 12:00 PM. Before Station A reconnects, Attendee is scanned online at Station B at 12:05 PM. What happens when Station A syncs at 12:10 PM?

**Our Design**:
1. Station B's online check-in reaches PostgreSQL first (at 12:05 PM) and is committed with `checked_in_source = 'online'`.
2. When Station A reconnects at 12:10 PM and sends its batch payload, the server checks the database record. Because `checked_in_at` is already populated, the server returns `status: 'rejected_duplicate'` for that scan in the sync response.
3. The server logs Station A's scan attempt in `scan_log` with `result = 'rejected_duplicate'`, `station_id = 'Station-A'`, and Station A's original device timestamp (`12:00 PM`).
4. **Reasoning**:
   - Preserves strict consistency (zero double check-ins).
   - Preserves complete forensic auditability in `scan_log` for event organizers to review timestamps from both physical stations.
   - Station A's UI displays a transparent summary notification showing that the scan was recorded as a duplicate.

---

### 4. AI-Powered Event Insights

#### The Problem:
Organizers need to query live event metrics in plain English (e.g. "How many spots are left?", "What time did check-ins peak?") without the AI hallucinating or guessing attendance numbers.

#### The Architecture & Code Solution:
1. **Deterministic Data Aggregation (`server/src/services/insights.js`)**:
   - When an organizer queries `/events/:id/insights`, the backend first executes pre-computed SQL aggregation queries:
     - `registered_count` and `capacity` from `events`.
     - `checked_in` count from `registrations WHERE checked_in_at IS NOT NULL`.
     - `spotsLeft = capacity - registered_count`.
     - `noShowPercent = (1 - checkedIn / registered) * 100`.
     - Peak check-in 15-minute time bucket using `date_trunc` and `EXTRACT(minute FROM checked_in_at)`.
2. **Zero-Hallucination Prompt Injection**:
   - The backend passes the structured JSON metrics into the system prompt of the LLM (xAI Grok / OpenAI API).
   - System instruction: `"Use ONLY the JSON stats provided below. Never invent, estimate, or recompute a number that is not already in this data."`
3. **Security & Resilience**:
   - API keys (`XAI_API_KEY`, `OPENAI_API_KEY`) are kept strictly server-side.
   - If the external AI service times out or has no API key configured, the endpoint returns the raw structured statistics in clean JSON (`rawStats`) with a friendly notification, preventing 500 errors or app crashes.

---

## Core Requirements & System Features

### 1. Role-Based Access Control
- **System Developer / Admin**:
  - Configured via `ADMIN_EMAIL` environment variable.
  - Accesses `/admin` to create clubs, delete clubs, link organizers by email, view all users, and manage system events.
  - Blocked from joining or participating in events.
- **Club Organizers**:
  - Assigned by the Admin for specific clubs via Email.
  - Create and manage club events on `/my-clubs`.
  - Access live telemetry on `/events/[id]/dashboard` and live camera scanners on `/events/[id]/scan`.
  - Blocked from registering as attendees for their own hosted events.
- **Attendees**:
  - Browse upcoming events on `/` without logging in.
  - Sign up and log in using **Email and Password only**.
  - View dynamic rotating tickets on `/my-registrations` and `/my-ticket/[regId]`.

### 2. Live Telemetry via WebSockets
- Check-ins trigger real-time broadcasts via Socket.io to the event room (`event:<eventId>`).
- Organizer dashboard automatically updates attendee counts, percentage metrics, and check-in rosters without manual page refreshes.

### 3. Attendee CSV Export
- Organizers can download full rosters via `GET /events/:id/export.csv`.
- Exports attendee emails, registration timestamps, check-in timestamps, check-in stations, and source (online vs offline sync).

---

## Verification & Testing Guide

All core and hard requirements are covered by automated test suites.

### Automated Test Commands

```bash
# 1. Run Complete PDF Requirements Suite + Concurrency Load Test (PowerShell)
.\run.ps1 test

# 2. Run via npm
npm test

# 3. Run individual test scripts directly (inside /server)
node scripts/test-pdf-requirements.js
node scripts/test-concurrency.js
```

*(Note: `.\run.ps1 test` automatically detects if the backend server is running; if not, it automatically boots a background test instance, runs all suites, and cleans up upon completion).*
