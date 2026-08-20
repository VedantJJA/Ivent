'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/api';
import EventCard from '@/components/EventCard';
import {
  CalendarIcon, PlusIcon, ShieldIcon, LoaderIcon,
  TicketIcon, LogInIcon, UsersIcon
} from '@/components/Icons';

export default function HomePage() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Load from local storage cache first for instant offline rendering
    try {
      const cached = localStorage.getItem('ivent_cached_events');
      if (cached) {
        setEvents(JSON.parse(cached));
        setLoading(false);
      }
    } catch {
      // ignore
    }

    apiGet('/events')
      .then((data) => {
        setEvents(data.events || []);
        try {
          localStorage.setItem('ivent_cached_events', JSON.stringify(data.events || []));
        } catch {
          // ignore
        }
      })
      .catch((err) => {
        // If we already loaded cached events, don't show error screen
        const cached = localStorage.getItem('ivent_cached_events');
        if (!cached) {
          setError(err.message);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const upcomingEvents = events.filter(e => new Date(e.event_date) >= new Date());
  const pastEvents = events.filter(e => new Date(e.event_date) < new Date());

  const isAdmin = !!user?.is_admin;
  const isOrganizer = !isAdmin && user?.clubs && user.clubs.length > 0;

  return (
    <>
      <section className="hero">
        <h1>
          Event Check-In,{' '}
          <span className="text-gradient">Reimagined</span>
        </h1>
        <p>
          Discover, register, and check in to campus and community events.
        </p>
        <div className="hero-actions">
          {user ? (
            isAdmin ? (
              <Link href="/admin" className="btn btn-primary btn-lg">
                <ShieldIcon size={20} />
                Admin Panel
              </Link>
            ) : isOrganizer ? (
              <div style={{ display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap', justifyContent: 'center' }}>
                <Link href="/events/create" className="btn btn-primary btn-lg">
                  <PlusIcon size={20} />
                  Create Event
                </Link>
                <Link href="/my-clubs" className="btn btn-secondary btn-lg">
                  <UsersIcon size={20} />
                  My Clubs
                </Link>
              </div>
            ) : (
              <Link href="/my-registrations" className="btn btn-primary btn-lg">
                <TicketIcon size={20} />
                My Tickets
              </Link>
            )
          ) : (
            <Link href="/login" className="btn btn-primary btn-lg">
              <LogInIcon size={20} />
              Sign In to Participate
            </Link>
          )}
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
            <p>
              {isOrganizer
                ? 'Be the first to create an event for your club.'
                : 'No events scheduled yet. Please check back later.'}
            </p>
            {isOrganizer && (
              <Link href="/events/create" className="btn btn-primary">
                <PlusIcon size={18} />
                Create Event
              </Link>
            )}
          </div>
        ) : (
          <>
            {upcomingEvents.length > 0 && (
              <>
                <div className="page-header">
                  <h1>Upcoming Events</h1>
                  <p>Browse and register for upcoming events.</p>
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
    </>
  );
}
