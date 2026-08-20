# Event Check-In System — Implementation Plan (v2)

This supersedes the earlier draft. The QR anti-sharing design (Hard Req #2) and the offline
scanning design (Hard Req #3) are now unified under a single TOTP-based mechanism, as decided
later in planning. Library choices below were re-checked against current package status
(Aug 2026) — two swaps from the original draft are flagged in §1.

---

## 1. Tech stack

| Layer | Choice | Why / current status |
|---|---|---|
| Frontend | Next.js (React) | One app, role resolved per-event, not globally |
| Backend | Node/Express, **standalone server** (not Next API routes) | Must run twice on two ports against one DB for the concurrency proof |
| Database | PostgreSQL | Real row-level locking + atomic conditional `UPDATE`s — this is the whole concurrency story |
| DB driver | `pg` directly for the atomic paths; Prisma optional elsewhere | Never trust an ORM's "increment" helper for the critical paths |
| Realtime | Socket.io | Live dashboard push |
| QR generation | `qrcode` (npm, aka `node-qrcode`) | Still the dominant, actively used library (1M+ weekly downloads); fine as-is |
| QR scanning | `html5-qrcode` | **Flag:** this library has had no releases since April 2023 and is explicitly in maintenance mode — the author is not merging PRs. It still works and is what the brief suggests, so it's a reasonable default, but note the risk in your write-up. If a camera-init bug hits you (some Samsung/Chrome combos are reported), `qr-scanner` (lighter, more actively maintained, web-worker based) is the drop-in alternative worth mentioning as a considered option. |
| TOTP | `otplib` (RFC 6238) | Actively maintained — v13+ rewrite, TypeScript-first, audited crypto (`@noble/hashes`/`@scure/base`). **API changed from older tutorials you may see online**: current usage is the flat async functions `generateSecret()`, `generate({ secret })`, `verify({ secret, token })` — not the old `authenticator.generate(secret)` class-based API. Use the current API in your code so you're not explaining a deprecated pattern in the interview. |
| Password KDF | `argon2` (Argon2id) | Derives the AES key from the organizer's password for the offline station bundle |
| Symmetric encryption | Node `crypto`, AES-256-GCM | Encrypts the offline station bundle |
| Client-side offline storage | IndexedDB via `idb` wrapper | Scan outbox + encrypted bundle cache |
| AI | xAI Grok API, server-side only | Event insights; key in `.env`, never sent to client. Endpoint is OpenAI-compatible (`https://api.x.ai/v1/chat/completions` — use the `openai` npm SDK, just point `baseURL` at xAI and use an `XAI_API_KEY`). Current flagship model as of Aug 2026 is `grok-4.6` (check `docs.x.ai` before you submit — xAI retires slugs and redirects them on a rolling basis, so pin an exact ID rather than a "latest" alias). |
| Auth | JWT (identifies user only, no global role claim) | Role resolved per-event via `event_organizers` |
| CSV export | `json2csv` or hand-rolled | Attendee list + check-in timestamps |

---

## 2. How Hard Requirements #2 and #3 now compose (the key design change)

Original plan: rotating tokens over polling (server round-trip every ~25s) for #2, and blind
queued scans for #3. Combining them the authenticator-app way removes the weakest part of both:

- **Registration time:** server generates a random TOTP secret per registration (same idea as
  the secret an authenticator app receives on setup) and stores it in `registrations.totp_secret`.
- **Client:** fetches that secret **once**, while online (`GET /registrations/:id/secret`),
  caches it in memory, then computes `TOTP(secret, time_step)` **entirely client-side** every
  30s to redraw the QR. No further server round-trips needed just to keep the QR rotating — this
  is strictly better than the original polling design, and the attendee's connectivity stops
  mattering after that first load.
- **QR payload:** `REG_<registrationId>.<6-digit-code>` — the ID is a lookup pointer, not a
  credential.
- **Server validation on scan:** look up `totp_secret` by `registrationId`, compute the expected
  code for the current time step ±1 (30s grace for drift/latency), compare.
- **Screenshot mitigation:** a screenshotted QR is only valid for the code's current ~30–60s
  window (with the ±1 step grace) before it's stale. Trade-off worth stating explicitly in your
  write-up: this is weaker than true one-time-use tokens (a screenshot taken and shared within
  that window still works), but it needs zero network access on the attendee's side to keep
  working, which one-time server-issued tokens don't give you for free.
- **What TOTP does *not* solve:** duplicate detection is a separate mechanism (§4) — TOTP proves
  the code is *authentic and current*, not that it hasn't already been used. State this
  distinction explicitly; it's a natural interview question.

### Offline scanning, two modes

| Mode | What the offline scanner can verify with zero connectivity | Trade-off |
|---|---|---|
| **Light** (build this) | Nothing extra — queues the scan blind like before; TOTP still reduces load on the attendee's phone | Simple, no added attack surface |
| **Full** (mention as considered) | Organizer pre-syncs an encrypted bundle of *all* registration secrets for the event before doors open; scanner can recompute the expected TOTP itself and instantly reject a garbage/expired code even offline | Every scanning device now holds every attendee's secret — a compromised device could forge valid-looking codes. Mitigate with a short-lived, device-scoped, organizer-password-gated bundle, wiped after the event. |

Either mode: **duplicate detection always waits for sync.** No station can know global state
(has this person already been scanned at another door) without the network — that's a hard
limit, not an implementation gap. Say so plainly in the write-up.

### Station A / Station B conflict resolution

Same attendee scanned offline at Station A, then online at Station B before A reconnects.
**Server-received order wins** (client device clocks are spoofable and not trustworthy for
ordering). The losing scan is not silently dropped — it's written to `scan_log` with
`result = 'flagged_conflict'` and its original `device_timestamp` preserved, so the organizer
can review it after the event. This is a design choice with reasonable alternatives (e.g.
"earliest device timestamp wins") — the write-up should say why server-received order was chosen
(trust boundary: you don't trust the client clock) and what you'd lose either way.

---

## 3. Full schema

```sql
-- Identity only. No role column — role is per-event.
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  capacity INT NOT NULL CHECK (capacity > 0),
  registered_count INT NOT NULL DEFAULT 0 CHECK (registered_count <= capacity),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Per-event permissions. Only source of truth for who can organize/scan/manage what.
CREATE TABLE event_organizers (
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id)
);

-- One row per attendee ticket.
CREATE TABLE registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  totp_secret TEXT NOT NULL,              -- base32, generated once at registration
  checked_in_at TIMESTAMPTZ,              -- NULL = not checked in. Source of truth.
  checked_in_by TEXT,                     -- station id
  checked_in_source TEXT CHECK (checked_in_source IN ('online','offline-sync')),
  client_scan_id UUID,                    -- idempotency key of the winning scan
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, user_id)
);

-- Append-only audit trail — every scan attempt, not just winners.
CREATE TABLE scan_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID REFERENCES registrations(id),
  station_id TEXT NOT NULL,
  client_scan_id UUID NOT NULL,
  device_timestamp TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ DEFAULT NOW(),
  result TEXT NOT NULL CHECK (result IN
    ('accepted','rejected_duplicate','flagged_conflict','rejected_invalid_totp')),
  UNIQUE(client_scan_id)                  -- enforces sync idempotency at the DB level
);

-- Only needed if you build Full offline mode.
CREATE TABLE station_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  station_id TEXT NOT NULL,
  ciphertext BYTEA NOT NULL,   -- AES-256-GCM encrypted { registrationId: totp_secret }
  salt BYTEA NOT NULL,         -- Argon2id salt
  iv BYTEA NOT NULL,           -- AES-GCM nonce
  auth_tag BYTEA NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. API surface

**Auth**
- `POST /auth/register` — create user, hash password (argon2), return JWT
- `POST /auth/login` — verify password, return JWT

**Events**
- `POST /events` — create event; one transaction: insert `events` row + insert creator into `event_organizers`
- `GET /events/:id` — public event details
- `POST /events/:id/organizers` — add co-organizer; caller must already be an organizer of that event
- `GET /events/:id/dashboard` — organizer-only; live counts + checked-in list (also pushed via Socket.io on every check-in)
- `GET /events/:id/export.csv` — organizer-only; registrations joined with check-in timestamps

**Registration**
- `POST /events/:id/register` — atomic capacity-checked registration, generates `totp_secret`, returns `registrationId`
- `GET /registrations/:id/secret` — auth-gated to the owning user; one-time fetch of `totp_secret` for client-side QR rendering

**Check-in**
- `POST /events/:id/checkin` — body: `{ registrationId, totpCode, stationId, clientScanId, deviceTimestamp }` → `{ status: 'accepted' | 'rejected_duplicate' | 'rejected_invalid_totp', checkedInAt? }`
- `POST /events/:id/checkin/sync-batch` — same logic for a queued array of offline scans, each keyed on `clientScanId` for idempotency

**AI insights**
- `POST /events/:id/insights` — organizer-only; body `{ question }`; server computes stats, calls Anthropic API, returns answer (or raw stats on failure/timeout)

**Offline bundle (Full mode only)**
- `POST /events/:id/station-bundle` — organizer-only; body `{ password }`; builds `{registrationId: totp_secret}`, encrypts with Argon2id-derived key, returns ciphertext+salt+iv+authTag for IndexedDB caching

---

## 5. Core atomic methods (the heart of Hard Requirement #1)

```js
// registerForEvent — atomic capacity check, no read-then-write
async function registerForEvent(eventId, userId) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query(
      `UPDATE events
       SET registered_count = registered_count + 1
       WHERE id = $1 AND registered_count < capacity
       RETURNING *`,
      [eventId]
    );
    if (rows.length === 0) throw new EventFullError();

    const totpSecret = generateBase32Secret(); // otplib: await generateSecret()
    const { rows: regRows } = await tx.query(
      `INSERT INTO registrations (event_id, user_id, totp_secret)
       VALUES ($1, $2, $3)
       ON CONFLICT (event_id, user_id) DO NOTHING
       RETURNING *`,
      [eventId, userId, totpSecret]
    );
    if (regRows.length === 0) throw new AlreadyRegisteredError();
    return regRows[0];
  });
}

