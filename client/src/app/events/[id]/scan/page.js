'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/api';
import {
  ScanIcon, CheckCircleIcon, XCircleIcon, WifiOffIcon,
  LoaderIcon, QrCodeIcon
} from '@/components/Icons';

export default function ScanPage() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState('online');
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [error, setError] = useState(null);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState(null);
  const [knownScannedIds, setKnownScannedIds] = useState(new Set());
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);
  const stationId = useRef(`station-${Math.random().toString(36).substring(2, 8)}`);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // Load existing offline queue from IndexedDB and fetch online event roster on startup
  useEffect(() => {
    async function loadData() {
      // 1. Load IndexedDB cached scans
      try {
        if (typeof window !== 'undefined' && 'indexedDB' in window) {
          const { openDB } = await import('idb');
          const db = await openDB('ivent-scanner', 1, {
            upgrade(db) {
              if (!db.objectStoreNames.contains('scan_outbox')) {
                const store = db.createObjectStore('scan_outbox', { keyPath: 'clientScanId' });
                store.createIndex('syncStatus', 'syncStatus');
              }
            },
          });
          const allScans = await db.getAll('scan_outbox');
          if (allScans && allScans.length > 0) {
            setOfflineQueue(allScans);
            const scannedIds = new Set(allScans.map(s => s.registrationId));
            setKnownScannedIds(prev => new Set([...prev, ...scannedIds]));
          }
        }
      } catch (err) {
        console.error('Error loading IndexedDB:', err);
      }

      // 2. Fetch already checked in registrations from server to detect online check-ins locally
      try {
        const dashboardData = await apiGet(`/events/${id}/dashboard`);
        if (dashboardData?.registrations) {
          const checkedIn = dashboardData.registrations
            .filter(r => r.checked_in_at)
            .map(r => r.id);
          setKnownScannedIds(prev => new Set([...prev, ...checkedIn]));
        }
      } catch {
        // May be offline initially, continue with local storage
      }
    }

    if (user) {
      loadData();
    }
  }, [id, user]);

  // Initialize QR scanner
  useEffect(() => {
    let scanner;
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      scanner = new Html5Qrcode('qr-reader');
      html5QrRef.current = scanner;
      setScannerReady(true);
    }).catch(() => {
      setError('Failed to initialize camera scanner module');
    });

    return () => {
      if (scanner) {
        scanner.stop().catch(() => {});
      }
    };
  }, []);

  const startScanning = useCallback(async () => {
    if (!html5QrRef.current || scanning) return;
    setScanning(true);
    setScanResult(null);

    try {
      await html5QrRef.current.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          handleScan(decodedText);
        },
        () => {} // Ignore scan partial frames
      );
    } catch (err) {
      setError('Could not access camera. Please enable camera permissions in browser settings.');
      setScanning(false);
    }
  }, [scanning]);

  const stopScanning = useCallback(async () => {
    if (!html5QrRef.current) return;
    try {
      await html5QrRef.current.stop();
    } catch {
      // Scanner was not active
    }
    setScanning(false);
  }, []);

  const handleScan = async (decodedText) => {
    // Parse QR payload: REG_<registrationId>.<totpCode>
    const match = decodedText.match(/^REG_([a-f0-9-]+)\.(\d{6})$/);
    if (!match) {
      setScanResult({
        status: 'error',
        message: 'Invalid QR code format. Please scan a valid Ivent attendee ticket.',
      });
      return;
    }

    const [, registrationId, totpCode] = match;
    const clientScanId = crypto.randomUUID();
    const deviceTimestamp = new Date().toISOString();

    // Stop scanning while processing
    await stopScanning();

    if (mode === 'online') {
      try {
        const result = await apiPost(`/events/${id}/checkin`, {
          registrationId,
          totpCode,
          stationId: stationId.current,
          clientScanId,
          deviceTimestamp,
        });

        if (result.status === 'accepted') {
          setKnownScannedIds(prev => new Set([...prev, registrationId]));
        }

        setScanResult(result);
      } catch (err) {
        setScanResult({
          status: 'error',
          message: err.message,
        });
      }
    } else {
      // Offline mode: Check for duplicate scan locally first
      const isLocalDuplicate = knownScannedIds.has(registrationId);

      if (isLocalDuplicate) {
        // Find existing scan time if available
        const existingScan = offlineQueue.find(s => s.registrationId === registrationId);
        const timeStr = existingScan
          ? `(First scanned locally at ${new Date(existingScan.deviceTimestamp).toLocaleTimeString()})`
          : '(Already checked in previously)';

        setScanResult({
          status: 'rejected_duplicate',
          message: `DUPLICATE (Offline): Ticket already scanned! ${timeStr}`,
        });

        // Record the rejected duplicate in outbox for audit log
        const duplicateScan = {
          registrationId,
          totpCode,
          stationId: stationId.current,
          clientScanId,
          deviceTimestamp,
          syncStatus: 'pending',
          localResult: 'rejected_duplicate',
        };

        setOfflineQueue(prev => [...prev, duplicateScan]);
        saveToIndexedDB(duplicateScan);
        return;
      }

      // First time scanned offline: Queue the scan
      const scan = {
        registrationId,
        totpCode,
        stationId: stationId.current,
        clientScanId,
        deviceTimestamp,
        syncStatus: 'pending',
        localResult: 'accepted_locally',
      };

      setKnownScannedIds(prev => new Set([...prev, registrationId]));
      setOfflineQueue(prev => [...prev, scan]);
      saveToIndexedDB(scan);

      setScanResult({
        status: 'queued',
        message: `Offline Scan Queued (${totpCode}). Timestamp: ${new Date(deviceTimestamp).toLocaleTimeString()}`,
      });
    }
  };

  const saveToIndexedDB = async (scan) => {
    try {
      if (typeof window !== 'undefined' && 'indexedDB' in window) {
        const { openDB } = await import('idb');
        const db = await openDB('ivent-scanner', 1);
        await db.put('scan_outbox', scan);
      }
    } catch (err) {
      console.error('IndexedDB save error:', err);
    }
  };

  const syncOfflineScans = async () => {
    const pendingScans = offlineQueue.filter(s => s.syncStatus === 'pending');
    if (pendingScans.length === 0) return;

    setSyncing(true);
    setSyncSummary(null);

    try {
      const response = await apiPost(`/events/${id}/checkin/sync-batch`, { scans: pendingScans });
      const summary = response.summary || {
        total: pendingScans.length,
        accepted: response.results?.filter(r => r.status === 'accepted').length || 0,
        rejected: (response.results?.length || 0) - (response.results?.filter(r => r.status === 'accepted').length || 0),
        rejectedDuplicates: response.results?.filter(r => r.status === 'rejected_duplicate').length || 0,
        rejectedInvalid: response.results?.filter(r => r.status === 'rejected_invalid_totp').length || 0,
      };

      setSyncSummary(summary);

      // Update scan queue statuses
      const updatedQueue = offlineQueue.map(scan => {
        const serverResult = response.results?.find(r => r.clientScanId === scan.clientScanId);
        if (serverResult) {
          return {
            ...scan,
            syncStatus: 'synced',
            serverStatus: serverResult.status,
            serverMessage: serverResult.status === 'accepted' ? 'Accepted by Server' : `Rejected: ${serverResult.status}`,
          };
        }
        return scan;
      });

      setOfflineQueue(updatedQueue);

      // Update IndexedDB
      try {
        if (typeof window !== 'undefined' && 'indexedDB' in window) {
          const { openDB } = await import('idb');
          const db = await openDB('ivent-scanner', 1);
          for (const scan of updatedQueue) {
            await db.put('scan_outbox', scan);
          }
        }
      } catch (err) {
        console.error('IndexedDB update error:', err);
      }

      setScanResult({
        status: summary.rejected > 0 ? 'sync-partial' : 'sync-complete',
        message: `Sync Complete: ${summary.accepted} Accepted, ${summary.rejected} Rejected (${summary.rejectedDuplicates} Duplicates, ${summary.rejectedInvalid} Invalid Code)`,
      });
    } catch (err) {
      setScanResult({
        status: 'error',
        message: `Batch sync failed: ${err.message}`,
      });
    } finally {
      setSyncing(false);
    }
  };

  const clearSyncedScans = async () => {
    const remaining = offlineQueue.filter(s => s.syncStatus === 'pending');
    setOfflineQueue(remaining);
    setSyncSummary(null);

    try {
      if (typeof window !== 'undefined' && 'indexedDB' in window) {
        const { openDB } = await import('idb');
        const db = await openDB('ivent-scanner', 1);
        await db.clear('scan_outbox');
        for (const scan of remaining) {
          await db.put('scan_outbox', scan);
        }
      }
    } catch (err) {
      console.error('IndexedDB clear error:', err);
    }
  };

  const getResultIcon = () => {
    if (!scanResult) return null;
    if (scanResult.status === 'accepted' || scanResult.status === 'sync-complete') {
      return <CheckCircleIcon size={32} color="var(--color-success)" />;
    }
    if (scanResult.status === 'queued' || scanResult.status === 'sync-partial') {
      return <CheckCircleIcon size={32} color="var(--color-warning)" />;
    }
    return <XCircleIcon size={32} color="var(--color-error)" />;
  };

  const getResultClass = () => {
    if (!scanResult) return '';
    if (scanResult.status === 'accepted' || scanResult.status === 'sync-complete') return 'result-accepted';
    return 'result-rejected';
  };

  if (authLoading) {
    return (
      <div className="loading-container">
        <LoaderIcon size={24} />
      </div>
    );
  }

  const pendingCount = offlineQueue.filter(s => s.syncStatus === 'pending').length;
  const syncedCount = offlineQueue.filter(s => s.syncStatus === 'synced').length;

  return (
    <div className="scanner-container">
      <div className="page-header">
        <h1>
          <ScanIcon size={28} color="var(--color-primary-400)" />
          {' '}QR Check-In Scanner
        </h1>
        <p>Scan attendee QR codes to check them into this event</p>
      </div>

      {/* Mode Toggle */}
      <div className="scanner-mode-toggle">
        <button
          className={`scanner-mode-btn ${mode === 'online' ? 'active' : ''}`}
          onClick={() => setMode('online')}
        >
          <QrCodeIcon size={16} />
          Online Mode
        </button>
        <button
          className={`scanner-mode-btn ${mode === 'offline' ? 'active' : ''}`}
          onClick={() => setMode('offline')}
        >
          <WifiOffIcon size={16} />
          Offline Mode {pendingCount > 0 && `(${pendingCount})`}
        </button>
      </div>

      {mode === 'offline' && (
        <div className="alert alert-warning" style={{ fontSize: '0.85rem' }}>
          <strong>Offline Mode Active:</strong> Scans are checked locally for duplicates and stored in IndexedDB. Click <strong>Sync Now</strong> when internet is restored to submit to the server.
        </div>
      )}

      {error && <div className="alert alert-error">{error}</div>}

      {/* Scan Result Notification */}
      {scanResult && (
        <div className={`scanner-result ${getResultClass()}`}>
          {getResultIcon()}
          <div>
            <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>
              {scanResult.status.replace(/_/g, ' ').replace(/-/g, ' ')}
            </div>
            {scanResult.message && (
              <div style={{ fontSize: '0.85rem', opacity: 0.85 }}>{scanResult.message}</div>
            )}
          </div>
        </div>
      )}

      {/* Sync Summary Notification Banner */}
      {syncSummary && (
        <div className="card" style={{ marginBottom: 'var(--space-md)', borderColor: syncSummary.rejected > 0 ? 'var(--color-warning)' : 'var(--color-success)' }}>
          <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>
            Batch Synchronization Summary
          </h3>
          <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
            <span className="badge badge-muted">Total: {syncSummary.total}</span>
            <span className="badge badge-success">Accepted: {syncSummary.accepted}</span>
            <span className="badge badge-error">Rejected: {syncSummary.rejected}</span>
            {syncSummary.rejectedDuplicates > 0 && (
              <span className="badge badge-warning">{syncSummary.rejectedDuplicates} Duplicates</span>
            )}
            {syncSummary.rejectedInvalid > 0 && (
              <span className="badge badge-error">{syncSummary.rejectedInvalid} Invalid Code</span>
            )}
          </div>
        </div>
      )}

      {/* Scanner Camera Viewport */}
      <div className="scanner-viewport">
        <div id="qr-reader" style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Controls */}
      <div className="flex gap-sm">
        {!scanning ? (
          <button
            className="btn btn-primary btn-full btn-lg"
            onClick={startScanning}
            disabled={!scannerReady}
          >
            <ScanIcon size={18} />
            Start Scanning
          </button>
        ) : (
          <button
            className="btn btn-danger btn-full btn-lg"
            onClick={stopScanning}
          >
            Stop Scanning
          </button>
        )}
      </div>

      {/* Offline Outbox & Scans List */}
      {offlineQueue.length > 0 && (
        <div className="offline-queue">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <h4>
              <WifiOffIcon size={16} />
              Offline Outbox ({pendingCount} pending, {syncedCount} synced)
            </h4>
            <div style={{ display: 'flex', gap: 'var(--space-xs)' }}>
              {pendingCount > 0 && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={syncOfflineScans}
                  disabled={syncing}
                >
                  {syncing ? (
                    <>
                      <LoaderIcon size={14} />
                      Syncing...
                    </>
                  ) : (
                    `Sync Now (${pendingCount})`
                  )}
                </button>
              )}
              {syncedCount > 0 && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={clearSyncedScans}
                  title="Remove synced items from local list"
                >
                  Clear Synced
                </button>
              )}
            </div>
          </div>

          <div className="table-container" style={{ marginTop: 'var(--space-sm)' }}>
            <table className="table" style={{ fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Scan Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {offlineQueue.slice().reverse().map((scan) => (
                  <tr key={scan.clientScanId}>
                    <td style={{ fontFamily: 'monospace' }}>
                      {scan.registrationId.slice(0, 8)}...
                    </td>
                    <td>{new Date(scan.deviceTimestamp).toLocaleTimeString()}</td>
                    <td>
                      {scan.syncStatus === 'pending' ? (
                        scan.localResult === 'rejected_duplicate' ? (
                          <span className="badge badge-error">Offline Duplicate</span>
                        ) : (
                          <span className="badge badge-warning">Pending Sync</span>
                        )
                      ) : scan.serverStatus === 'accepted' ? (
                        <span className="badge badge-success">Accepted</span>
                      ) : scan.serverStatus === 'rejected_duplicate' ? (
                        <span className="badge badge-error">Rejected: Duplicate</span>
                      ) : scan.serverStatus === 'rejected_invalid_totp' ? (
                        <span className="badge badge-error">Rejected: Invalid Code</span>
                      ) : (
                        <span className="badge badge-muted">{scan.serverStatus || 'Synced'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
