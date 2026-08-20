'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiPost } from '@/lib/api';
import { PlusIcon, LoaderIcon, CalendarIcon } from '@/components/Icons';

export default function CreateEventPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    description: '',
    location: '',
    eventDate: '',
    capacity: '',
  });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!authLoading && !user) {
    router.push('/login');
    return null;
  }

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!form.name || !form.eventDate || !form.capacity) {
      setError('Name, date, and capacity are required');
      return;
    }

    const cap = parseInt(form.capacity, 10);
    if (isNaN(cap) || cap < 1) {
      setError('Capacity must be at least 1');
      return;
    }

    setLoading(true);
    try {
      const data = await apiPost('/events', {
        name: form.name,
        description: form.description || null,
        location: form.location || null,
        eventDate: new Date(form.eventDate).toISOString(),
        capacity: cap,
      });
      router.push(`/events/${data.event.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="create-event-container">
      <div className="create-event-card">
        <h1>
          <CalendarIcon size={28} color="var(--color-primary-400)" />
          {' '}Create New Event
        </h1>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="name">Event Name</label>
            <input
              id="name"
              name="name"
              type="text"
              className="form-input"
              placeholder="Annual Tech Conference"
              value={form.name}
              onChange={handleChange}
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="description">Description</label>
            <textarea
              id="description"
              name="description"
              className="form-textarea"
              placeholder="Describe your event..."
              value={form.description}
              onChange={handleChange}
              rows={3}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="location">Location</label>
            <input
              id="location"
              name="location"
              type="text"
              className="form-input"
              placeholder="Convention Center, Hall A"
              value={form.location}
              onChange={handleChange}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="eventDate">Date and Time</label>
              <input
                id="eventDate"
                name="eventDate"
                type="datetime-local"
                className="form-input"
                value={form.eventDate}
                onChange={handleChange}
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="capacity">Capacity</label>
              <input
                id="capacity"
                name="capacity"
                type="number"
                className="form-input"
                placeholder="100"
                min="1"
                value={form.capacity}
                onChange={handleChange}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            disabled={loading}
            style={{ marginTop: 'var(--space-sm)' }}
          >
            {loading ? (
              <>
                <LoaderIcon size={18} />
                Creating Event...
              </>
            ) : (
              <>
                <PlusIcon size={18} />
                Create Event
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
