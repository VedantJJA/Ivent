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

async function getInsight(question, stats) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    return {
      answer: null,
      rawStats: stats,
      note: 'AI insights unavailable: no API key configured. Showing raw stats instead.',
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
    return { answer: completion.choices[0].message.content, rawStats: stats };
  } catch (err) {
    console.error('AI insight error:', err.message);
    return {
      answer: null,
      rawStats: stats,
      note: 'AI request failed or timed out. Showing raw stats instead.',
    };
  }
}

module.exports = { getEventStats, getInsight };
