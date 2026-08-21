const db = require('../db');

async function getEventStats(eventId) {
  // Basic counts
  const eventResult = await db.query(
    'SELECT name, capacity, registered_count FROM events WHERE id = $1',
    [eventId]
  );
  if (eventResult.rows.length === 0) return null;

  const event = eventResult.rows[0];

  // Check-in count
  const checkinResult = await db.query(
    'SELECT COUNT(*) as checked_in FROM registrations WHERE event_id = $1 AND checked_in_at IS NOT NULL',
    [eventId]
  );

  const checkedIn = parseInt(checkinResult.rows[0].checked_in, 10);
  const registered = event.registered_count;

  // Peak check-in time (15-min buckets)
  const peakResult = await db.query(
    `SELECT
       date_trunc('hour', checked_in_at) +
       (EXTRACT(minute FROM checked_in_at)::int / 15) * interval '15 min' as bucket,
       COUNT(*) as count
     FROM registrations
     WHERE event_id = $1 AND checked_in_at IS NOT NULL
     GROUP BY bucket
     ORDER BY count DESC
     LIMIT 1`,
    [eventId]
  );

  const stats = {
    eventName: event.name,
    capacity: event.capacity,
    registered: registered,
    spotsLeft: event.capacity - registered,
    checkedIn: checkedIn,
    notCheckedIn: registered - checkedIn,
    noShowPercent: registered > 0 ? ((1 - checkedIn / registered) * 100).toFixed(1) + '%' : 'N/A',
    peakCheckInTime: peakResult.rows[0] ? peakResult.rows[0].bucket : null,
    peakCheckInCount: peakResult.rows[0] ? parseInt(peakResult.rows[0].count, 10) : 0,
  };

  return stats;
}

function computeDeterministicFallback(question, stats) {
  const q = (question || '').toLowerCase();
  if (q.includes('how many people') || q.includes('checked in') || q.includes('so far')) {
    return `So far, ${stats.checkedIn} of ${stats.registered} registered attendee(s) have checked in (${stats.notCheckedIn} pending check-in).`;
  }
  if (q.includes('no-show') || q.includes('percentage') || q.includes('rate')) {
    return `Currently, ${stats.noShowPercent} of registered attendees (${stats.notCheckedIn} attendee(s)) have not yet checked in.`;
  }
  if (q.includes('peak') || q.includes('time')) {
    if (stats.peakCheckInTime && stats.peakCheckInCount > 0) {
      const peakTimeStr = new Date(stats.peakCheckInTime).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      return `Check-ins peaked around ${peakTimeStr} with ${stats.peakCheckInCount} arrival(s) in a 15-minute window.`;
    }
    return 'No check-ins have been recorded yet to determine a peak arrival window.';
  }
  if (q.includes('spots') || q.includes('left') || q.includes('remaining') || q.includes('capacity')) {
    return `There are ${stats.spotsLeft} spot(s) remaining out of total capacity ${stats.capacity} (${stats.registered} registered).`;
  }
  // Generic deterministic fallback
  return `Event Summary: ${stats.checkedIn} checked in, ${stats.notCheckedIn} pending, ${stats.spotsLeft} spots remaining out of capacity ${stats.capacity} (${stats.noShowPercent} no-show rate).`;
}

async function getInsight(question, stats) {
  const fallbackAnswer = computeDeterministicFallback(question, stats);
  const apiKey = process.env.XAI_API_KEY;

  if (!apiKey) {
    return {
      answer: fallbackAnswer,
      rawStats: stats,
      isFallback: true,
      note: 'Deterministic SQL Fallback: AI API key not configured.',
    };
  }

  try {
    const OpenAI = require('openai');
    const grok = new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://api.x.ai/v1',
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const completion = await grok.chat.completions.create(
      {
        model: 'grok-3',
        messages: [
          {
            role: 'system',
            content:
              'You are answering questions about a live event\'s check-in data. ' +
              'Use ONLY the JSON stats provided below. Never invent, estimate, or ' +
              'recompute a number that is not already in this data.\n\n' +
              JSON.stringify(stats),
          },
          { role: 'user', content: question },
        ],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);
    return { answer: completion.choices[0].message.content, rawStats: stats, isFallback: false };
  } catch (err) {
    console.error('AI insight error:', err.message);
    return {
      answer: fallbackAnswer,
      rawStats: stats,
      isFallback: true,
      note: 'Deterministic SQL Fallback: AI request timed out or unavailable.',
    };
  }
}

module.exports = { getEventStats, getInsight };
