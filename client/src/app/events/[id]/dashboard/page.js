'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, getApiUrl } from '@/lib/api';
import {
  BarChartIcon, UsersIcon, CheckCircleIcon, XCircleIcon, DownloadIcon,
  SparklesIcon, LoaderIcon, ClockIcon
} from '@/components/Icons';

const SUGGESTED_QUERIES = [
  'How many people have checked in so far?',
  'What percentage of registered attendees are no-shows?',
  'What time did check-ins peak?',
  'How many spots are left?',
];

export default function DashboardPage() {
  const { id } = useParams();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [question, setQuestion] = useState('');
  const [insight, setInsight] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
  }, [authLoading, user, router]);

  // Fetch dashboard data
  useEffect(() => {
    if (!user) return;
    fetchDashboard();
  }, [user, id]);

  // Socket.io for real-time updates
  useEffect(() => {
    if (!user) return;
    let socket;
    import('socket.io-client').then(({ io }) => {
      socket = io(getApiUrl(), {
        auth: { token: localStorage.getItem('ivent_token') },
      });
      socket.on('connect', () => {
        socket.emit('join-event', id);
      });
      socket.on('checkin', () => {
        fetchDashboard();
      });
      socketRef.current = socket;
    });
    return () => {
      if (socket) socket.disconnect();
    };
  }, [user, id]);

  const fetchDashboard = async () => {
    try {
      const data = await apiGet(`/events/${id}/dashboard`);
      setDashboard(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = () => {
    const token = localStorage.getItem('ivent_token');
    window.open(`${getApiUrl()}/events/${id}/export.csv?token=${token}`, '_blank');
  };

  const executeInsight = async (queryText) => {
    if (!queryText.trim()) return;
    setInsightLoading(true);
    setInsight(null);
    try {
      const data = await apiPost(`/events/${id}/insights`, { question: queryText });
      setInsight(data);
    } catch (err) {
      setInsight({ answer: null, note: err.message, isFallback: true });
    } finally {
      setInsightLoading(false);
    }
  };

  const handleAskInsight = async (e) => {
    e.preventDefault();
    executeInsight(question);
  };

  const handleSelectQuery = (queryText) => {
    setQuestion(queryText);
    executeInsight(queryText);
  };

  if (authLoading || loading) {
    return (
      <div className="loading-container">
        <LoaderIcon size={24} />
        <span>Loading dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="alert alert-error">{error}</div>
      </div>
    );
  }

  if (!dashboard) return null;

  const { event, registrations, recentScans } = dashboard;
  const checkedInCount = registrations.filter(r => r.checked_in_at).length;
  const notCheckedIn = registrations.length - checkedInCount;
  const checkInRate = registrations.length > 0
    ? ((checkedInCount / registrations.length) * 100).toFixed(1)
    : '0';

  const formatTime = (dateStr) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="flex items-center justify-between" style={{ flexWrap: 'wrap', gap: 'var(--space-md)' }}>
          <div>
            <h1>{event.name}</h1>
            <p>Live Dashboard</p>
          </div>
          <div className="flex gap-sm">
            <button className="btn btn-secondary btn-sm" onClick={handleExportCSV}>
              <DownloadIcon size={16} />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="dashboard-grid">
        <div className="dashboard-stat">
          <div className="dashboard-stat-value">{registrations.length}</div>
          <div className="dashboard-stat-label">Registered</div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat-value" style={{ color: 'var(--color-success)' }}>{checkedInCount}</div>
          <div className="dashboard-stat-label">Checked In</div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat-value" style={{ color: 'var(--color-warning)' }}>{notCheckedIn}</div>
          <div className="dashboard-stat-label">Pending</div>
        </div>
        <div className="dashboard-stat">
          <div className="dashboard-stat-value">{checkInRate}%</div>
          <div className="dashboard-stat-label">Check-in Rate</div>
        </div>
      </div>

      {/* Attendee Table */}
      <div className="dashboard-section">
        <h2>
          <UsersIcon size={20} />
          Attendees ({registrations.length})
        </h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th>Attendee Email</th>
                <th>Registered</th>
                <th>Status</th>
                <th>Checked In At</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((reg) => (
                <tr key={reg.id}>
                  <td style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{reg.email}</td>
                  <td>{formatTime(reg.created_at)}</td>
                  <td>
                    {reg.checked_in_at ? (
                      <span className="badge badge-success">
                        <CheckCircleIcon size={12} /> Checked In
                      </span>
                    ) : (
                      <span className="badge badge-warning">Pending</span>
                    )}
                  </td>
                  <td>{reg.checked_in_at ? formatTime(reg.checked_in_at) : '--'}</td>
                  <td>{reg.checked_in_source || '--'}</td>
                </tr>
              ))}
              {registrations.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
                    No registrations yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Scans */}
      {recentScans.length > 0 && (
        <div className="dashboard-section">
          <h2>
            <ClockIcon size={20} />
            Recent Scans
          </h2>
          <div className="table-container">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Station</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {recentScans.slice(0, 20).map((scan) => (
                  <tr key={scan.id}>
                    <td>{formatTime(scan.server_received_at)}</td>
                    <td>{scan.station_id}</td>
                    <td>
                      {scan.result === 'accepted' ? (
                        <span className="badge badge-success">Accepted</span>
                      ) : scan.result === 'rejected_duplicate' ? (
                        <span className="badge badge-warning">Duplicate</span>
                      ) : scan.result === 'rejected_invalid_totp' ? (
                        <span className="badge badge-error">Invalid Code</span>
                      ) : (
                        <span className="badge badge-muted">{scan.result}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI Insights */}
      <div className="insights-panel">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
          <h3 style={{ margin: 0 }}>
            <SparklesIcon size={20} color="var(--color-primary-400)" />
            AI Insights (Grok-3 Powered)
          </h3>
          <span className="badge badge-primary">Live Context Telemetry</span>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-md)' }}>
          Click an autofill prompt below or ask any question regarding check-ins, attendance rates, and event capacity.
        </p>

        {/* Suggestion Chips / Autofill Bubbles */}
        <div className="insights-bubbles-container">
          {SUGGESTED_QUERIES.map((qText, idx) => (
            <button
              key={idx}
              type="button"
              className="insights-bubble-btn"
              onClick={() => handleSelectQuery(qText)}
              disabled={insightLoading}
            >
              <SparklesIcon size={12} />
              {qText}
            </button>
          ))}
        </div>

        <form onSubmit={handleAskInsight}>
          <div className="insights-input-row">
            <input
              type="text"
              className="form-input"
              placeholder="Ask about your event data..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={insightLoading || !question.trim()}
            >
              {insightLoading ? <LoaderIcon size={16} /> : 'Ask'}
            </button>
          </div>
        </form>

        {insight && (
          <div className="insights-answer">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontWeight: 600, color: 'var(--color-primary-400)', fontSize: '0.85rem' }}>
                {insight.isFallback ? '⚡ Deterministic SQL Fallback' : '✨ Grok-3 Intelligence Response'}
              </span>
              {insight.note && (
                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                  {insight.note}
                </span>
              )}
            </div>
            <div style={{ color: 'var(--color-text-primary)' }}>
              {insight.answer || insight.note || 'No response available'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
