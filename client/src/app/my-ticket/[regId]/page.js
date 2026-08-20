'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/api';
import { TicketIcon, ClockIcon, ShieldIcon, LoaderIcon, CheckCircleIcon } from '@/components/Icons';

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
  const intervalRef = useRef(null);
  const qrLibRef = useRef(null);
  const lastCodeRef = useRef('');

  // Redirect if not logged in
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

  // Fetch TOTP secret and ticket details
  useEffect(() => {
    if (!user) return;
    apiGet(`/registrations/${regId}/secret`)
      .then((data) => {
        setSecret(data.secret);
        setTicketMeta({
          eventName: data.eventName,
          email: data.email,
          regNumber: data.regNumber,
        });
      })
      .catch((err) => {
        if (err.message.includes('checked')) {
          setCheckedIn(true);
        }
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [regId, user]);

  // Update QR code and countdown timer every second
  const updateTicket = useCallback(async () => {
    if (!secret) return;

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
  }, [secret, regId]);

  useEffect(() => {
    if (!secret) return;

    updateTicket();
    intervalRef.current = setInterval(updateTicket, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [secret, updateTicket]);

  if (authLoading || !user || loading) {
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

  if (error) {
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

  const regNumToDisplay = ticketMeta?.regNumber || user?.reg_number;

  return (
    <div className="ticket-container">
      <div className="ticket-card">
        <TicketIcon size={32} color="var(--color-primary-400)" />
        <h1>{ticketMeta?.eventName || 'Your Event Ticket'}</h1>
        <p>Show this rotating QR code at the venue entrance for check-in</p>

        {/* Registration Number / Attendee Badge */}
        {regNumToDisplay && (
          <div style={{ margin: 'var(--space-xs) 0 var(--space-sm)' }}>
            <span className="badge badge-primary" style={{ fontSize: '0.85rem', padding: '4px 12px' }}>
              Reg No: {regNumToDisplay}
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

        <div style={{ marginTop: 'var(--space-md)', fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
          Ticket ID: {regId}
        </div>
      </div>
    </div>
  );
}
