// Ivent Concurrency Proof Script
// Tests atomic registration (150+ concurrent against capacity 50)
// and atomic check-in (20+ concurrent against same registration)
// Run against two server instances on ports 3001 and 3002

const BASE_URLS = ['http://localhost:3001', 'http://localhost:3002'];
let requestCounter = 0;

function getBaseUrl() {
  return BASE_URLS[requestCounter++ % BASE_URLS.length];
}

async function makeRequest(path, method, body, token) {
  const url = `${getBaseUrl()}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function run() {
  console.log('=== Ivent Concurrency Proof Script ===\n');

  // Step 1: Create two test users
  console.log('1. Creating test users...');
  const organizer = await makeRequest('/auth/register', 'POST', {
    email: `organizer-${Date.now()}@test.local`,
    password: 'testpass123',
  });
  if (organizer.status !== 201) {
    console.error('Failed to create organizer:', organizer.data);
    return;
  }
  const orgToken = organizer.data.token;
  console.log('   Organizer created');

  // Create test attendee accounts
  const attendeeTokens = [];
  const attendeeCount = 160;
  console.log(`   Creating ${attendeeCount} attendee accounts...`);

  const attendeePromises = [];
  for (let i = 0; i < attendeeCount; i++) {
    attendeePromises.push(
      makeRequest('/auth/register', 'POST', {
        email: `attendee-${Date.now()}-${i}@test.local`,
        password: 'testpass123',
      })
    );
  }
  const attendeeResults = await Promise.all(attendeePromises);
  for (const r of attendeeResults) {
    if (r.status === 201) attendeeTokens.push(r.data.token);
  }
  console.log(`   Created ${attendeeTokens.length} attendee accounts\n`);

  // Step 2: Create an event with capacity 50
  console.log('2. Creating event with capacity 50...');
  const event = await makeRequest('/events', 'POST', {
    name: 'Concurrency Test Event',
    eventDate: new Date(Date.now() + 86400000).toISOString(),
    capacity: 50,
  }, orgToken);

  if (event.status !== 201) {
    console.error('Failed to create event:', event.data);
    return;
  }
  const eventId = event.data.event.id;
  console.log(`   Event created: ${eventId}\n`);

  // Step 3: Fire 150+ concurrent registrations at capacity-50 event
  console.log('3. Firing concurrent registration requests...');
  console.log(`   Sending ${attendeeTokens.length} concurrent POST /events/${eventId}/register`);
  console.log('   Expected: exactly 50 accepted, rest rejected\n');

  const startReg = Date.now();
  const regPromises = attendeeTokens.map((token) =>
    makeRequest(`/events/${eventId}/register`, 'POST', {}, token)
  );
  const regResults = await Promise.all(regPromises);
  const regDuration = Date.now() - startReg;

  const regAccepted = regResults.filter(r => r.status === 201).length;
  const regRejected = regResults.filter(r => r.status === 409).length;
  const regErrors = regResults.filter(r => r.status !== 201 && r.status !== 409).length;

  console.log('   Registration Results:');
  console.log(`   - Accepted: ${regAccepted}`);
  console.log(`   - Rejected (capacity full): ${regRejected}`);
  console.log(`   - Errors: ${regErrors}`);
  console.log(`   - Duration: ${regDuration}ms`);

  // Verify final registered_count
  const verifyEvent = await makeRequest(`/events/${eventId}`, 'GET');
  const finalCount = verifyEvent.data.event.registered_count;
  const capacity = verifyEvent.data.event.capacity;
  console.log(`   - Final registered_count: ${finalCount}`);
  console.log(`   - Capacity: ${capacity}`);
  console.log(`   - PASS: ${regAccepted === 50 && finalCount === 50 ? 'YES' : 'NO'}\n`);

  // Step 4: Get a registration to test check-in concurrency
  console.log('4. Testing concurrent check-in (duplicate prevention)...');

  // Find a successful registration
  const successfulAttendeeIndex = regResults.findIndex(r => r.status === 201);
  if (successfulAttendeeIndex === -1) {
    console.error('No successful registrations found for check-in test');
    return;
  }

  const regId = regResults[successfulAttendeeIndex].data.registration.id;
  const attendeeToken = attendeeTokens[successfulAttendeeIndex];

  // Get TOTP secret
  const secretRes = await makeRequest(`/registrations/${regId}/secret`, 'GET', null, attendeeToken);
  if (secretRes.status !== 200) {
    console.error('Failed to get TOTP secret:', secretRes.data);
    return;
  }

  // Generate a valid TOTP code
  const { authenticator } = require('otplib');
  const totpCode = authenticator.generate(secretRes.data.secret);

  const checkinCount = 25;
  console.log(`   Sending ${checkinCount} concurrent POST /events/${eventId}/checkin`);
  console.log('   Expected: exactly 1 accepted, rest rejected as duplicate\n');

  const startCheckin = Date.now();
  const checkinPromises = [];
  for (let i = 0; i < checkinCount; i++) {
    const { v4: uuidv4 } = require('uuid');
    checkinPromises.push(
      makeRequest(`/events/${eventId}/checkin`, 'POST', {
        registrationId: regId,
        totpCode: totpCode,
        stationId: `station-${i % 2 === 0 ? 'A' : 'B'}`,
        clientScanId: uuidv4(),
        deviceTimestamp: new Date().toISOString(),
      }, orgToken)
    );
  }
  const checkinResults = await Promise.all(checkinPromises);
  const checkinDuration = Date.now() - startCheckin;

  const checkinAccepted = checkinResults.filter(r => r.data.status === 'accepted').length;
  const checkinDuplicate = checkinResults.filter(r => r.data.status === 'rejected_duplicate').length;
  const checkinInvalid = checkinResults.filter(r => r.data.status === 'rejected_invalid_totp').length;
  const checkinErrors = checkinResults.filter(r => r.status >= 500).length;

  console.log('   Check-in Results:');
  console.log(`   - Accepted: ${checkinAccepted}`);
  console.log(`   - Rejected (duplicate): ${checkinDuplicate}`);
  console.log(`   - Rejected (invalid TOTP): ${checkinInvalid}`);
  console.log(`   - Errors: ${checkinErrors}`);
  console.log(`   - Duration: ${checkinDuration}ms`);
  console.log(`   - PASS: ${checkinAccepted === 1 ? 'YES' : 'NO'}\n`);

  // Summary
  console.log('=== Summary ===');
  console.log(`Registration concurrency: ${regAccepted === 50 && finalCount === 50 ? 'PASS' : 'FAIL'}`);
  console.log(`  ${attendeeTokens.length} concurrent requests, ${regAccepted} accepted, capacity ${capacity}, final count ${finalCount}`);
  console.log(`Check-in concurrency: ${checkinAccepted === 1 ? 'PASS' : 'FAIL'}`);
  console.log(`  ${checkinCount} concurrent requests, ${checkinAccepted} accepted, ${checkinDuplicate} duplicates rejected`);
}

run().catch(console.error);
