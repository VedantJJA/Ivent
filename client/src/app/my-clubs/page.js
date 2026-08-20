'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet } from '@/lib/api';
import {
  UsersIcon, PlusIcon, CalendarIcon, BarChartIcon, ScanIcon,
  CheckCircleIcon, LoaderIcon, ShieldIcon
} from '@/components/Icons';

export default function MyClubsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [clubs, setClubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push('/login');
      } else if (user.is_admin) {
        router.push('/admin');
      }
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user && !user.is_admin) {
      apiGet('/events/organizer/clubs')
        .then((data) => setClubs(data.clubs || []))
        .catch((err) => setError(err.message))
        .finally(() => setLoading(false));
    }
  }, [user]);

  if (authLoading || !user || user.is_admin) {
    return (
      <div className="loading-container">
        <LoaderIcon size={24} />
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <div>
            <h1>
              <UsersIcon size={28} color="var(--color-primary-400)" />
              {' '}Organizer Hub
            </h1>
            <p>Clubs you organize and their hosted events</p>
          </div>
          {clubs.length > 0 && (
            <Link href="/events/create" className="btn btn-primary">
              <PlusIcon size={18} />
              Create Event
            </Link>
          )}
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="loading-container">
          <LoaderIcon size={24} />
          <span>Loading your clubs...</span>
        </div>
      ) : clubs.length === 0 ? (
        <div className="empty-state">
          <ShieldIcon size={48} color="var(--color-text-muted)" />
          <h3>No Club Memberships</h3>
          <p>
            You are registered as a standard attendee. You are not currently linked as an organizer for any club.
          </p>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            Ask an administrator to grant you organizer status for a club in the Admin Panel.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
          {clubs.map((club) => (
            <div key={club.id} className="dashboard-section">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                <div>
                  <h2 style={{ fontSize: '1.35rem', marginBottom: '4px' }}>
                    <span className="badge badge-primary" style={{ fontSize: '0.85rem', padding: '4px 10px' }}>
                      {club.name}
                    </span>
                  </h2>
                  {club.description && (
                    <p className="text-muted" style={{ fontSize: '0.85rem' }}>{club.description}</p>
                  )}
                </div>
                <Link
                  href={`/events/create?clubId=${club.id}`}
                  className="btn btn-secondary btn-sm"
                >
                  <PlusIcon size={16} />
                  Create Event for {club.name}
                </Link>
              </div>

              {/* Events for this Club */}
              {club.events && club.events.length > 0 ? (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Event Name</th>
                        <th>Date</th>
                        <th>Registered</th>
                        <th>Checked In</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {club.events.map((ev) => {
                        const isPast = new Date(ev.event_date) < new Date();
                        const isFull = ev.registered_count >= ev.capacity;
                        return (
                          <tr key={ev.id}>
                            <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                              <Link href={`/events/${ev.id}`} style={{ color: 'inherit' }}>
                                {ev.name}
                              </Link>
                            </td>
                            <td>{formatDate(ev.event_date)}</td>
                            <td>{ev.registered_count} / {ev.capacity}</td>
                            <td style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                              {ev.checked_in_count || 0}
                            </td>
                            <td>
                              {isPast ? (
                                <span className="badge badge-muted">Past</span>
                              ) : isFull ? (
                                <span className="badge badge-error">Full</span>
                              ) : (
                                <span className="badge badge-success">Active</span>
                              )}
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <Link
                                  href={`/events/${ev.id}/dashboard`}
                                  className="btn btn-secondary btn-sm"
                                  title="View Live Dashboard"
                                >
                                  <BarChartIcon size={14} />
                                  Dashboard
                                </Link>
                                <Link
                                  href={`/events/${ev.id}/scan`}
                                  className="btn btn-primary btn-sm"
                                  title="Scan QR Tickets"
                                >
                                  <ScanIcon size={14} />
                                  Scan
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: 'var(--space-lg)', textAlign: 'center', background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-md)' }}>
                  <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                    No events hosted by {club.name} yet.
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