// checkIn — atomic duplicate check, no read-then-write
async function checkIn({ registrationId, totpCode, stationId, clientScanId, deviceTimestamp }) {
  const reg = await db.query(
    `SELECT totp_secret, checked_in_at FROM registrations WHERE id = $1`,
    [registrationId]
  );
  if (!reg.rows[0]) return { status: 'not_found' };

  // otplib v13+: await verify({ secret, token }) -> { valid: boolean }
  const { valid } = await verify({ secret: reg.rows[0].totp_secret, token: totpCode });
  if (!valid) {
    await logScan(registrationId, stationId, clientScanId, deviceTimestamp, 'rejected_invalid_totp');
    return { status: 'rejected_invalid_totp' };
  }

  const { rows } = await db.query(
    `UPDATE registrations
     SET checked_in_at = NOW(), checked_in_by = $2, checked_in_source = 'online', client_scan_id = $3
     WHERE id = $1 AND checked_in_at IS NULL
     RETURNING checked_in_at`,
    [registrationId, stationId, clientScanId]
  );

  if (rows.length === 0) {
    const existing = await db.query(
      `SELECT checked_in_at FROM registrations WHERE id = $1`, [registrationId]
    );
    await logScan(registrationId, stationId, clientScanId, deviceTimestamp, 'rejected_duplicate');
    return { status: 'rejected_duplicate', checkedInAt: existing.rows[0].checked_in_at };
  }

  await logScan(registrationId, stationId, clientScanId, deviceTimestamp, 'accepted');
  io.to(`event:${eventId}`).emit('checkin', { registrationId, checkedInAt: rows[0].checked_in_at });
  return { status: 'accepted', checkedInAt: rows[0].checked_in_at };
}

