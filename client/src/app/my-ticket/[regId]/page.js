'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/api';
import { TicketIcon, ClockIcon, LoaderIcon, CheckCircleIcon, XCircleIcon } from '@/components/Icons';

// RFC 4648 Base32 Decoder
function base32Decode(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (let i = 0; i < base32.length; i++) {
    const val = alphabet.indexOf(base32[i].toUpperCase());
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return new Uint8Array(bytes);
}

// RFC 6238 Standard TOTP (HMAC-SHA1, 30s step, 6 digits) via Browser Web Crypto API
async function computeTotp(secret) {
  const epoch = Math.floor(Date.now() / 1000);
  const step = 30;
  const time = Math.floor(epoch / step);
  const remaining = step - (epoch % step);

  try {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setBigUint64(0, BigInt(time), false);

    const keyBytes = base32Decode(secret);
    const key = await window.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: { name: 'SHA-1' } },
      false,
      ['sign']
    );

    const signature = await window.crypto.subtle.sign('HMAC', key, buffer);
    const digest = new Uint8Array(signature);

    const offset = digest[digest.length - 1] & 0xf;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);

    const otp = binary % 1000000;
    const code = otp.toString().padStart(6, '0');
    return { code, remaining };
  } catch (err) {
    console.error('TOTP calculation error:', err);
    return { code: '000000', remaining };
  }
}

