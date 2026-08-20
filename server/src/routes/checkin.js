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
      totpCode,
      stationId,
      clientScanId,
      deviceTimestamp: deviceTimestamp || new Date().toISOString(),
      io,
    });

    if (result.status === 'not_found') {
      return res.status(404).json({ error: 'Registration not found' });
    }

    res.json(result);
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /events/:id/checkin/sync-batch -- batch sync offline scans
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
        const result = await syncOfflineScan(scan, io);
        results.push({ clientScanId: scan.clientScanId, ...result });
      } catch (err) {
        results.push({ clientScanId: scan.clientScanId, status: 'error', message: err.message });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error('Batch sync error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
