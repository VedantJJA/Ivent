'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/api';
import {
  CalendarIcon, UsersIcon, MapPinIcon, TicketIcon, CheckCircleIcon,
  BarChartIcon, ScanIcon, LoaderIcon
} from '@/components/Icons';

export default function EventDetailPage() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [event, setEvent] = useState(null);
  const [registration, setRegistration] = useState(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState(null);
  const [regSuccess, setRegSuccess] = useState(false);

  useEffect(() => {
    apiGet(`/events/${id}`)
      .then((data) => {
        setEvent(data.event);
        setRegistration(data.registration);
        setIsOrganizer(data.isOrganizer);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleRegister = async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    setRegistering(true);
    setError(null);
    try {
      const data = await apiPost(`/events/${id}/register`);
      setRegistration(data.registration);
      setRegSuccess(true);
      // Refresh event data to get updated count
      const refreshed = await apiGet(`/events/${id}`);
      setEvent(refreshed.event);
    } catch (err) {
      setError(err.message);
    } finally {
      setRegistering(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <LoaderIcon size={24} />
        <span>Loading event...</span>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="event-detail">
        <div className="alert alert-error">Event not found</div>
      </div>
    );
  }

  const eventDate = new Date(event.event_date);
  const isPast = eventDate < new Date();
  const isFull = event.registered_count >= event.capacity;
  const spotsLeft = event.capacity - event.registered_count;
  const fillPercent = Math.min((event.registered_count / event.capacity) * 100, 100);

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="event-detail">
      <div className="event-detail-header">
        <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)', flexWrap: 'wrap' }}>
          {isPast ? (
            <span className="badge badge-muted">Past Event</span>
          ) : isFull ? (
            <span className="badge badge-error">Sold Out</span>
          ) : (
            <span className="badge badge-success">Open for Registration</span>
          )}
          {isOrganizer && <span className="badge badge-primary">Organizer</span>}
          {registration && <span className="badge badge-success">Registered</span>}
        </div>

        <h1>{event.name}</h1>

        <div className="event-detail-info">
          <div className="event-detail-info-item">
            <CalendarIcon size={20} color="var(--color-primary-400)" />
            <span>{formatDate(eventDate)} at {formatTime(eventDate)}</span>
          </div>
          {event.location && (
            <div className="event-detail-info-item">
              <MapPinIcon size={20} color="var(--color-primary-400)" />
              <span>{event.location}</span>
            </div>
          )}
          <div className="event-detail-info-item">
            <UsersIcon size={20} color="var(--color-primary-400)" />
            <span>{event.registered_count} / {event.capacity} registered</span>
          </div>
        </div>
      </div>

      {/* Capacity bar */}
      <div className="capacity-widget">
        <h3>Registration Capacity</h3>
        <div className="capacity-widget-count">{spotsLeft}</div>
        <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
          spots remaining
        </p>
        <div className="capacity-widget-bar">
          <div className="capacity-widget-fill" style={{ width: `${fillPercent}%` }} />
        </div>
        <div className="capacity-widget-text">
          <span>{event.registered_count} registered</span>
          <span>{event.capacity} total</span>
        </div>
      </div>

      {/* Description */}
      {event.description && (
        <div className="event-detail-description">
          <h2>About This Event</h2>
          <p>{event.description}</p>
        </div>
      )}

      {/* Actions */}
      {error && <div className="alert alert-error">{error}</div>}
      {regSuccess && (
        <div className="alert alert-success">
          <CheckCircleIcon size={18} />
          Successfully registered! View your QR ticket below.
        </div>
      )}

      <div className="event-detail-actions">
        {!registration && !isPast && !isFull && (
          <button
            className="btn btn-primary btn-lg"
            onClick={handleRegister}
            disabled={registering}
          >
            {registering ? (
              <>
                <LoaderIcon size={18} />
                Registering...
              </>
            ) : (
              <>
                <TicketIcon size={18} />
                {user ? 'Register for This Event' : 'Sign In to Register'}
              </>
            )}
          </button>
        )}

        {registration && (
          <Link href={`/my-ticket/${registration.id}`} className="btn btn-primary btn-lg">
            <TicketIcon size={18} />
            View My QR Ticket
          </Link>
        )}

        {isOrganizer && (
          <>
            <Link href={`/events/${id}/dashboard`} className="btn btn-secondary btn-lg">
              <BarChartIcon size={18} />
              Dashboard
            </Link>
            <Link href={`/events/${id}/scan`} className="btn btn-secondary btn-lg">
              <ScanIcon size={18} />
              Scan QR Codes
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
