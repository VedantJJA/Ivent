'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/api';
import EventCard from '@/components/EventCard';
import { CalendarIcon, PlusIcon, ShieldIcon, QrCodeIcon, LoaderIcon } from '@/components/Icons';

export default function HomePage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiGet('/events')
      .then((data) => setEvents(data.events))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const upcomingEvents = events.filter(e => new Date(e.event_date) >= new Date());
  const pastEvents = events.filter(e => new Date(e.event_date) < new Date());

  return (
    <>
      <section className="hero">
        <h1>
          Event Check-In,{' '}
          <span className="text-gradient">Reimagined</span>
        </h1>
        <p>
          Secure TOTP-based QR check-in with real-time dashboards,
          offline scanning support, and concurrency-safe registration.
        </p>
        <div className="hero-actions">
          {user ? (
            <Link href="/events/create" className="btn btn-primary btn-lg">
              <PlusIcon size={20} />
              Create Event
            </Link>
          ) : (
            <Link href="/login" className="btn btn-primary btn-lg">
              Get Started
            </Link>
          )}
          <a href="#events" className="btn btn-secondary btn-lg">
            Browse Events
          </a>
        </div>
      </section>

      <div className="page-container" id="events">
        {loading ? (
          <div className="loading-container">
            <LoaderIcon size={24} />
            <span>Loading events...</span>
          </div>
        ) : error ? (
          <div className="alert alert-error">{error}</div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <CalendarIcon size={48} color="var(--color-text-muted)" />
            <h3>No Events Yet</h3>
            <p>Be the first to create an event and start managing check-ins.</p>
            {user && (
              <Link href="/events/create" className="btn btn-primary">
                <PlusIcon size={18} />
                Create Your First Event
              </Link>
            )}
          </div>
        ) : (
          <>
            {upcomingEvents.length > 0 && (
              <>
                <div className="page-header">
                  <h1>Upcoming Events</h1>
                  <p>Browse and register for upcoming events. No account needed to look around.</p>
                </div>
                <div className="event-grid">
                  {upcomingEvents.map((event, i) => (
                    <EventCard key={event.id} event={event} style={{ animationDelay: `${i * 0.05}s` }} />
                  ))}
                </div>
              </>
            )}

            {pastEvents.length > 0 && (
              <div className="mt-lg">
                <div className="page-header">
                  <h1>Past Events</h1>
                </div>
                <div className="event-grid">
                  {pastEvents.map((event, i) => (
                    <EventCard key={event.id} event={event} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <section className="page-container">
        <div className="dashboard-grid" style={{ marginTop: 'var(--space-xl)' }}>
          <div className="dashboard-stat">
            <div style={{ marginBottom: 'var(--space-sm)' }}>
              <ShieldIcon size={32} color="var(--color-primary-400)" />
            </div>
            <div className="dashboard-stat-label">Concurrency-Safe</div>
            <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '4px' }}>
              Atomic registration prevents overselling
            </p>
          </div>
          <div className="dashboard-stat">
            <div style={{ marginBottom: 'var(--space-sm)' }}>
              <QrCodeIcon size={32} color="var(--color-primary-400)" />
            </div>
            <div className="dashboard-stat-label">TOTP QR Codes</div>
            <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '4px' }}>
              Rotating codes prevent screenshot sharing
            </p>
          </div>
          <div className="dashboard-stat">
            <div style={{ marginBottom: 'var(--space-sm)' }}>
              <CalendarIcon size={32} color="var(--color-primary-400)" />
            </div>
            <div className="dashboard-stat-label">Real-Time Dashboard</div>
            <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '4px' }}>
              Live check-in tracking via Socket.io
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
