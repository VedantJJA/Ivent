'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, apiDelete } from '@/lib/api';
import {
  ShieldIcon, UsersIcon, PlusIcon, XIcon, CheckCircleIcon,
  LoaderIcon, CalendarIcon, BarChartIcon, TrashIcon
} from '@/components/Icons';

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [clubs, setClubs] = useState([]);
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // New club form state
  const [newClubName, setNewClubName] = useState('');
  const [newClubDesc, setNewClubDesc] = useState('');
  const [creatingClub, setCreatingClub] = useState(false);

  // Add organizer state
  const [selectedClubId, setSelectedClubId] = useState('');
  const [organizerEmail, setOrganizerEmail] = useState('');
  const [addingOrganizer, setAddingOrganizer] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push('/login');
      } else if (!user.is_admin) {
        router.push('/');
      }
    }
  }, [user, authLoading, router]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [clubsData, usersData, eventsData] = await Promise.all([
        apiGet('/admin/clubs'),
        apiGet('/admin/users'),
        apiGet('/admin/events'),
      ]);
      setClubs(clubsData.clubs || []);
      setUsers(usersData.users || []);
      setEvents(eventsData.events || []);

      if (clubsData.clubs && clubsData.clubs.length > 0 && !selectedClubId) {
        setSelectedClubId(clubsData.clubs[0].id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user && user.is_admin) {
      fetchData();
    }
  }, [user]);

  const handleCreateClub = async (e) => {
    e.preventDefault();
    if (!newClubName.trim()) return;

    setError(null);
    setSuccess(null);
    setCreatingClub(true);
    try {
      await apiPost('/admin/clubs', {
        name: newClubName.trim(),
        description: newClubDesc.trim() || undefined,
      });
      setSuccess(`Club "${newClubName}" created successfully`);
      setNewClubName('');
      setNewClubDesc('');
      await fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingClub(false);
    }
  };

  const handleAddOrganizer = async (e) => {
    e.preventDefault();
    if (!selectedClubId || !organizerEmail.trim()) return;

    setError(null);
    setSuccess(null);
    setAddingOrganizer(true);
    try {
      await apiPost(`/admin/clubs/${selectedClubId}/members`, {
        email: organizerEmail.trim(),
      });
      setSuccess(`Organizer linked to club successfully`);
      setOrganizerEmail('');
      await fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingOrganizer(false);
    }
  };

  const handleRemoveOrganizer = async (clubId, targetUserId) => {
    setError(null);
    setSuccess(null);
    try {
      await apiDelete(`/admin/clubs/${clubId}/members/${targetUserId}`);
      setSuccess('Organizer removed from club');
      await fetchData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteClub = async (clubId, clubName) => {
    if (!window.confirm(`Are you sure you want to delete club "${clubName}"? This action cannot be undone and will remove all its events.`)) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const data = await apiDelete(`/admin/clubs/${clubId}`);
      setSuccess(data.message || 'Club deleted successfully');
      await fetchData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteEvent = async (eventId, eventName) => {
    if (!window.confirm(`Are you sure you want to delete event "${eventName}"? This action cannot be undone.`)) {
      return;
    }
    setError(null);
    setSuccess(null);
    try {
      const data = await apiDelete(`/admin/events/${eventId}`);
      setSuccess(data.message || 'Event deleted successfully');
      await fetchData();
    } catch (err) {
      setError(err.message);
    }
  };

  if (authLoading || !user || !user.is_admin) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <h1>
            <ShieldIcon size={28} color="var(--color-primary-400)" />
            {' '}System Developer & Admin Panel
          </h1>
        </div>
        <p>Environment-authenticated developer console. Manage clubs, link organizers, and oversee system events.</p>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {success && (
        <div className="alert alert-success">
          <CheckCircleIcon size={18} />
          {success}
        </div>
      )}

      {loading ? (
        <div className="loading-container">
          <LoaderIcon size={24} />
          <span>Loading admin data...</span>
        </div>
      ) : (
        <>
          {/* Quick Stats Grid */}
          <div className="dashboard-grid" style={{ marginBottom: 'var(--space-xl)' }}>
            <div className="dashboard-stat">
              <div className="dashboard-stat-value">{clubs.length}</div>
              <div className="dashboard-stat-label">Total Clubs</div>
            </div>
            <div className="dashboard-stat">
              <div className="dashboard-stat-value">{events.length}</div>
              <div className="dashboard-stat-label">Total Events</div>
            </div>
            <div className="dashboard-stat">
              <div className="dashboard-stat-value">{users.length}</div>
              <div className="dashboard-stat-label">Registered Users</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--space-lg)', marginBottom: 'var(--space-xl)' }}>
            {/* Link Organizer to Club Card */}
            <div className="card">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UsersIcon size={20} color="var(--color-primary-400)" />
                Grant Organizer Status
              </h2>
              <form onSubmit={handleAddOrganizer}>
                <div className="form-group">
                  <label className="form-label" htmlFor="selectClub">Select Club</label>
                  <select
                    id="selectClub"
                    className="form-select"
                    value={selectedClubId}
                    onChange={(e) => setSelectedClubId(e.target.value)}
                    required
                  >
                    {clubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="orgEmail">User Email or Registration Number</label>
                  <input
                    id="orgEmail"
                    type="text"
                    className="form-input"
                    placeholder="e.g. user@example.com or 21BCE1001"
                    value={organizerEmail}
                    onChange={(e) => setOrganizerEmail(e.target.value)}
                    required
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-full"
                  disabled={addingOrganizer || !organizerEmail.trim() || !selectedClubId}
                >
                  {addingOrganizer ? <LoaderIcon size={16} /> : 'Link Organizer to Club'}
                </button>
              </form>
            </div>

            {/* Create New Club Card */}
            <div className="card">
              <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <PlusIcon size={20} color="var(--color-primary-400)" />
                Create New Club
              </h2>
              <form onSubmit={handleCreateClub}>
                <div className="form-group">
                  <label className="form-label" htmlFor="clubName">Club Name</label>
                  <input
                    id="clubName"
                    type="text"
                    className="form-input"
                    placeholder="E.g. Robotics Club"
                    value={newClubName}
                    onChange={(e) => setNewClubName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="clubDesc">Description</label>
                  <input
                    id="clubDesc"
                    type="text"
                    className="form-input"
                    placeholder="Short description of the club"
                    value={newClubDesc}
                    onChange={(e) => setNewClubDesc(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary btn-full"
                  disabled={creatingClub || !newClubName.trim()}
                >
                  {creatingClub ? <LoaderIcon size={16} /> : 'Create Club'}
                </button>
              </form>
            </div>
          </div>

          {/* Events Management (Delete Events) */}
          <div className="dashboard-section">
            <h2>
              <CalendarIcon size={20} />
              All System Events ({events.length})
            </h2>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Event Name</th>
                    <th>Club</th>
                    <th>Date</th>
                    <th>Registered</th>
                    <th>Checked In</th>
                    <th>Creator</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        <Link href={`/events/${ev.id}`} style={{ color: 'inherit' }}>
                          {ev.name}
                        </Link>
                      </td>
                      <td>
                        {ev.club_name ? (
                          <span className="badge badge-primary">{ev.club_name}</span>
                        ) : (
                          <span className="badge badge-muted">Independent</span>
                        )}
                      </td>
                      <td>{formatDate(ev.event_date)}</td>
                      <td>{ev.registered_count} / {ev.capacity}</td>
                      <td style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                        {ev.checked_in_count || 0}
                      </td>
                      <td style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                        {ev.creator_email}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <Link href={`/events/${ev.id}/dashboard`} className="btn btn-secondary btn-sm">
                            <BarChartIcon size={14} />
                            Stats
                          </Link>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteEvent(ev.id, ev.name)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {events.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
                        No events have been created yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Clubs & Organizers List */}
          <div className="dashboard-section">
            <h2>
              <UsersIcon size={20} />
              Clubs and Linked Organizers
            </h2>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Club Name</th>
                    <th>Description</th>
                    <th>Events</th>
                    <th>Linked Organizers</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {clubs.map((club) => (
                    <tr key={club.id}>
                      <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {club.name}
                      </td>
                      <td>{club.description || '--'}</td>
                      <td>{club.event_count || 0}</td>
                      <td>
                        {club.members && club.members.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {club.members.map((m) => (
                              <span
                                key={m.user_id}
                                className="badge badge-muted"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                              >
                                {m.email}
                                <button
                                  type="button"
                                  onClick={() => handleRemoveOrganizer(club.id, m.user_id)}
                                  style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', padding: 0 }}
                                  title="Remove organizer"
                                >
                                  <XIcon size={12} />
                                </button>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted" style={{ fontSize: '0.8rem' }}>No organizers linked yet</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteClub(club.id, club.name)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '0.75rem' }}
                          title="Delete Club"
                        >
                          <TrashIcon size={12} />
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                  {clubs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
                        No clubs found. Create one above or run the SQL query.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Registered Users List */}
          <div className="dashboard-section">
            <h2>
              <ShieldIcon size={20} />
              Registered Users
            </h2>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Reg No</th>
                    <th>Status / Role</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td style={{ fontFamily: 'monospace' }}>{u.reg_number || '--'}</td>
                      <td>
                        {u.is_admin ? (
                          <span className="badge badge-primary" style={{ marginRight: '6px' }}>
                            System Developer & Admin
                          </span>
                        ) : u.clubs && u.clubs.length > 0 ? (
                          u.clubs.map((c) => (
                            <span key={c.id} className="badge badge-success" style={{ marginRight: '6px' }}>
                              {c.name} Organizer
                            </span>
                          ))
                        ) : (
                          <span className="badge badge-muted">Attendee</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
