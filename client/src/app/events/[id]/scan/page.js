'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useNetwork } from '@/context/NetworkContext';
import { apiGet, apiPost } from '@/lib/api';
import {
  ScanIcon, CheckCircleIcon, XCircleIcon, WifiOffIcon,
  LoaderIcon, QrCodeIcon, KeyIcon
} from '@/components/Icons';

export default function ScanPage() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const { isOnline } = useNetwork();
  const router = useRouter();

  const [mode, setMode] = useState(isOnline ? 'online' : 'offline');
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [error, setError] = useState(null);
  const [offlineQueue, setOfflineQueue] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState(null);
  const [knownScannedIdentifiers, setKnownScannedIdentifiers] = useState(new Set());
  const [manualIdentifier, setManualIdentifier] = useState('');
  const [manualTotp, setManualTotp] = useState('');
  const [scanMethod, setScanMethod] = useState('camera'); // 'camera' | 'manual'
  const html5QrRef = useRef(null);
  const stationId = useRef(`station-${Math.random().toString(36).substring(2, 8)}`);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // Automatically adapt mode to network state
  useEffect(() => {
    setMode(isOnline ? 'online' : 'offline');
  }, [isOnline]);

  // Load existing offline queue from IndexedDB and fetch online event roster on startup
  useEffect(() => {
    async function loadData() {
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
            const identifiers = new Set();
            allScans.forEach(s => {
              if (s.registrationId) identifiers.add(s.registrationId.toLowerCase());
            });
            setKnownScannedIdentifiers(prev => new Set([...prev, ...identifiers]));
          }
        }
      } catch (err) {
        console.error('Error loading IndexedDB:', err);
      }

      // Fetch already checked in registrations from server
      try {
        const dashboardData = await apiGet(`/events/${id}/dashboard`);
        if (dashboardData?.registrations) {
          const checkedIn = new Set();
          dashboardData.registrations
            .filter(r => r.checked_in_at)
            .forEach(r => {
              if (r.id) checkedIn.add(r.id.toLowerCase());
              if (r.email) checkedIn.add(r.email.toLowerCase());
              if (r.reg_number) checkedIn.add(r.reg_number.toLowerCase());
            });
          setKnownScannedIdentifiers(prev => new Set([...prev, ...checkedIn]));
        }
      } catch {
        // Continue with local storage if offline
      }
    }

    if (user) {
      loadData();
    }
  }, [id, user]);

  // Query cameras when camera tab is active
  useEffect(() => {
    let active = true;
    async function checkCameras() {
      if (typeof window === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        if (active && videoDevices.length > 0) {
          setCameras(videoDevices.map((d, i) => ({
            id: d.deviceId,
            label: d.label || `Camera ${i + 1}`,
          })));
        }
      } catch {
        // Enumerate might require camera stream first
      }
    }
    checkCameras();
    return () => { active = false; };
  }, [scanMethod]);

  const stopScanning = useCallback(async () => {
    if (html5QrRef.current) {
      try {
        if (html5QrRef.current.isScanning) {
          await html5QrRef.current.stop();
        }
      } catch (err) {
        console.warn('Stop scanning warning:', err);
      }
    }
    setScanning(false);
    setStartingCamera(false);
  }, []);

  const startScanning = useCallback(async () => {
    if (scanning || startingCamera) return;
    setError(null);
    setScanResult(null);
    setStartingCamera(true);

    if (typeof window !== 'undefined' && !navigator.mediaDevices?.getUserMedia) {
      setError('Camera access is not supported on this browser or connection is not secure (requires HTTPS or localhost). Please use Manual Entry.');
      setStartingCamera(false);
      return;
    }

    try {
      const { Html5Qrcode } = await import('html5-qrcode');

      // Stop any prior instance
      if (html5QrRef.current) {
        try {
          if (html5QrRef.current.isScanning) {
            await html5QrRef.current.stop();
          }
        } catch {
          // ignore
        }
      }

      const container = document.getElementById('qr-reader');
      if (!container) {
        throw new Error('Scanner container not ready. Please try again.');
      }

      const qrScanner = new Html5Qrcode('qr-reader');
      html5QrRef.current = qrScanner;

      const qrConfig = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1,
      };

      const scanCallback = (decodedText) => {
        handleScan(decodedText);
      };

      if (selectedCameraId) {
        try {
          await qrScanner.start(selectedCameraId, qrConfig, scanCallback, () => {});
          setScanning(true);
          setStartingCamera(false);
          return;
        } catch (camErr) {
          console.warn('Selected camera start failed, trying ideal environment:', camErr);
        }
      }

      try {
        await qrScanner.start({ facingMode: { ideal: 'environment' } }, qrConfig, scanCallback, () => {});
        setScanning(true);
        setStartingCamera(false);
        return;
      } catch (envErr) {
        console.warn('Environment camera failed, trying user camera:', envErr);
      }

      await qrScanner.start({ facingMode: 'user' }, qrConfig, scanCallback, () => {});
      setScanning(true);
      setStartingCamera(false);

    } catch (err) {
      console.error('Camera launch error:', err);
      setScanning(false);
      setStartingCamera(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Camera permission was blocked. Please tap the camera/lock icon in your browser address bar and choose "Allow".');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setError('No camera was detected on this device. You can use Manual Entry below.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setError('Camera is currently in use by another app or browser tab. Please close other camera tabs and try again.');
      } else {
        setError(err.message || 'Could not start camera. Please use Manual Entry.');
      }
    }
  }, [scanning, startingCamera, selectedCameraId]);

  // Clean up scanner on unmount or tab switch
  useEffect(() => {
    return () => {
      if (html5QrRef.current) {
        try {
          if (html5QrRef.current.isScanning) {
            html5QrRef.current.stop().catch(() => {});
          }
        } catch {
          // ignore
        }
      }
    };
  }, [scanMethod]);

  const handleScan = async (decodedText) => {
    let registrationId = '';
    let totpCode = '';

    const match = decodedText.trim().match(/^REG_([a-zA-Z0-9@._-]+)\.(\d{6})$/i);
    if (match) {
      registrationId = match[1];
      totpCode = match[2];
    } else {
      const dotIndex = decodedText.lastIndexOf('.');
      if (dotIndex > 0) {
        registrationId = decodedText.substring(0, dotIndex).replace(/^REG_/i, '').trim();
        totpCode = decodedText.substring(dotIndex + 1).trim();
      }
    }

    if (!registrationId || !totpCode || !/^\d{6}$/.test(totpCode)) {
      setScanResult({
        status: 'error',
        message: `Invalid QR code payload: "${decodedText.slice(0, 30)}". Format must be REG_<identifier>.<6-digit-auth-code>.`,
      });
      return;
    }

    const clientScanId = crypto.randomUUID();
    const deviceTimestamp = new Date().toISOString();

    if (mode === 'online' && isOnline) {
      try {
        const result = await apiPost(`/events/${id}/checkin`, {
          registrationId,
          totpCode,
          stationId: stationId.current,
          clientScanId,
          deviceTimestamp,
        });

        if (result.status === 'accepted') {
          setKnownScannedIdentifiers(prev => new Set([...prev, registrationId.toLowerCase()]));
        }

        setScanResult(result);
      } catch (err) {
        // If network request failed, fallback to offline queue
        if (!isOnline || err.message.includes('fetch') || err.message.includes('network') || err.message.includes('offline')) {
          queueOfflineScan(registrationId, totpCode, clientScanId, deviceTimestamp);
        } else {
          setScanResult({
            status: 'error',
            message: err.message,
          });
        }
      }
    } else {
      queueOfflineScan(registrationId, totpCode, clientScanId, deviceTimestamp);
    }
  };

  const queueOfflineScan = (registrationId, totpCode, clientScanId, deviceTimestamp) => {
    const isLocalDuplicate = knownScannedIdentifiers.has(registrationId.toLowerCase());

    if (isLocalDuplicate) {
      const existingScan = offlineQueue.find(s => s.registrationId.toLowerCase() === registrationId.toLowerCase());
      const timeStr = existingScan
        ? `(First scanned locally at ${new Date(existingScan.deviceTimestamp).toLocaleTimeString()})`
        : '(Already checked in previously)';

      setScanResult({
        status: 'rejected_duplicate',
        message: `DUPLICATE (Offline): Attendee already scanned! ${timeStr}`,
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

    const scan = {
      registrationId,
      totpCode,
      stationId: stationId.current,
      clientScanId,
      deviceTimestamp,
      syncStatus: 'pending',
      localResult: 'accepted_locally',
    };

    setKnownScannedIdentifiers(prev => new Set([...prev, registrationId.toLowerCase()]));
    setOfflineQueue(prev => [...prev, scan]);
    saveToIndexedDB(scan);

    setScanResult({
      status: 'queued',
      message: `Offline Scan Queued (${totpCode}). Timestamp: ${new Date(deviceTimestamp).toLocaleTimeString()}`,
    });
  };

  const handleManualSubmit = (e) => {
    e.preventDefault();
    let identifier = manualIdentifier.trim();
    let totp = manualTotp.trim().replace(/\s+/g, '');

    if (identifier.startsWith('REG_') && identifier.includes('.')) {
      const match = identifier.match(/^REG_([a-zA-Z0-9@._-]+)\.(\d{6})$/i);
      if (match) {
        identifier = match[1];
        totp = match[2];
      }
    }

    identifier = identifier.replace(/^REG_/i, '');

    if (!identifier) {
      setScanResult({
        status: 'error',
        message: 'Please enter an Email Address, Registration Number, or Ticket ID.',
      });
      return;
    }

    if (!totp || !/^\d{6}$/.test(totp)) {
      setScanResult({
        status: 'error',
        message: 'Please enter the valid 6-digit Auth Code from attendee ticket.',
      });
      return;
    }

    handleScan(`REG_${identifier}.${totp}`);
    setManualTotp('');
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

  const syncOfflineScans = useCallback(async () => {
    const pendingScans = offlineQueue.filter(s => s.syncStatus === 'pending');
    if (pendingScans.length === 0 || syncing) return;

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
  }, [offlineQueue, id, syncing]);

  // Auto-sync pending offline scans when reconnected online
  useEffect(() => {
    if (isOnline && offlineQueue.some(s => s.syncStatus === 'pending') && !syncing) {
      syncOfflineScans();
    }
  }, [isOnline, offlineQueue, syncing, syncOfflineScans]);

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
          <h1>
            <ScanIcon size={28} color="var(--color-primary-400)" />
            {' '}QR Check-In Scanner
          </h1>
          {/* Automatic Connection Status Badge */}
          <span
            className={`badge ${isOnline ? 'badge-success' : 'badge-warning'}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem' }}
          >
            {isOnline ? <CheckCircleIcon size={12} /> : <WifiOffIcon size={12} />}
            {isOnline ? 'Online (Connected)' : 'Offline (Local)'}
          </span>
        </div>
        <p>Scan attendee QR codes or enter auth codes to check in</p>
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

      {error && (
        <div className="alert alert-error">
          {error}
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

      {/* Scan Method Selection Tabs (Camera & Manual Entry) */}
      <div style={{ display: 'flex', gap: 'var(--space-xs)', marginBottom: 'var(--space-md)', background: 'var(--color-bg-secondary)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
        <button
          className="btn btn-sm"
          style={{ flex: 1, background: scanMethod === 'camera' ? 'var(--color-primary-600)' : 'transparent', color: scanMethod === 'camera' ? '#fff' : 'var(--color-text-secondary)' }}
          onClick={() => { setScanMethod('camera'); }}
        >
          <ScanIcon size={14} /> Live Camera Scanner
        </button>
        <button
          className="btn btn-sm"
          style={{ flex: 1, background: scanMethod === 'manual' ? 'var(--color-primary-600)' : 'transparent', color: scanMethod === 'manual' ? '#fff' : 'var(--color-text-secondary)' }}
          onClick={() => { setScanMethod('manual'); stopScanning(); }}
        >
          <KeyIcon size={14} /> Manual Entry (Email / Reg No)
        </button>
      </div>

      {/* Live Camera Viewport */}
      <div style={{ display: scanMethod === 'camera' ? 'block' : 'none' }}>
        {cameras.length > 1 && (
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
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="scanner-viewport">
          <div id="qr-reader" style={{ width: '100%', height: '100%' }} />
        </div>

        <div className="flex gap-sm" style={{ marginTop: 'var(--space-md)' }}>
          {!scanning ? (
            <button
              className="btn btn-primary btn-full btn-lg"
              onClick={startScanning}
              disabled={startingCamera}
            >
              {startingCamera ? (
                <>
                  <LoaderIcon size={18} /> Starting Camera...
                </>
              ) : (
                <>
                  <ScanIcon size={18} /> Start Camera Scan
                </>
              )}
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
      </div>

      {/* Manual Code Input Method */}
      {scanMethod === 'manual' && (
        <form onSubmit={handleManualSubmit} className="card" style={{ padding: 'var(--space-lg)' }}>
          <h3 style={{ marginBottom: 'var(--space-xs)' }}>Manual Check-In</h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' }}>
            Enter the attendee Email Address or Registration Number and their rotating 6-digit Auth Code
          </p>

          <div className="form-group" style={{ marginBottom: 'var(--space-md)' }}>
            <label className="form-label">Attendee Email or Registration Number / ID</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. attendee@example.com or 21BCE1001"
              value={manualIdentifier}
              onChange={(e) => setManualIdentifier(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: 'var(--space-lg)' }}>
            <label className="form-label">6-Digit Auth Code (from Ticket)</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. 183076"
              maxLength={6}
              value={manualTotp}
              onChange={(e) => setManualTotp(e.target.value.replace(/\D/g, ''))}
              style={{ fontSize: '1.3rem', letterSpacing: '3px', fontWeight: 700 }}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            disabled={!manualIdentifier.trim() || !manualTotp.trim()}
          >
            Verify and Check In
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
                  disabled={syncing || !isOnline}
                  title={!isOnline ? 'Will automatically sync when reconnected' : 'Sync pending scans to server'}
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
                  <th>Attendee / Ticket</th>
                  <th>Scan Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {offlineQueue.slice().reverse().map((scan) => (
                  <tr key={scan.clientScanId}>
                    <td style={{ fontFamily: 'monospace' }}>
                      {scan.registrationId}
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
