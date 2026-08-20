'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/api';
import { TicketIcon, CalendarIcon, LoaderIcon, QrCodeIcon } from '@/components/Icons';

export default function MyRegistrationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
    if (user) {
      // Load from local storage cache first
      try {
        const cached = localStorage.getItem('ivent_cached_my_registrations');
        if (cached) {
          setRegistrations(JSON.parse(cached));
          setLoading(false);
        }
      } catch {
        // ignore
      }

      apiGet('/registrations/my')
        .then((data) => {
          setRegistrations(data.registrations || []);
          try {
            localStorage.setItem('ivent_cached_my_registrations', JSON.stringify(data.registrations || []));
          } catch {
            // ignore
          }
        })
        .catch((err) => {
          const cached = localStorage.getItem('ivent_cached_my_registrations');
          if (!cached) {
            setError(err.message);
          }
        })
        .finally(() => setLoading(false));
    }
  }, [user, authLoading, router]);

  if (authLoading || loading) {
    return (
      <div className="loading-container">
        <LoaderIcon size={24} />
        <span>Loading your registrations...</span>
      </div>
    );
  }

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>My Tickets</h1>
        <p>Your event registrations and QR tickets</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {registrations.length === 0 ? (
        <div className="empty-state">
          <TicketIcon size={48} color="var(--color-text-muted)" />
          <h3>No Registrations Yet</h3>
          <p>Browse events and register to see your tickets here.</p>
          <Link href="/" className="btn btn-primary">
            <CalendarIcon size={18} />
            Browse Events
          </Link>
        </div>
      ) : (
        <div className="registrations-list">
          {registrations.map((reg, i) => (
            <div
              key={reg.id}
              className="registration-card"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <div className="registration-card-info">
                <h3>{reg.event_name}</h3>
                <p>
                  <CalendarIcon size={14} color="var(--color-text-muted)" />
                  {' '}{formatDate(reg.event_date)}
                  {' | '}
                  {reg.registered_count} / {reg.capacity} registered
                </p>
              </div>
              <div className="registration-card-actions">
                {reg.checked_in_at ? (
                  <span className="badge badge-success">Checked In</span>
                ) : (
                  <Link href={`/my-ticket/${reg.id}`} className="btn btn-primary btn-sm">
                    <QrCodeIcon size={16} />
                    View QR Ticket
                  </Link>
                )}
                <Link href={`/events/${reg.event_id}`} className="btn btn-ghost btn-sm">
                  Details
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
