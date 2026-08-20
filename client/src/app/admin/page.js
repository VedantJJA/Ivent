'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost } from '@/lib/api';
import {
  ShieldIcon, UsersIcon, PlusIcon, XIcon, CheckCircleIcon,
  LoaderIcon
} from '@/components/Icons';

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [clubs, setClubs] = useState([]);
  const [users, setUsers] = useState([]);
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
      const [clubsData, usersData] = await Promise.all([
        apiGet('/admin/clubs'),
        apiGet('/admin/users'),
      ]);
      setClubs(clubsData.clubs || []);
      setUsers(usersData.users || []);
      if (clubsData.clubs?.length > 0 && !selectedClubId) {
        setSelectedClubId(clubsData.clubs[0].id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user?.is_admin) {
      fetchData();
    }
  }, [user]);

  const handleCreateClub = async (e) => {
    e.preventDefault();
    if (!newClubName.trim()) return;
    setCreatingClub(true);
    setError(null);
    setSuccess(null);
    try {
      await apiPost('/admin/clubs', {
        name: newClubName.trim(),
        description: newClubDesc.trim() || null,
      });
      setNewClubName('');
      setNewClubDesc('');
      setSuccess('Club created successfully');
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
    setAddingOrganizer(true);
    setError(null);
    setSuccess(null);
    try {
      await apiPost(`/admin/clubs/${selectedClubId}/members`, {
        email: organizerEmail.trim(),
      });
      setOrganizerEmail('');
      setSuccess('Organizer linked to club successfully');
      await fetchData();
    } catch (err) {
      setError(err.message);
    } finally {
      setAddingOrganizer(false);
    }
  };

  const handleRemoveOrganizer = async (clubId, userId) => {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/admin/clubs/${clubId}/members/${userId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('ivent_token')}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove organizer');
      setSuccess('Organizer removed from club');
      await fetchData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleAdmin = async (userId) => {
    setError(null);
    setSuccess(null);
    try {
      await apiPost(`/admin/users/${userId}/toggle-admin`, {});
      setSuccess('Admin status updated');
      await fetchData();
    } catch (err) {
      setError(err.message);
    }
  };

  if (authLoading || (user && !user.is_admin)) {
    return (
      <div className="loading-container">
        <LoaderIcon size={24} />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>
          <ShieldIcon size={28} color="var(--color-primary-400)" />
          {' '}Admin Panel
        </h1>
        <p>Manage clubs, grant organizer status, and assign administrator privileges</p>
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
              <div className="dashboard-stat-value">{users.length}</div>
              <div className="dashboard-stat-label">Registered Users</div>
            </div>
            <div className="dashboard-stat">
              <div className="dashboard-stat-value" style={{ color: 'var(--color-primary-400)' }}>
                {users.filter(u => u.is_admin).length}
              </div>
              <div className="dashboard-stat-label">Admins</div>
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
                  <label className="form-label" htmlFor="orgEmail">User Email</label>
                  <input
                    id="orgEmail"
                    type="email"
                    className="form-input"
                    placeholder="user@example.com"
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
                    <th>Events Hosted</th>
                    <th>Linked Organizers</th>
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
                    </tr>
                  ))}
                  {clubs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
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
              Registered Users and Roles
            </h2>
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role / Club Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.email}</td>
                      <td>
                        {u.is_admin && (
                          <span className="badge badge-primary" style={{ marginRight: '6px' }}>
                            Admin
                          </span>
                        )}
                        {u.clubs && u.clubs.length > 0 ? (
                          u.clubs.map((c) => (
                            <span key={c.id} className="badge badge-success" style={{ marginRight: '6px' }}>
                              {c.name} Organizer
                            </span>
                          ))
                        ) : !u.is_admin ? (
                          <span className="badge badge-muted">Attendee</span>
                        ) : null}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleToggleAdmin(u.id)}
                          disabled={u.id === user.id}
                        >
                          {u.is_admin ? 'Revoke Admin' : 'Make Admin'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* SQL Queries Reference Card */}
          <div className="card" style={{ marginTop: 'var(--space-xl)' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 'var(--space-sm)' }}>
              Direct SQL Queries Reference
            </h3>
            <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: 'var(--space-md)' }}>
              Clubs and organizer permissions can also be manipulated directly in PostgreSQL using SQL queries:
            </p>
            <pre style={{ background: 'var(--color-bg-primary)', padding: 'var(--space-md)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', overflowX: 'auto' }}>
{`-- 1. Create a Club:
INSERT INTO clubs (name, description) VALUES ('Robotics Club', 'Hardware and Robotics');

-- 2. Link a user to a Club as an Organizer:
INSERT INTO club_members (club_id, user_id)
SELECT c.id, u.id FROM clubs c, users u
WHERE c.name = 'Robotics Club' AND u.email = 'target_user@example.com';

-- 3. Grant Admin status to a user:
UPDATE users SET is_admin = TRUE WHERE email = 'target_user@example.com';`}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