// syncOfflineScan — identical path, idempotent on client_scan_id
async function syncOfflineScan(scan) {
  const already = await db.query(
    `SELECT result FROM scan_log WHERE client_scan_id = $1`, [scan.clientScanId]
  );
  if (already.rows[0]) return { status: already.rows[0].result, alreadyProcessed: true };
  return checkIn({ ...scan, checked_in_source: 'offline-sync' });
}
```

**Why this is correct even with two server processes racing:** the `UPDATE ... WHERE
checked_in_at IS NULL RETURNING *` is a single statement. Postgres row-locks the row for the
duration of that statement, so if two processes hit it at the same instant, one applies the
`SET` and gets a row back; the other's `UPDATE` runs against the now-updated row, matches zero
rows, and gets a clean `rejected_duplicate`. No in-memory mutex, no separate
read-then-decide-then-write window — that gap is exactly what a naive
`SELECT → check in JS → UPDATE` implementation would leave open, and exactly what the proof
script in §7 is built to catch.

---

## 6. Client-side offline storage (IndexedDB via `idb`)

```
scan_outbox           keyPath: client_scan_id
  { client_scan_id, registration_id, totp_code, station_id,
    device_timestamp, sync_status: 'pending'|'syncing'|'synced'|'failed',
    retry_count, last_attempt_at }
  index: sync_status, device_timestamp

