# Ivent - Event Management and QR Check-In System

Ivent is a full-stack, offline-capable event check-in and management platform. It features dynamic TOTP-based rotating QR codes to prevent screenshot sharing, atomic database transactions to eliminate overselling, an offline-first Progressive Web App (PWA) scanner with automatic background synchronization, live check-in telemetry via WebSockets, and role-based permissions for system developers, club organizers, and attendees.

---

## Architecture Overview

- **Frontend (`/client`)**: Next.js (App Router), React, Vanilla CSS design system, HTML5-QRCode scanner, PWA Service Worker with offline caching, Browser WebCrypto TOTP engine.
- **Backend (`/server`)**: Node.js, Express, Socket.io for live check-in telemetry, PostgreSQL connection pool (`pg`), OTPLib TOTP validator, JSON Web Tokens (JWT), bcrypt password hashing.
- **Database (`PostgreSQL`)**: Relational database with transactional isolation, unique registration number indexing, and append-only scan audit logging.

---

## Prerequisites

Ensure you have the following installed on your machine:
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher
- **PostgreSQL**: v14.0 or higher (local instance or managed cloud database)

---

## Installation and Setup

### 1. Clone the Repository

```bash
git clone https://github.com/VedantJJA/Ivent.git
cd Ivent
```

---

### 2. Environment Variables Configuration

#### Backend Configuration (`server/.env`)
Create a file named `.env` inside the `server/` directory:

```env
# Server Port
PORT=3001

# PostgreSQL Connection String
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ivent

# JWT Secret Key
JWT_SECRET=your-secure-jwt-secret-key-change-in-production

# System Developer / Administrator Email
ADMIN_EMAIL=admin@example.com

# Optional: Frontend URL for CORS (in production)
CLIENT_URL=http://localhost:3000

# Optional: AI Insights API Key
XAI_API_KEY=
```

#### Frontend Configuration (`client/.env.local`)
Create a file named `.env.local` inside the `client/` directory:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

---

### 3. Database Initialization

1. Create a local PostgreSQL database named `ivent` if it does not already exist:
   ```sql
   CREATE DATABASE ivent;
   ```
2. Initialize tables, indexes, and constraints:
   ```bash
   cd server
   node src/db-init.js
   cd ..
   ```

---

### 4. Running the Application Locally

#### Option A: Using PowerShell Script (Windows)
A root helper script `run.ps1` is provided for one-step local management:

```powershell
# Install all dependencies (server + client)
.\run.ps1 setup

# Initialize database schema
.\run.ps1 db-init

# Start both server and client concurrently
.\run.ps1 dev
```

#### Option B: Manual Terminal Execution (macOS / Linux / Windows)

Open two terminal windows:

**Terminal 1 (Backend Server):**
```bash
cd server
npm install
npm run dev
# Server will start on http://localhost:3001
```

**Terminal 2 (Frontend Client):**
```bash
cd client
npm install
npm run dev
# Client will start on http://localhost:3000
```

---

## Roles and Access Flow

### 1. System Developer / Admin
- Identified strictly by the `ADMIN_EMAIL` environment variable.
- Accesses `/admin` to create clubs, delete clubs, link organizers to clubs, view all users and events, and delete events.
- Cannot join, register for, or participate in events directly.

### 2. Club Organizers
- Users granted organizer status by the Admin for one or more clubs.
- Accesses `/my-clubs` to view hosted events and create new club events.
- Accesses `/events/[id]/dashboard` for live check-in telemetry, attendee rosters, and CSV exports.
- Accesses `/events/[id]/scan` to scan QR codes or manually check in attendees.

### 3. Attendees
- Browse upcoming events on `/` without logging in.
- Sign up with an Email, Password, and optional Registration Number / Student ID.
- Register for events and access dynamic rotating QR tickets under `/my-registrations` and `/my-ticket/[regId]`.
- Log in using either their Email Address or Registration Number.

---

## Check-In and Scanner Operations

1. **Rotating TOTP QR Codes**:
   - Tickets compute dynamic 6-digit TOTP codes every 30 seconds using native WebCrypto SHA-1.
   - Screen captures and forwarded screenshots expire automatically after 30 seconds.

2. **Live Camera Scanner**:
   - Organizers use `/events/[id]/scan` to scan attendee tickets.
   - Auto-selects rear environment camera on mobile devices with webcam fallbacks.
   - 3-second cooldown throttle prevents duplicate frame reads.

3. **Manual Check-In**:
   - Supports check-in by entering the attendee's Email Address or Registration Number alongside their active 6-digit ticket Auth Code.

4. **Offline PWA & Auto-Sync**:
   - Automatically detects internet loss and switches to Offline Mode.
   - Validates duplicate scans locally against IndexedDB to reject repeated tokens immediately.
   - Automatically synchronizes queued offline check-ins in the background when the connection is restored.

---

## Concurrency Testing

To verify concurrency safety and atomic capacity reservation under heavy traffic loads:

```bash
cd server
npm run proof
```

The test script spawns simultaneous concurrent registrations against a limited-capacity event, demonstrating that zero overselling occurs.

---

## Cloud Deployment (Render Blueprint)

The repository includes a ready-to-deploy `render.yaml` infrastructure Blueprint:

1. Push your repository to GitHub.
2. Log into [Render](https://dashboard.render.com).
3. Click **New +** -> **Blueprint**.
4. Connect this repository. Render will automatically provision:
   - `ivent-db`: Managed PostgreSQL instance.
   - `ivent-api`: Node.js Express server.
   - `ivent-client`: Next.js web application.
5. Set `ADMIN_EMAIL` and `JWT_SECRET` in the Render dashboard environment variables.

---

## Available Scripts

### Root Directory
- `.\run.ps1 dev`: Start both backend and frontend for local development.
- `.\run.ps1 setup`: Install all dependencies across client and server.
- `.\run.ps1 db-init`: Run database schema creation and migrations.
- `.\run.ps1 build`: Build the production client bundle.
- `.\run.ps1 proof`: Run concurrency load testing.

### Server Directory (`/server`)
- `npm run dev`: Start Express backend with nodemon file watcher.
- `npm start`: Start Express backend in production mode.
- `npm run db:init`: Execute schema SQL definitions on PostgreSQL.
- `npm run proof`: Execute concurrency reservation proof.

### Client Directory (`/client`)
- `npm run dev`: Start Next.js development server with Turbopack.
- `npm run build`: Compile and build optimized Next.js production output.
- `npm start`: Start Next.js production server.
