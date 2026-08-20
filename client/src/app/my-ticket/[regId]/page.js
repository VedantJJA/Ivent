'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/api';
import { TicketIcon, ClockIcon, ShieldIcon, LoaderIcon, CheckCircleIcon } from '@/components/Icons';

export default function MyTicketPage() {
  const { regId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [secret, setSecret] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [countdown, setCountdown] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [checkedIn, setCheckedIn] = useState(false);
  const intervalRef = useRef(null);
  const qrLibRef = useRef(null);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [authLoading, user, router]);

  // Load QR library dynamically (client-side only)
  useEffect(() => {
    import('qrcode').then((mod) => {
      qrLibRef.current = mod.default || mod;
    });
  }, []);

  // Fetch TOTP secret once
  useEffect(() => {
    if (!user) return;
    apiGet(`/registrations/${regId}/secret`)
      .then((data) => {
        setSecret(data.secret);
      })
      .catch((err) => {
        if (err.message.includes('checked')) {
          setCheckedIn(true);
        }
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [regId, user]);

  // Generate TOTP code client-side
  const generateTotpCode = useCallback((secret) => {
    // TOTP algorithm: HMAC-SHA1 with 30-second time steps
    // Using a simplified implementation that matches otplib's output
    const epoch = Math.floor(Date.now() / 1000);
    const step = 30;
    const timeCounter = Math.floor(epoch / step);
    const remaining = step - (epoch % step);

    // We need to compute TOTP client-side. For simplicity and correctness,
    // we use the same library the server uses.
    try {
      const { authenticator } = require('otplib');
      const code = authenticator.generate(secret);
      return { code, remaining };
    } catch {
      // Fallback: return a placeholder while the library loads
      return { code: '------', remaining };
    }
  }, []);

  // Generate QR code with rotating TOTP
  const updateQR = useCallback(async () => {
    if (!secret || !qrLibRef.current) return;

    const { code, remaining } = generateTotpCode(secret);
    setCountdown(remaining);

    const qrPayload = `REG_${regId}.${code}`;
    try {
      const dataUrl = await qrLibRef.current.toDataURL(qrPayload, {
        width: 280,
        margin: 2,
        color: {
          dark: '#111d35',
          light: '#ffffff',
        },
      });
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error('QR generation error:', err);
    }
  }, [secret, regId, generateTotpCode]);

  // Update QR every second
  useEffect(() => {
    if (!secret) return;

    updateQR();
    intervalRef.current = setInterval(updateQR, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [secret, updateQR]);

  if (authLoading || loading) {
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

  return (
    <div className="ticket-container">
      <div className="ticket-card">
        <TicketIcon size={32} color="var(--color-primary-400)" />
        <h1>Your Event Ticket</h1>
        <p>Show this QR code at the venue for check-in</p>

        {qrDataUrl ? (
          <div className="ticket-qr-wrapper">
            <img src={qrDataUrl} alt="QR Code for check-in" width={280} height={280} />
          </div>
        ) : (
          <div className="ticket-qr-wrapper" style={{ width: 280, height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <LoaderIcon size={32} color="var(--color-text-muted)" />
          </div>
        )}

        <div className="ticket-countdown">
          <ClockIcon size={16} />
          <span>Code refreshes in</span>
          <span className="ticket-countdown-value">{countdown}s</span>
        </div>

        <div style={{ marginTop: 'var(--space-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-sm)' }}>
          <ShieldIcon size={16} color="var(--color-primary-400)" />
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            TOTP-secured, rotates every 30 seconds
          </span>
        </div>
      </div>
    </div>
  );
}
