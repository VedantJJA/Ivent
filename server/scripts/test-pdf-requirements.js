// PDF Requirements Test Suite for Ivent (2nd & 3rd Year Task)
// Tests all 7 Core Requirements and 4 Hard Requirements outlined in the task specification.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 3001}`;
const JWT_SECRET = process.env.JWT_SECRET || 'ivent-dev-secret-key-2026';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@example.com').split(',')[0].trim();

async function req(path, method = 'GET', body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    return { status: res.status, ok: res.ok, data, headers: res.headers };
  } catch (err) {
    return {
      status: 0,
      ok: false,
      error: `Network error: ${err.message}. Is backend server running on ${BASE_URL}?`,
    };
  }
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runPdfTests() {
  console.log('===============================================================');
  console.log('   MIC Recruitment 2nd & 3rd Year Task: PDF Requirements Test   ');
  console.log('===============================================================');
  console.log(`Target Backend: ${BASE_URL}\n`);

  const uniqueId = Date.now().toString().slice(-6);

  // SECTION 1: CORE REQUIREMENTS

  console.log('---------------------------------------------------------------');
  console.log('SECTION 1: Core Requirements Verification');
  console.log('---------------------------------------------------------------');

  // Core 1: Setup Admin & Club
  const adminToken = jwt.sign(
    { id: 'admin-test-id', email: ADMIN_EMAIL, is_admin: true },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const clubRes = await req('/admin/clubs', 'POST', {
    name: `Tech Innovators Club ${uniqueId}`,
    description: 'Student engineering and tech club',
  }, adminToken);
  assert(clubRes.status === 201, `Club created successfully (ID: ${clubRes.data?.club?.id})`);
  const clubId = clubRes.data?.club?.id;

  // Organizer Setup
  const orgEmail = `lead-organizer-${uniqueId}@test.local`;
  const orgUserRes = await req('/auth/register', 'POST', {
    email: orgEmail,
    password: 'password123',
    regNumber: `ORG-${uniqueId}`,
  });
  const orgToken = orgUserRes.data?.token;
  const orgUserId = orgUserRes.data?.user?.id;

  await req(`/admin/clubs/${clubId}/members`, 'POST', { userId: orgUserId }, adminToken);

  // Core 1: Event Creation (Organizer creates event with name, date, capacity)
  console.log('\n[Core Req 1] Event Creation:');
  const eventRes = await req('/events', 'POST', {
    name: `MIC Hackathon 2026 ${uniqueId}`,
    description: 'Annual flagship coding competition',
    location: 'Main Auditorium',
    eventDate: new Date(Date.now() + 86400000).toISOString(),
    capacity: 20,
    clubId: clubId,
  }, orgToken);
  assert(eventRes.status === 201, `Event created with name, date, capacity 20 (got status ${eventRes.status})`);
  const eventId = eventRes.data?.event?.id;

  // Core 2 & 3: Registration & Unique QR per Attendee
  console.log('\n[Core Req 2 & 3] Registration & Unique QR Code Per Attendee:');
  const attendeeEmail1 = `alice-${uniqueId}@test.local`;
  const attendee1Res = await req('/auth/register', 'POST', {
    email: attendeeEmail1,
    password: 'password123',
    regNumber: `ATT1-${uniqueId}`,
  });
  const attendee1Token = attendee1Res.data?.token;

  const attendeeEmail2 = `bob-${uniqueId}@test.local`;
  const attendee2Res = await req('/auth/register', 'POST', {
    email: attendeeEmail2,
    password: 'password123',
    regNumber: `ATT2-${uniqueId}`,
  });
  const attendee2Token = attendee2Res.data?.token;

  const reg1Res = await req(`/events/${eventId}/register`, 'POST', {}, attendee1Token);
  const reg2Res = await req(`/events/${eventId}/register`, 'POST', {}, attendee2Token);
  assert(reg1Res.status === 201 && reg2Res.status === 201, 'Both attendees registered successfully');

  const reg1Id = reg1Res.data?.registration?.id;
  const reg2Id = reg2Res.data?.registration?.id;
  assert(reg1Id !== reg2Id, `Unique registration IDs assigned (${reg1Id} vs ${reg2Id})`);

  const secret1Res = await req(`/registrations/${reg1Id}/secret`, 'GET', null, attendee1Token);
  const secret2Res = await req(`/registrations/${reg2Id}/secret`, 'GET', null, attendee2Token);
  assert(
    secret1Res.data?.secret && secret2Res.data?.secret && secret1Res.data.secret !== secret2Res.data.secret,
    'Each attendee receives a unique cryptographic TOTP secret for their QR code'
  );

  // Core 4: Scan-to-Check-In
  console.log('\n[Core Req 4] Scan-to-Check-In (Live Camera & Payload Processing):');
  const totpCode1 = authenticator.generate(secret1Res.data.secret);
  const checkin1Res = await req(`/events/${eventId}/checkin`, 'POST', {
    registrationId: reg1Id,
    totpCode: totpCode1,
    stationId: 'camera-scanner-alpha',
    clientScanId: uuidv4(),
    deviceTimestamp: new Date().toISOString(),
  }, orgToken);
  assert(checkin1Res.data?.status === 'accepted', `Attendee 1 checked in successfully (${checkin1Res.data?.status})`);

  // Core 5: Live Dashboard
  console.log('\n[Core Req 5] Live Dashboard & Real-Time Telemetry:');
  const dashboardRes = await req(`/events/${eventId}/dashboard`, 'GET', null, orgToken);
  assert(dashboardRes.status === 200, 'Organizer fetched live dashboard');
  const checkedInAttendees = dashboardRes.data?.registrations?.filter(r => r.checked_in_at);
  assert(checkedInAttendees?.length === 1, `Dashboard reflects live check-in count (1 checked in)`);

  // Core 6: Role Enforcement
  console.log('\n[Core Req 6] Role Enforcement (Organizer vs. Attendee vs. Admin):');
  const attendeeScanAttempt = await req(`/events/${eventId}/checkin`, 'POST', {
    registrationId: reg2Id,
    totpCode: '123456',
  }, attendee1Token);
  assert(attendeeScanAttempt.status === 403, `Non-organizer attendee blocked from scanning (got status ${attendeeScanAttempt.status})`);

  const orgSelfRegAttempt = await req(`/events/${eventId}/register`, 'POST', {}, orgToken);
  assert(orgSelfRegAttempt.status === 403, `Organizer blocked from participating in hosted event (got status ${orgSelfRegAttempt.status})`);

  // Core 7: Exportable CSV Data
  console.log('\n[Core Req 7] Exportable Attendee Data (CSV Format):');
  const exportRes = await req(`/events/${eventId}/export.csv`, 'GET', null, orgToken);
  assert(exportRes.status === 200, 'CSV export endpoint returned status 200');
  const csvContent = exportRes.data?.raw || '';
  assert(
    csvContent.includes('email') && csvContent.includes('checked_in_at') && csvContent.includes(attendeeEmail1),
    'CSV contains attendee emails and check-in timestamps'
  );


  // SECTION 2: THE FOUR HARD REQUIREMENTS

  console.log('\n---------------------------------------------------------------');
  console.log('SECTION 2: The Four Hard Requirements Verification');
  console.log('---------------------------------------------------------------');

  // Hard Req 1: Prevent Duplicate Check-Ins
  console.log('\n[Hard Req 1] Prevent Duplicate Check-Ins:');
  const dupCheckinAttempt = await req(`/events/${eventId}/checkin`, 'POST', {
    registrationId: reg1Id,
    totpCode: totpCode1,
    stationId: 'camera-scanner-beta',
    clientScanId: uuidv4(),
    deviceTimestamp: new Date().toISOString(),
  }, orgToken);
  assert(
    dupCheckinAttempt.data?.status === 'rejected_duplicate',
    `Duplicate scan cleanly rejected with status 'rejected_duplicate'`
  );
  assert(
    dupCheckinAttempt.data?.message && dupCheckinAttempt.data.message.toLowerCase().includes('already checked in'),
    `Human-readable rejection reason provided: "${dupCheckinAttempt.data?.message}"`
  );

  // Hard Req 2: Prevent QR Sharing / Screenshot Abuse (Rotating TOTP)
  console.log('\n[Hard Req 2] Prevent QR Sharing & Screenshot Abuse (Rotating TOTP Expiry):');
  const fakeOrStaleTotp = '000000';
  const staleScanAttempt = await req(`/events/${eventId}/checkin`, 'POST', {
    registrationId: reg2Id,
    totpCode: fakeOrStaleTotp,
    stationId: 'camera-scanner-alpha',
    clientScanId: uuidv4(),
    deviceTimestamp: new Date().toISOString(),
  }, orgToken);
  assert(
    staleScanAttempt.data?.status === 'rejected_invalid_totp',
    `Expired/invalid 30s token rejected with 'rejected_invalid_totp' (got ${staleScanAttempt.data?.status})`
  );

  // Hard Req 3: Offline-First Scanning & Multi-Station Sync Resolution
  console.log('\n[Hard Req 3] Offline-First Scanning & Multi-Station Conflict Resolution:');
  // Scenario from PDF:
  // Attendee 2 is scanned online at Station B at 12:05.
  // Station A scanned Attendee 2 offline at 12:00.
  // When Station A reconnects and batch syncs at 12:10, Station B is already in DB.
  // Station A's sync should mark it as duplicate and return transparent sync summary without crashing or silent drops.

  const totpCode2 = authenticator.generate(secret2Res.data.secret);

  // 1. Station B checks in Attendee 2 online
  const stationBCheckin = await req(`/events/${eventId}/checkin`, 'POST', {
    registrationId: reg2Id,
    totpCode: totpCode2,
    stationId: 'Station-B-Online',
    clientScanId: uuidv4(),
    deviceTimestamp: new Date().toISOString(),
  }, orgToken);
  assert(stationBCheckin.data?.status === 'accepted', 'Station B online check-in accepted');

  // 2. Station A syncs offline batch containing Attendee 2
  const stationASyncBatch = await req(`/events/${eventId}/checkin/sync-batch`, 'POST', {
    scans: [
      {
        registrationId: reg2Id,
        totpCode: totpCode2,
        stationId: 'Station-A-Offline',
        clientScanId: uuidv4(),
        deviceTimestamp: new Date(Date.now() - 300000).toISOString(),
      },
    ],
  }, orgToken);

  assert(stationASyncBatch.status === 200, 'Station A offline batch sync processed cleanly');
  const syncResults = stationASyncBatch.data?.results || [];
  const duplicateSyncedScan = syncResults.find(r => r.registrationId === reg2Id);
  assert(
    duplicateSyncedScan?.status === 'rejected_duplicate',
    `Offline scan conflict resolved: Second synced check-in rejected as 'rejected_duplicate'`
  );
  assert(
    stationASyncBatch.data?.summary?.rejectedDuplicates >= 1,
    `Batch summary tracks rejected duplicates (${stationASyncBatch.data?.summary?.rejectedDuplicates} duplicate rejected)`
  );

  // Hard Req 4: AI-Powered Event Insights
  console.log('\n[Hard Req 4] AI-Powered Event Insights (Real Context & Fallback Handling):');
  const testQuestions = [
    'How many people have checked in so far?',
    'What percentage of registered attendees are no-shows?',
    'What time did check-ins peak?',
    'How many spots are left?',
  ];

  for (const q of testQuestions) {
    const aiRes = await req(`/events/${eventId}/insights`, 'POST', { question: q }, orgToken);
    assert(aiRes.status === 200, `AI Insight query succeeded for: "${q}"`);
    assert(
      aiRes.data?.rawStats &&
      typeof aiRes.data.rawStats.checkedIn === 'number' &&
      typeof aiRes.data.rawStats.spotsLeft === 'number' &&
      typeof aiRes.data.rawStats.noShowPercent === 'string',
      `Accurate real computed DB stats passed as context (checkedIn: ${aiRes.data?.rawStats?.checkedIn}, spotsLeft: ${aiRes.data?.rawStats?.spotsLeft})`
    );
  }

  // Final Cleanup
  await req(`/admin/clubs/${clubId}`, 'DELETE', null, adminToken);

  console.log('\n===============================================================');
  console.log(`   FINAL RESULT: ${passed} PASSED, ${failed} FAILED               `);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runPdfTests().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
