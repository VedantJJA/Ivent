'use client';

import Link from 'next/link';
import { CalendarIcon, UsersIcon, MapPinIcon } from '@/components/Icons';

export default function EventCard({ event }) {
  const eventDate = new Date(event.event_date);
  const spotsLeft = event.capacity - event.registered_count;
  const isFull = spotsLeft <= 0;
  const isPast = eventDate < new Date();
  const fillPercent = Math.min((event.registered_count / event.capacity) * 100, 100);

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
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
    <Link href={`/events/${event.id}`} className="event-card">
      <div className="event-card-header">
        <div className="event-card-date-badge">
          <span className="event-card-date-month">
            {eventDate.toLocaleDateString('en-US', { month: 'short' })}
          </span>
          <span className="event-card-date-day">
            {eventDate.getDate()}
          </span>
        </div>
        <div className="event-card-status">
          {isPast ? (
            <span className="badge badge-muted">Past</span>
          ) : isFull ? (
            <span className="badge badge-error">Full</span>
          ) : spotsLeft <= 10 ? (
            <span className="badge badge-warning">{spotsLeft} spots left</span>
          ) : (
            <span className="badge badge-success">Open</span>
          )}
        </div>
      </div>

      <h3 className="event-card-title">{event.name}</h3>

      {event.description && (
        <p className="event-card-description">{event.description}</p>
      )}

      <div className="event-card-meta">
        <div className="event-card-meta-item">
          <CalendarIcon size={16} color="var(--color-text-muted)" />
          <span>{formatDate(eventDate)} at {formatTime(eventDate)}</span>
        </div>
        {event.location && (
          <div className="event-card-meta-item">
            <MapPinIcon size={16} color="var(--color-text-muted)" />
            <span>{event.location}</span>
          </div>
        )}
        <div className="event-card-meta-item">
          <UsersIcon size={16} color="var(--color-text-muted)" />
          <span>{event.registered_count} / {event.capacity} registered</span>
        </div>
      </div>

      <div className="event-card-capacity-bar">
        <div
          className={`event-card-capacity-fill ${isFull ? 'capacity-full' : ''}`}
          style={{ width: `${fillPercent}%` }}
        />
      </div>
    </Link>
  );
}