export default function MyTicketPage() {
  const { regId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [secret, setSecret] = useState(null);
  const [ticketMeta, setTicketMeta] = useState(null);
  const [currentCode, setCurrentCode] = useState('------');
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [countdown, setCountdown] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const [eventCancelled, setEventCancelled] = useState(false);
  const intervalRef = useRef(null);
  const qrLibRef = useRef(null);
  const lastCodeRef = useRef('');

  // Redirect if not logged in (only after auth finishes loading)
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // Load QR library dynamically
  useEffect(() => {
    import('qrcode').then((mod) => {
      qrLibRef.current = mod.default || mod;
    });
  }, []);

  // Fetch TOTP secret and ticket details with offline local caching
  useEffect(() => {
    if (!user) return;

    let hasCachedSecret = false;
    try {
      // 1. Check direct ticket cache
      const cached = localStorage.getItem(`ivent_ticket_${regId}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.secret) {
          setSecret(parsed.secret);
          setTicketMeta(parsed.ticketMeta);
          hasCachedSecret = true;
          setLoading(false);
        }
      }

      // 2. Check registrations list cache if not found in direct cache
      if (!hasCachedSecret) {
        const listCached = localStorage.getItem('ivent_cached_my_registrations');
        if (listCached) {
          const list = JSON.parse(listCached);
          const found = list.find((r) => r.id === regId);
          if (found && found.totp_secret) {
            setSecret(found.totp_secret);
            const meta = {
              eventName: found.event_name,
              email: found.email || user.email,
            };
            setTicketMeta(meta);
            hasCachedSecret = true;
            setLoading(false);
          }
        }
      }
    } catch {
      // ignore
    }

    // Attempt live server fetch to ensure latest status
    apiGet(`/registrations/${regId}/secret`)
      .then((data) => {
        if (data.checkedInAt) {
          setCheckedIn(true);
        }
        if (data.secret) {
          setSecret(data.secret);
          const meta = {
            eventName: data.eventName,
            email: data.email,
          };
          setTicketMeta(meta);
          try {
            localStorage.setItem(`ivent_ticket_${regId}`, JSON.stringify({ secret: data.secret, ticketMeta: meta }));
          } catch {
            // ignore
          }
        }
      })
      .catch((err) => {
        if (err.message && err.message.includes('checked')) {
          setCheckedIn(true);
          return;
        }

        // If the event or registration was deleted/cancelled on server
        if (err.message && (err.message.includes('404') || err.message.toLowerCase().includes('not found'))) {
          try {
            localStorage.removeItem(`ivent_ticket_${regId}`);
            const listCached = localStorage.getItem('ivent_cached_my_registrations');
            if (listCached) {
              const list = JSON.parse(listCached).filter((r) => r.id !== regId);
              localStorage.setItem('ivent_cached_my_registrations', JSON.stringify(list));
            }
          } catch {
            // ignore
          }
          setSecret(null);
          setCurrentCode('------');
          setQrDataUrl(null);
          setEventCancelled(true);
          return;
        }

        // Only display error if we don't have a working cached secret
        if (!hasCachedSecret && !secret) {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, [regId, user]);

  // Live periodic check & Socket.io listener to stop QR generation immediately if event is deleted
  useEffect(() => {
    if (!user || !regId || eventCancelled) return;

    let isMounted = true;

    const checkLiveStatus = async () => {
      if (typeof window !== 'undefined' && !navigator.onLine) return; // Ignore if offline

      try {
        const data = await apiGet(`/registrations/${regId}/secret`);
        if (!isMounted) return;
        if (data.checkedInAt) {
          setCheckedIn(true);
        }
      } catch (err) {
        if (!isMounted) return;
        if (err.message && (err.message.includes('404') || err.message.toLowerCase().includes('not found'))) {
          try {
            localStorage.removeItem(`ivent_ticket_${regId}`);
            const listCached = localStorage.getItem('ivent_cached_my_registrations');
            if (listCached) {
              const list = JSON.parse(listCached).filter((r) => r.id !== regId);
              localStorage.setItem('ivent_cached_my_registrations', JSON.stringify(list));
            }
          } catch {
            // ignore
          }
          setSecret(null);
          setCurrentCode('------');
          setQrDataUrl(null);
          setEventCancelled(true);
        }
      }
    };

    const pollTimer = setInterval(checkLiveStatus, 6000);

    let socket = null;
    import('socket.io-client').then(({ io }) => {
      if (!isMounted) return;
      socket = io(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001');

      socket.on('event:deleted', () => {
        if (!isMounted) return;
        try {
          localStorage.removeItem(`ivent_ticket_${regId}`);
          const listCached = localStorage.getItem('ivent_cached_my_registrations');
          if (listCached) {
            const list = JSON.parse(listCached).filter((r) => r.id !== regId);
            localStorage.setItem('ivent_cached_my_registrations', JSON.stringify(list));
          }
        } catch {
          // ignore
        }
        setSecret(null);
        setCurrentCode('------');
        setQrDataUrl(null);
        setEventCancelled(true);
      });
    }).catch(() => {});

    return () => {
      isMounted = false;
      clearInterval(pollTimer);
      if (socket) socket.disconnect();
    };
  }, [user, regId, eventCancelled]);

  // Update QR code and countdown timer every second
  const updateTicket = useCallback(async () => {
    if (!secret || eventCancelled) return;

    const { code, remaining } = await computeTotp(secret);
    setCountdown(remaining);
    setCurrentCode(code);

    if (code !== lastCodeRef.current && qrLibRef.current) {
      lastCodeRef.current = code;
      const qrPayload = `REG_${regId}.${code}`;
      try {
        const dataUrl = await qrLibRef.current.toDataURL(qrPayload, {
          width: 280,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        });
        setQrDataUrl(dataUrl);
      } catch (err) {
        console.error('QR generation error:', err);
      }
    }
  }, [secret, regId, eventCancelled]);

  useEffect(() => {
    if (!secret || eventCancelled) return;

    updateTicket();
    intervalRef.current = setInterval(updateTicket, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [secret, eventCancelled, updateTicket]);

  if (eventCancelled) {
    return (
      <div className="ticket-container">
        <div className="ticket-card" style={{ borderColor: 'rgba(239, 68, 68, 0.4)' }}>
          <XCircleIcon size={48} color="var(--color-error)" />
          <h1 style={{ marginTop: 'var(--space-md)' }}>Event Cancelled or Deleted</h1>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-lg)' }}>
            This event or registration has been removed by the organizers. Dynamic QR code generation has been stopped.
          </p>
          <Link href="/" className="btn btn-primary">
            Browse Active Events
          </Link>
        </div>
      </div>
    );
  }

  if (authLoading || (!user && !secret) || (loading && !secret)) {
    return (
      <div className="loading-container">
        <LoaderIcon size={24} />
        <span>Loading your ticket...</span>
      </div>
    );
  }

  if (checkedIn) {
    return (
      <div className="ticket-container">
        <div className="ticket-card">
          <CheckCircleIcon size={48} color="var(--color-success)" />
          <h1 style={{ marginTop: 'var(--space-md)' }}>Already Checked In</h1>
          <p>You have already been checked in for this event.</p>
        </div>
      </div>
    );
  }

  if (error && !secret) {
    return (
      <div className="ticket-container">
        <div className="ticket-card">
          <div className="alert alert-error">{error}</div>
        </div>
      </div>
    );
  }

  const formatCode = (code) => {
    if (!code || code.length !== 6) return code;
    return `${code.slice(0, 3)} ${code.slice(3)}`;
  };

  const attendeeEmail = ticketMeta?.email || user?.email;

  return (
    <div className="ticket-container">
      <div className="ticket-card">
        <TicketIcon size={32} color="var(--color-primary-400)" />
        <h1>{ticketMeta?.eventName || 'Your Event Ticket'}</h1>
        <p>Show this QR code at the venue entrance for check-in</p>

        {/* Attendee Email Badge */}
        {attendeeEmail && (
          <div style={{ margin: 'var(--space-xs) 0 var(--space-sm)' }}>
            <span className="badge badge-primary" style={{ fontSize: '0.85rem', padding: '4px 12px' }}>
              {attendeeEmail}
            </span>
          </div>
        )}

        {qrDataUrl ? (
          <div className="ticket-qr-wrapper">
            <img src={qrDataUrl} alt="Rotating TOTP QR Code" width={280} height={280} />
          </div>
        ) : (
          <div className="ticket-qr-wrapper" style={{ width: 280, height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LoaderIcon size={32} color="var(--color-text-muted)" />
          </div>
        )}

        {/* Dynamic OTP Code */}
        <div style={{ marginTop: 'var(--space-md)', textAlign: 'center' }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '3px', color: 'var(--color-primary-400)' }}>
            {formatCode(currentCode)}
          </div>
        </div>

        {/* Countdown Progress Bar & Timer */}
        <div className="ticket-countdown" style={{ marginTop: 'var(--space-sm)' }}>
          <ClockIcon size={16} />
          <span>Code refreshes in</span>
          <span className="ticket-countdown-value">{countdown}s</span>
        </div>

        <div style={{ width: '100%', maxWidth: '240px', margin: '8px auto 0', height: '4px', background: 'var(--color-bg-primary)', borderRadius: '2px', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${(countdown / 30) * 100}%`,
              background: countdown <= 5 ? 'var(--color-warning)' : 'var(--color-primary-500)',
              transition: 'width 1s linear',
            }}
          />
        </div>
      </div>
    </div>
  );
}
