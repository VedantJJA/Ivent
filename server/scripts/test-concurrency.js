// Direct Concurrency Load Test Script for Ivent
// Proves zero overselling under race conditions (100+ concurrent requests against capacity 30)
// and duplicate check-in prevention (20+ concurrent scans on same ticket)

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

  return { status: res.status, ok: res.ok, data: await res.json().catch(() => ({})) };
}

async function runConcurrencyTest() {
  console.log('=== Ivent Concurrency & Race-Condition Test ===');
  console.log(`Target: ${BASE_URL}\n`);

  const uniqueId = Date.now().toString().slice(-6);

  // 1. Setup Admin and Club
  console.log('1. Setting up admin, club, and organizer...');
  const adminToken = jwt.sign(
    { id: 'admin-test-id', email: ADMIN_EMAIL, is_admin: true },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const clubRes = await req('/admin/clubs', 'POST', { name: `Concurrency Club ${uniqueId}` }, adminToken);
  const clubId = clubRes.data?.club?.id;

  const orgRes = await req('/auth/register', 'POST', { email: `org-${uniqueId}@test.local`, password: 'password123' });
  const orgToken = orgRes.data?.token;
  const orgUserId = orgRes.data?.user?.id;

  await req(`/admin/clubs/${clubId}/members`, 'POST', { userId: orgUserId }, adminToken);

  // 2. Create Event with Capacity 30
  const capacity = 30;
  console.log(`2. Creating event with capacity ${capacity}...`);
  const eventRes = await req('/events', 'POST', {
    name: `Concurrency Event ${uniqueId}`,
    eventDate: new Date(Date.now() + 86400000).toISOString(),
    capacity,
    clubId,
  }, orgToken);

  const eventId = eventRes.data?.event?.id;
  console.log(`   Created event ID: ${eventId}\n`);

  // 3. Create 100 Unique Attendees
  const totalAttendees = 100;
  console.log(`3. Generating ${totalAttendees} test attendee accounts...`);
  const attendeeTokens = [];
  const createPromises = [];

  for (let i = 0; i < totalAttendees; i++) {
    createPromises.push(
      req('/auth/register', 'POST', {
        email: `racer-${uniqueId}-${i}@test.local`,
        password: 'password123',
        regNumber: `RACER-${uniqueId}-${i}`,
      })
    );
  }

  const createdAttendees = await Promise.all(createPromises);
  for (const a of createdAttendees) {
    if (a.status === 201) attendeeTokens.push(a.data.token);
  }
  console.log(`   Successfully prepared ${attendeeTokens.length} attendees.\n`);

  // 4. Fire 100 Simultaneous Concurrent Registrations
  console.log(`4. Firing ${attendeeTokens.length} concurrent registration requests simultaneously...`);
  const startTime = Date.now();
  const regPromises = attendeeTokens.map((token) =>
    req(`/events/${eventId}/register`, 'POST', {}, token)
  );

  const regResults = await Promise.all(regPromises);
  const duration = Date.now() - startTime;

  const accepted = regResults.filter(r => r.status === 201);
  const rejected = regResults.filter(r => r.status === 409);
  const errors = regResults.filter(r => r.status !== 201 && r.status !== 409);

  console.log(`   Execution Time: ${duration}ms`);
  console.log(`   - Accepted Registrations: ${accepted.length} (Expected: ${capacity})`);
  console.log(`   - Rejected (Sold Out):   ${rejected.length} (Expected: ${attendeeTokens.length - capacity})`);
  console.log(`   - Server Errors:         ${errors.length} (Expected: 0)`);

  const eventCheck = await req(`/events/${eventId}`);
  const finalCount = eventCheck.data.event.registered_count;
  console.log(`   - Database Registered Count: ${finalCount} / ${capacity}`);

  const regPassed = accepted.length === capacity && finalCount === capacity && errors.length === 0;
  console.log(`   -> Registration Concurrency Test: ${regPassed ? 'PASSED' : 'FAILED'}\n`);

  // 5. Test Check-In Concurrency on the Same Ticket
  console.log('5. Testing concurrent check-in on the same ticket...');
  const firstReg = accepted[0].data.registration;
  const firstAttendeeToken = attendeeTokens[0];

  const secretRes = await req(`/registrations/${firstReg.id}/secret`, 'GET', null, firstAttendeeToken);
  const totpCode = authenticator.generate(secretRes.data.secret);

  const concurrentCheckins = 20;
  console.log(`   Sending ${concurrentCheckins} simultaneous check-in scans for ticket ${firstReg.id}...`);

  const checkinStart = Date.now();
  const checkinPromises = [];
  for (let i = 0; i < concurrentCheckins; i++) {
    checkinPromises.push(
      req(`/events/${eventId}/checkin`, 'POST', {
        registrationId: firstReg.id,
        totpCode: totpCode,
        stationId: `station-${i}`,
        clientScanId: uuidv4(),
        deviceTimestamp: new Date().toISOString(),
      }, orgToken)
    );
  }

  const checkinResults = await Promise.all(checkinPromises);
  const checkinDuration = Date.now() - checkinStart;

  const checkinAccepted = checkinResults.filter(r => r.data.status === 'accepted').length;
  const checkinDuplicates = checkinResults.filter(r => r.data.status === 'rejected_duplicate').length;

  console.log(`   Execution Time: ${checkinDuration}ms`);
  console.log(`   - Accepted:           ${checkinAccepted} (Expected: exactly 1)`);
  console.log(`   - Rejected Duplicate: ${checkinDuplicates} (Expected: ${concurrentCheckins - 1})`);

  const checkinPassed = checkinAccepted === 1 && checkinDuplicates === (concurrentCheckins - 1);
  console.log(`   -> Check-In Concurrency Test: ${checkinPassed ? 'PASSED' : 'FAILED'}\n`);

  console.log('==============================================');
  console.log(`Overall Result: ${regPassed && checkinPassed ? 'ALL TESTS PASSED' : 'TESTS FAILED'}`);
  console.log('==============================================');

  if (!regPassed || !checkinPassed) {
    process.exit(1);
  }
}

runConcurrencyTest().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
