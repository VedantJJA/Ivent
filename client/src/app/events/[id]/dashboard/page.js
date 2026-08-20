'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { apiGet, apiPost, getApiUrl } from '@/lib/api';
import {
  BarChartIcon, UsersIcon, CheckCircleIcon, XCircleIcon, DownloadIcon,
  SparklesIcon, LoaderIcon, ClockIcon
} from '@/components/Icons';

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

  const handleAskInsight = async (e) => {
    e.preventDefault();
    if (!question.trim()) return;
    setInsightLoading(true);
    setInsight(null);
    try {
      const data = await apiPost(`/events/${id}/insights`, { question });
      setInsight(data);
    } catch (err) {
      setInsight({ note: err.message });
    } finally {
      setInsightLoading(false);
    }
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
                <th>Email</th>
                <th>Reg No</th>
                <th>Registered</th>
                <th>Status</th>
                <th>Checked In At</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {registrations.map((reg) => (
                <tr key={reg.id}>
                  <td>{reg.email}</td>
                  <td style={{ fontFamily: 'monospace' }}>{reg.reg_number || '--'}</td>
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
                  <td colSpan={6} className="text-center text-muted" style={{ padding: 'var(--space-xl)' }}>
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
        <h3>
          <SparklesIcon size={20} />
          AI Insights
        </h3>
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
            {insight.answer || insight.note || 'No response available'}
            {insight.rawStats && !insight.answer && (
              <pre style={{ marginTop: 'var(--space-sm)', fontSize: '0.8rem' }}>
                {JSON.stringify(insight.rawStats, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
