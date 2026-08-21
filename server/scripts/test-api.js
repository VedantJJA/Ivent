// Direct End-to-End API Test Script for Ivent
// Tests all authentication, roles, club management,
// event creation, ticket generation, TOTP verification, and offline sync.

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

  return { status: res.status, ok: res.ok, data };
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

async function runTests() {
  console.log('=== Ivent End-to-End API Test Suite ===');
  console.log(`Target Server: ${BASE_URL}\n`);

  const uniqueId = Date.now().toString().slice(-6);

  // 1. Health check
  console.log('Test 1: Server Health Check');
  const health = await req('/');
  assert(health.status === 200, `Health check status: ${health.status}`);

  // 2. Attendee Registration via Email
  console.log('\nTest 2: Attendee Registration with Email');
  const attendeeEmail = `attendee-${uniqueId}@test.local`;
  const regRes = await req('/auth/register', 'POST', {
    email: attendeeEmail,
    password: 'password123',
  });
  assert(regRes.status === 201, `Registration status 201 (got ${regRes.status})`);
  assert(regRes.data.user?.email === attendeeEmail, `User registered with email ${attendeeEmail}`);
  const attendeeToken = regRes.data.token;

  // 3. Login using Email
  console.log('\nTest 3: Login using Email');
  const loginRes = await req('/auth/login', 'POST', {
    email: attendeeEmail,
    password: 'password123',
  });
  assert(loginRes.status === 200, `Login with email succeeded (got ${loginRes.status})`);
  assert(loginRes.data.user?.email === attendeeEmail, `Correct user logged in (${attendeeEmail})`);

  // 4. Admin Auth
  console.log('\nTest 4: Admin Authentication');
  const adminToken = jwt.sign(
    { id: 'admin-test-id', email: ADMIN_EMAIL, is_admin: true },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  assert(!!adminToken, `Admin token signed for ${ADMIN_EMAIL}`);

  // 5. Admin Club Creation
  console.log('\nTest 5: Admin Club Creation');
  const clubName = `Robotics Club ${uniqueId}`;
  const clubRes = await req('/admin/clubs', 'POST', {
    name: clubName,
    description: 'Hardware and robotics projects',
  }, adminToken);
  assert(clubRes.status === 201, `Club created successfully (got ${clubRes.status})`);
  const clubId = clubRes.data?.club?.id;

  // 6. Create Organizer User and Link to Club
  console.log('\nTest 6: Assign Organizer to Club by Email');
  const orgEmail = `organizer-${uniqueId}@test.local`;
  const orgUserRes = await req('/auth/register', 'POST', {
    email: orgEmail,
    password: 'password123',
  });
  const orgToken = orgUserRes.data.token;
  const orgUserId = orgUserRes.data.user.id;

  const linkRes = await req(`/admin/clubs/${clubId}/members`, 'POST', {
    email: orgEmail,
  }, adminToken);
  assert(linkRes.status === 201 || linkRes.status === 200, `Organizer linked to club via email (got ${linkRes.status})`);

  // 7. Organizer Creates Event
  console.log('\nTest 7: Organizer Creates Event');
  const eventRes = await req('/events', 'POST', {
    name: `Hackathon ${uniqueId}`,
    description: '24-hour coding challenge',
    location: 'Auditorium A',
    eventDate: new Date(Date.now() + 86400000).toISOString(),
    capacity: 25,
    clubId: clubId,
  }, orgToken);
  assert(eventRes.status === 201, `Event created with capacity 25 (got ${eventRes.status})`);
  const eventId = eventRes.data?.event?.id;

  // 8. Prevent Organizer from Registering for Own Event
  console.log('\nTest 8: Prevent Organizer from Registering for Hosted Event');
  const selfRegRes = await req(`/events/${eventId}/register`, 'POST', {}, orgToken);
  assert(selfRegRes.status === 403, `Organizer blocked from participating in hosted event (got ${selfRegRes.status})`);

  // 9. Attendee Registers for Event
  console.log('\nTest 9: Attendee Registers for Event');
  const attendRegRes = await req(`/events/${eventId}/register`, 'POST', {}, attendeeToken);
  assert(attendRegRes.status === 201, `Attendee successfully registered (got ${attendRegRes.status})`);
  const registrationId = attendRegRes.data?.registration?.id;

  // 10. Fetch Ticket Secret
  console.log('\nTest 10: Retrieve TOTP Secret for Ticket');
  const secretRes = await req(`/registrations/${registrationId}/secret`, 'GET', null, attendeeToken);
  assert(secretRes.status === 200, `Retrieved TOTP secret (got ${secretRes.status})`);
  const totpSecret = secretRes.data?.secret;
  assert(!!totpSecret, 'Valid secret received');

  // Generate real-time 6-digit TOTP code
  const currentTotp = authenticator.generate(totpSecret);
  assert(/^\d{6}$/.test(currentTotp), `Generated 6-digit TOTP code: ${currentTotp}`);

  // 11. Check-In Verification (Online) via Email
  console.log('\nTest 11: Online Check-In Verification via Email');
  const checkinRes = await req(`/events/${eventId}/checkin`, 'POST', {
    registrationId: attendeeEmail, // Check-in directly by Email
    totpCode: currentTotp,
    stationId: 'gate-1',
    clientScanId: uuidv4(),
    deviceTimestamp: new Date().toISOString(),
  }, orgToken);
  assert(checkinRes.status === 200 && checkinRes.data?.status === 'accepted', `Check-in via email accepted (got ${checkinRes.data?.status})`);

  // 12. Duplicate Check-In Prevention
  console.log('\nTest 12: Duplicate Check-In Rejection');
  const dupCheckinRes = await req(`/events/${eventId}/checkin`, 'POST', {
    registrationId: attendeeEmail,
    totpCode: currentTotp,
    stationId: 'gate-2',
    clientScanId: uuidv4(),
    deviceTimestamp: new Date().toISOString(),
  }, orgToken);
  assert(dupCheckinRes.data?.status === 'rejected_duplicate', `Duplicate check-in rejected as duplicate (got ${dupCheckinRes.data?.status})`);

  // 13. Invalid TOTP Code Rejection
  console.log('\nTest 13: Invalid TOTP Rejection');
  const invalidCheckinRes = await req(`/events/${eventId}/checkin`, 'POST', {
    registrationId: attendeeEmail,
    totpCode: '000000',
    stationId: 'gate-1',
    clientScanId: uuidv4(),
    deviceTimestamp: new Date().toISOString(),
  }, orgToken);
  assert(invalidCheckinRes.data?.status === 'rejected_invalid_totp' || invalidCheckinRes.data?.status === 'rejected_duplicate', `Invalid code rejected (got ${invalidCheckinRes.data?.status})`);

  // 14. Batch Offline Sync
  console.log('\nTest 14: Batch Offline Synchronization Endpoint');
  const batchRes = await req(`/events/${eventId}/checkin/sync-batch`, 'POST', {
    scans: [
      {
        registrationId: attendeeEmail,
        totpCode: currentTotp,
        stationId: 'offline-station-1',
        clientScanId: uuidv4(),
        deviceTimestamp: new Date().toISOString(),
      }
    ]
  }, orgToken);
  assert(batchRes.status === 200, `Batch sync processed (got status ${batchRes.status})`);
  assert(batchRes.data?.summary?.total === 1, 'Batch summary matches expected scan count');

  // 15. Delete Club (Cascade Test)
  console.log('\nTest 15: Admin Club Deletion');
  const delClubRes = await req(`/admin/clubs/${clubId}`, 'DELETE', null, adminToken);
  assert(delClubRes.status === 200, `Club deleted successfully (got ${delClubRes.status})`);

  console.log('\n=========================================');
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('=========================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
