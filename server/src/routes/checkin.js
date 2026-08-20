const express = require('express');
const { requireAuth, requireOrganizer } = require('../middleware/auth');
const { checkIn, syncOfflineScan } = require('../services/checkin');

const router = express.Router();

// POST /events/:id/checkin -- online check-in (organizer scans attendee QR)
router.post('/:id/checkin', requireAuth, requireOrganizer, async (req, res) => {
  try {
    const { registrationId, totpCode, stationId, clientScanId, deviceTimestamp } = req.body;

    if (!registrationId || !totpCode || !stationId || !clientScanId) {
      return res.status(400).json({ error: 'Missing required check-in fields' });
    }

    const io = req.app.get('io');
    const result = await checkIn({
      registrationId,
      eventId: req.params.id,
      totpCode,
      stationId,
      clientScanId,
      deviceTimestamp: deviceTimestamp || new Date().toISOString(),
      io,
    });

    if (result.status === 'not_found') {
      return res.status(404).json({ error: 'Registration not found for this event' });
    }

    res.json(result);
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /events/:id/checkin/sync-batch -- batch sync offline scans with summary
router.post('/:id/checkin/sync-batch', requireAuth, requireOrganizer, async (req, res) => {
  try {
    const { scans } = req.body;
    if (!Array.isArray(scans) || scans.length === 0) {
      return res.status(400).json({ error: 'Scans array is required' });
    }

    const io = req.app.get('io');
    const results = [];

    for (const scan of scans) {
      try {
        const result = await syncOfflineScan({ ...scan, eventId: req.params.id }, io);
        results.push({ clientScanId: scan.clientScanId, registrationId: scan.registrationId, ...result });
      } catch (err) {
        results.push({ clientScanId: scan.clientScanId, registrationId: scan.registrationId, status: 'error', message: err.message });
      }
    }

    const acceptedCount = results.filter(r => r.status === 'accepted').length;
    const duplicateCount = results.filter(r => r.status === 'rejected_duplicate').length;
    const invalidCount = results.filter(r => r.status === 'rejected_invalid_totp').length;
    const errorCount = results.filter(r => r.status !== 'accepted' && r.status !== 'rejected_duplicate' && r.status !== 'rejected_invalid_totp').length;
    const rejectedCount = results.length - acceptedCount;

    res.json({
      summary: {
        total: results.length,
        accepted: acceptedCount,
        rejected: rejectedCount,
        rejectedDuplicates: duplicateCount,
        rejectedInvalid: invalidCount,
        errors: errorCount,
      },
      results,
    });
  } catch (err) {
    console.error('Batch sync error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
