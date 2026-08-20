'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/api';
import {
  ScanIcon, CheckCircleIcon, XCircleIcon, WifiOffIcon,
  LoaderIcon, QrCodeIcon, UploadIcon, KeyIcon
} from '@/components/Icons';

export default function ScanPage() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState('online');
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [error, setError] = useState(null);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState(null);
  const [knownScannedIds, setKnownScannedIds] = useState(new Set());
  const [manualInput, setManualInput] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [scanMethod, setScanMethod] = useState('camera'); // 'camera' | 'upload' | 'manual'
  const html5QrRef = useRef(null);
  const stationId = useRef(`station-${Math.random().toString(36).substring(2, 8)}`);
  const fileInputRef = useRef(null);

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

  // Enumerate cameras and initialize QR scanner module
  useEffect(() => {
    let isMounted = true;

    async function initScanner() {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');

        if (!isMounted) return;

        // Create scanner instance attached to #qr-reader
        const scanner = new Html5Qrcode('qr-reader');
        html5QrRef.current = scanner;
        setScannerReady(true);

        // Check for cameras
        try {
          const devices = await Html5Qrcode.getCameras();
          if (isMounted && devices && devices.length > 0) {
            setCameras(devices);
            // Default to rear camera if present, or first camera
            const backCamera = devices.find(d =>
              d.label.toLowerCase().includes('back') ||
              d.label.toLowerCase().includes('rear') ||
              d.label.toLowerCase().includes('environment')
            );
            setSelectedCameraId(backCamera ? backCamera.id : devices[0].id);
          }
        } catch {
          // Camera listing might require permission prompt first
        }
      } catch (err) {
        console.error('Failed to load html5-qrcode:', err);
        if (isMounted) {
          setError('Failed to load scanner library. You can still use manual ticket code entry.');
        }
      }
    }

    initScanner();

    return () => {
      isMounted = false;
      if (html5QrRef.current) {
        html5QrRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const startScanning = useCallback(async () => {
    if (!html5QrRef.current || scanning) return;
    setError(null);
    setScanResult(null);

    // Verify browser supports mediaDevices
    if (typeof window !== 'undefined' && !navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not supported on this browser or insecure HTTP connection. Use HTTPS or Manual Entry.');
      return;
    }

    try {
      // 1. Explicitly request camera permissions if not already granted
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: selectedCameraId ? { deviceId: { exact: selectedCameraId } } : { facingMode: { ideal: 'environment' } }
        });
        // Stop stream immediately since Html5Qrcode will manage its own stream
        stream.getTracks().forEach(t => t.stop());

        // Refresh camera list after permission granted
        const { Html5Qrcode } = await import('html5-qrcode');
        const devices = await Html5Qrcode.getCameras();
        if (devices && devices.length > 0) {
          setCameras(devices);
          if (!selectedCameraId) {
            const backCamera = devices.find(d =>
              d.label.toLowerCase().includes('back') ||
              d.label.toLowerCase().includes('rear')
            );
            setSelectedCameraId(backCamera ? backCamera.id : devices[0].id);
          }
        }
      } catch (permErr) {
        console.warn('Initial permission check:', permErr);
      }

      setScanning(true);

      const qrConfig = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1,
      };

      const scanCallback = (decodedText) => {
        handleScan(decodedText);
      };

      // Strategy 1: Use specific cameraId if selected
      if (selectedCameraId) {
        try {
          await html5QrRef.current.start(selectedCameraId, qrConfig, scanCallback, () => {});
          return;
        } catch (camErr) {
          console.warn('Start with cameraId failed, trying fallback:', camErr);
        }
      }

      // Strategy 2: Use ideal environment facingMode
      try {
        await html5QrRef.current.start({ facingMode: { ideal: 'environment' } }, qrConfig, scanCallback, () => {});
        return;
      } catch (envErr) {
        console.warn('Start with facingMode environment failed, trying user facing:', envErr);
      }

      // Strategy 3: Use user facingMode (standard front webcam)
      await html5QrRef.current.start({ facingMode: 'user' }, qrConfig, scanCallback, () => {});

    } catch (err) {
      console.error('Camera start error:', err);
      setScanning(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Camera permission denied. Please click the camera/lock icon in your browser address bar and select "Allow".');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No camera was detected on this device. You can use File Upload or Manual Ticket Entry.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Camera is in use by another application. Please close other camera tabs/apps and try again.');
      } else {
        setError(`Camera error: ${err.message || 'Could not start camera. Try manual entry or file upload.'}`);
      }
    }
  }, [scanning, selectedCameraId]);

  const stopScanning = useCallback(async () => {
    if (!html5QrRef.current) return;
    try {
      if (scanning) {
        await html5QrRef.current.stop();
      }
    } catch (err) {
      console.warn('Stop scanning warning:', err);
    }
    setScanning(false);
  }, [scanning]);

  // Handle uploaded QR image file
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !html5QrRef.current) return;

    setError(null);
    setScanResult(null);

    try {
      const decodedText = await html5QrRef.current.scanFile(file, true);
      handleScan(decodedText);
    } catch (err) {
      setScanResult({
        status: 'error',
        message: 'Could not detect a valid QR code in the uploaded image. Please try another image.',
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleScan = async (decodedText) => {
    // Parse QR payload: REG_<registrationId>.<totpCode>
    const match = decodedText.trim().match(/^REG_([a-f0-9-]+)\.(\d{6})$/i);
    if (!match) {
      setScanResult({
        status: 'error',
        message: `Invalid QR format: "${decodedText.slice(0, 40)}". Must be REG_<id>.<6-digit-code>.`,
      });
      return;
    }

    const [, registrationId, totpCode] = match;
    const clientScanId = crypto.randomUUID();
    const deviceTimestamp = new Date().toISOString();

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
        const existingScan = offlineQueue.find(s => s.registrationId === registrationId);
        const timeStr = existingScan
          ? `(First scanned locally at ${new Date(existingScan.deviceTimestamp).toLocaleTimeString()})`
          : '(Already checked in previously)';

        setScanResult({
          status: 'rejected_duplicate',
          message: `DUPLICATE (Offline): Ticket already scanned! ${timeStr}`,
        });

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

      // First time scanned offline
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

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (!manualInput.trim()) return;
    handleScan(manualInput.trim());
    setManualInput('');
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

      {/* Online / Offline Mode Toggle */}
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

      {error && (
        <div className="alert alert-error" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div>{error}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
            Tip: You can switch to <strong>Upload Image</strong> or <strong>Manual Entry</strong> below if camera permissions are blocked.
          </div>
        </div>
      )}

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

      {/* Scan Method Selection Tabs */}
      <div style={{ display: 'flex', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)', background: 'var(--color-bg-secondary)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
        <button
          className="btn btn-sm"
          style={{ flex: 1, background: scanMethod === 'camera' ? 'var(--color-primary-600)' : 'transparent', color: scanMethod === 'camera' ? '#fff' : 'var(--color-text-secondary)' }}
          onClick={() => { setScanMethod('camera'); stopScanning(); }}
        >
          <ScanIcon size={14} /> Live Camera
        </button>
        <button
          className="btn btn-sm"
          style={{ flex: 1, background: scanMethod === 'upload' ? 'var(--color-primary-600)' : 'transparent', color: scanMethod === 'upload' ? '#fff' : 'var(--color-text-secondary)' }}
          onClick={() => { setScanMethod('upload'); stopScanning(); }}
        >
          <UploadIcon size={14} /> Upload Image
        </button>
        <button
          className="btn btn-sm"
          style={{ flex: 1, background: scanMethod === 'manual' ? 'var(--color-primary-600)' : 'transparent', color: scanMethod === 'manual' ? '#fff' : 'var(--color-text-secondary)' }}
          onClick={() => { setScanMethod('manual'); stopScanning(); }}
        >
          <KeyIcon size={14} /> Manual Entry
        </button>
      </div>

      {/* Camera Selection Dropdown if multiple cameras detected */}
      {scanMethod === 'camera' && cameras.length > 1 && (
        <div className="form-group" style={{ marginBottom: 'var(--space-sm)' }}>
          <label className="form-label" style={{ fontSize: '0.8rem' }}>Select Camera Source</label>
          <select
            className="form-select"
            value={selectedCameraId}
            onChange={(e) => {
              setSelectedCameraId(e.target.value);
              if (scanning) {
                stopScanning().then(startScanning);
              }
            }}
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label || `Camera ${c.id.slice(0, 8)}...`}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Live Camera Viewport */}
      {scanMethod === 'camera' && (
        <>
          <div className="scanner-viewport">
            <div id="qr-reader" style={{ width: '100%', height: '100%' }} />
          </div>

          <div className="flex gap-sm" style={{ marginTop: 'var(--space-md)' }}>
            {!scanning ? (
              <button
                className="btn btn-primary btn-full btn-lg"
                onClick={startScanning}
                disabled={!scannerReady}
              >
                <ScanIcon size={18} />
                Start Camera Scan
              </button>
            ) : (
              <button
                className="btn btn-danger btn-full btn-lg"
                onClick={stopScanning}
              >
                Stop Camera
              </button>
            )}
          </div>
        </>
      )}

      {/* Upload Image Method */}
      {scanMethod === 'upload' && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
          <UploadIcon size={40} color="var(--color-primary-400)" />
          <h3 style={{ marginTop: 'var(--space-md)' }}>Scan from Ticket Image or Photo</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-lg)' }}>
            Upload a screenshot or photo of an attendee ticket QR code
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            id="qr-file-upload"
          />
          <label htmlFor="qr-file-upload" className="btn btn-primary btn-lg" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            <UploadIcon size={18} />
            Choose Photo / Take Picture
          </label>
        </div>
      )}

      {/* Manual Code Input Method */}
      {scanMethod === 'manual' && (
        <form onSubmit={handleManualSubmit} className="card" style={{ padding: 'var(--space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--space-sm)' }}>Manual Ticket Check-In</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' }}>
            Type or paste the full QR payload (e.g. <code>REG_d83e9b11-....123456</code>)
          </p>
          <div className="form-group">
            <input
              type="text"
              className="form-input"
              placeholder="REG_<registration-uuid>.<6-digit-totp>"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary btn-full btn-lg" disabled={!manualInput.trim()}>
            Process Check-In
          </button>
        </form>
      )}

      {/* Offline Outbox & Scans List */}
      {offlineQueue.length > 0 && (
        <div className="offline-queue" style={{ marginTop: 'var(--space-xl)' }}>
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