station_bundle         keyPath: event_id   (Full mode only)
  { event_id, ciphertext, salt, iv, auth_tag, fetched_at }
  -- ciphertext only, ever. Never decrypted secrets.

decryptedSecrets       -- NOT IndexedDB. In-memory JS Map only.
  -- populated after password entry + Argon2id key derivation,
  -- wiped on tab close/reload by design.
```

Stretch: service worker + Cache API to cache the app shell itself, so the scanning PWA loads
with zero connectivity, not just queues scans after it's already open.

---

## 7. Authorization model

- No global `role` column on `users`. Every organizer-only action checks:
  ```sql
  SELECT 1 FROM event_organizers WHERE event_id = $1 AND user_id = $2;
  ```
  No row → 403, enforced server-side regardless of UI state.
- Creating an event auto-inserts the creator into `event_organizers` in the same transaction.
- Registration is role-agnostic — anyone can register for any event, including their own.

---

## 8. Hard Requirement #1 — proof script

- Node script, `Promise.all` firing 150+ concurrent `POST /register` at an event with capacity
  50, and 20+ concurrent `POST /checkin` at the same registration ID.
- Run Express on two ports (`PORT=3001`, `PORT=3002`) against the same Postgres instance; split
  requests across both.
- Log: success count, rejection count, final `registered_count` vs `capacity`. Capture terminal
  output as the proof artifact — the brief explicitly says a simple script is enough; no need for
  sophisticated test tooling.

---

## 9. Hard Requirement #4 — AI insights (Grok)

1. Backend computes real stats first: check-in count, no-show % (`1 - checked_in/registered`),
   peak check-in time (15-min bucket, max), spots left (`capacity - registered_count`).
2. Stats passed as JSON into the Grok system prompt: *"Answer using ONLY the JSON stats provided.
   Never invent numbers not present in the data."*
3. Question goes in as the user message; model summarizes, never calculates.
4. Server-side only call, key in `.env` as `XAI_API_KEY`. Since xAI's API is OpenAI-schema
   compatible, use the `openai` npm package pointed at xAI's base URL rather than a bespoke
   client:

   ```js
   import OpenAI from "openai";

   const grok = new OpenAI({
     apiKey: process.env.XAI_API_KEY,
     baseURL: "https://api.x.ai/v1",
   });

   async function getInsight(question, stats) {
     const completion = await grok.chat.completions.create({
       model: "grok-4.6", // pin an exact ID — xAI retires "latest"-style slugs over time
       messages: [
         {
           role: "system",
           content:
             "You are answering questions about a live event's check-in data. " +
             "Use ONLY the JSON stats provided below — never invent, estimate, or " +
             "recompute a number that isn't already in this data.\n\n" +
             JSON.stringify(stats),
         },
         { role: "user", content: question },
       ],
     });
     return completion.choices[0].message.content;
   }
   ```
5. `AbortController`/client `timeout` (~8s) + try/catch; on failure or timeout, fall back to
   rendering the raw `stats` object with a note instead of crashing.
6. Loading indicator while the request is in flight.
7. Note for the write-up: Grok's training data has a real-time-search feature for current events,
   but that's irrelevant and should stay disabled here — this call only ever needs the JSON stats
   you hand it, not the open web.

---

## 10. Suggested build order

1. Data model + auth + `event_organizers` middleware
2. Event creation + atomic capacity-safe registration
3. Check-in endpoint with atomic duplicate prevention → concurrency proof script (get this
   working and proven before adding TOTP — it's the highest-weight requirement)
4. Add TOTP: secret gen at registration, one-time secret fetch, client-side rotation, server-side
   validation on scan
5. Live dashboard via Socket.io
6. CSV export
7. Offline queue (Light mode) + sync + conflict logging
8. AI insights endpoint + UI
9. Stretch: Full offline mode (Argon2id + AES-GCM station bundle)
10. Write-up

---

## 11. Write-up checklist

- Stack choices + anything learned specifically for this task (e.g. otplib's current async API,
  html5-qrcode's maintenance status)
- Concurrency proof script output
- TOTP + registration-ID-prefix QR design, and the screenshot-validity-window trade-off
- Explicit statement that TOTP validates authenticity, not duplicate-use — duplicate detection is
  a separate, sync-dependent mechanism
- Station A/B conflict-resolution reasoning (server-received order, why client clocks aren't trusted)
- Full offline-mode encryption design and its honest limits, if built
- Anything left incomplete, and why
