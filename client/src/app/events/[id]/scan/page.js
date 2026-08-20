'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiPost } from '@/lib/api';
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
  const scannerRef = useRef(null);
  const html5QrRef = useRef(null);
  const stationId = useRef(`station-${Math.random().toString(36).substring(2, 8)}`);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // Load existing offline queue from IndexedDB on startup
  useEffect(() => {
    async function loadIndexedDB() {
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
          }
        }
      } catch (err) {
        console.error('Error loading IndexedDB:', err);
      }
    }
    loadIndexedDB();
  }, []);

  // Initialize QR scanner
  useEffect(() => {
    let scanner;
    import('html5-qrcode').then(({ Html5Qrcode }) => {
      scanner = new Html5Qrcode('qr-reader');
      html5QrRef.current = scanner;
      setScannerReady(true);
    }).catch((err) => {
      setError('Failed to load camera QR scanner module');
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
      setError('Could not access camera. Please enable camera permissions.');
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
        message: 'Invalid QR code format. Please scan a valid Ivent ticket.',
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
        setScanResult(result);
      } catch (err) {
        setScanResult({
          status: 'error',
          message: err.message,
        });
      }
    } else {
      // Offline mode: queue the scan locally
      const scan = {
        registrationId,
        totpCode,
        stationId: stationId.current,
        clientScanId,
        deviceTimestamp,
        syncStatus: 'pending',
      };

      setOfflineQueue(prev => [...prev, scan]);
      setScanResult({
        status: 'queued',
        message: `Offline Scan Queued (${totpCode}). Timestamp: ${new Date(deviceTimestamp).toLocaleTimeString()}`,
      });

      // Save to IndexedDB
      try {
        if (typeof window !== 'undefined' && 'indexedDB' in window) {
          const { openDB } = await import('idb');
          const db = await openDB('ivent-scanner', 1);
          await db.put('scan_outbox', scan);
        }
      } catch (err) {
        console.error('IndexedDB save error:', err);
      }
    }
  };

  const syncOfflineScans = async () => {
    if (offlineQueue.length === 0) return;
    setSyncing(true);
    try {
      const pendingScans = offlineQueue.filter(s => s.syncStatus === 'pending');
      if (pendingScans.length === 0) {
        setSyncing(false);
        return;
      }

      const result = await apiPost(`/events/${id}/checkin/sync-batch`, { scans: pendingScans });

      // Update in-memory state
      const updatedQueue = offlineQueue.map(scan => {
        const synced = result.results.find(r => r.clientScanId === scan.clientScanId);
        return synced ? { ...scan, syncStatus: 'synced', result: synced.status } : scan;
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
        status: 'sync-complete',
        message: `Batch sync complete: ${pendingScans.length} offline scans recorded on server`,
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

  const getResultIcon = () => {
    if (!scanResult) return null;
    if (scanResult.status === 'accepted') return <CheckCircleIcon size={32} color="var(--color-success)" />;
    if (scanResult.status === 'queued' || scanResult.status === 'sync-complete') return <CheckCircleIcon size={32} color="var(--color-warning)" />;
    return <XCircleIcon size={32} color="var(--color-error)" />;
  };

  const getResultClass = () => {
    if (!scanResult) return '';
    if (scanResult.status === 'accepted') return 'result-accepted';
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
          <strong>Offline Mode Active:</strong> Scans will be stored locally in browser storage (IndexedDB) with timestamps. Click <strong>Sync Now</strong> when internet is restored to submit the batch to the server.
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

      {/* Offline Scans Outbox */}
      {offlineQueue.length > 0 && (
        <div className="offline-queue">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
            <h4>
              <WifiOffIcon size={16} />
              Offline Outbox ({pendingCount} pending, {offlineQueue.length - pendingCount} synced)
            </h4>
            <button
              className="btn btn-primary btn-sm"
              onClick={syncOfflineScans}
              disabled={syncing || pendingCount === 0}
            >
              {syncing ? (
                <>
                  <LoaderIcon size={14} />
                  Syncing to Server...
                </>
              ) : (
                `Sync Now (${pendingCount})`
              )}
            </button>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
            Scans are preserved in IndexedDB even if you close or refresh this browser.
          </p>
        </div>
      )}
    </div>
  );
}
