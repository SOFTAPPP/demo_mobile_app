import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

import { getSocket, disconnectSocket } from '../services/socket';
import '../styles/dashboard.css';
import type { Meeting } from '../types';

function LiveClock() {
  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="dashboard__live-clock" style={{
      fontSize: '1.1rem',
      fontFamily: 'var(--font-heading)',
      fontWeight: 600,
      color: 'var(--color-text-primary)',
      background: 'rgba(255, 255, 255, 0.8)',
      backdropFilter: 'blur(10px)',
      WebkitBackdropFilter: 'blur(10px)',
      padding: '8px 24px',
      borderRadius: '100px',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.03)',
      border: '1px solid rgba(255, 255, 255, 0.6)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      letterSpacing: '1px'
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: '#E53E3E',
        boxShadow: '0 0 8px rgba(229, 62, 62, 0.5)',
        animation: 'pulse 2s infinite'
      }}></span>
      {new Date(time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </div>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [roomCode, setRoomCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [recentMeetings, setRecentMeetings] = useState<Meeting[]>([]);
  const [scheduledMeetings, setScheduledMeetings] = useState<Meeting[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [meetingToDelete, setMeetingToDelete] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Background prefetch for heavy Meeting component
    // This fixes the ~10s delay when clicking join/create
    const prefetchTimer = setTimeout(() => {
      import('./Meeting').catch(() => {});
    }, 1500);

    return () => clearTimeout(prefetchTimer);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const onMeetingEnded = (endedRoomCode: string) => {
      setRecentMeetings(prev =>
        prev.map(m => m.room_code === endedRoomCode ? { ...m, is_active: 0 } : m)
      );
      setScheduledMeetings(prev =>
        prev.map(m => m.room_code === endedRoomCode ? { ...m, is_active: 0 } : m)
      );
    };

    socket.on('meeting-ended-global', onMeetingEnded);

    return () => {
      socket.off('meeting-ended-global', onMeetingEnded);
      disconnectSocket();
    };
  }, []);

  const fetchMeetings = useCallback(async () => {
    try {
      const [recentRes, scheduledRes] = await Promise.all([
        api.get('/meetings/recent'),
        api.get('/meetings/scheduled')
      ]);
      setRecentMeetings(recentRes.data.meetings || []);
      setScheduledMeetings(scheduledRes.data.meetings || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  const getDate = () => {
    return new Date().toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const handleCreateMeeting = async () => {
    setIsCreating(true);
    setAlertMessage('');

    try {
      import('./Meeting');

      const { data } = await api.post('/meetings/create', {
        title: meetingTitle.trim() || 'Music Class',
      });


      navigate(`/meeting/${data.meeting.room_code}`, {
        state: {
          meeting: data.meeting,
          livekit: data.livekit,
          isHost: true,
          joinStartTime: performance.now(),
        },
      });
    } catch (err: any) {
      setAlertMessage(err.response?.data?.error || 'Failed to create meeting');
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinMeeting = async () => {
    if (!roomCode.trim()) {
      setJoinError('Please enter a room code');
      return;
    }

    setIsJoining(true);
    setJoinError('');

    try {
      import('./Meeting');

      const { data } = await api.post('/meetings/join', {
        roomCode: roomCode.trim().toUpperCase(),
        displayName: user?.name,
      });


      navigate(`/meeting/${data.meeting.room_code}`, {
        state: {
          meeting: data.meeting,
          livekit: data.livekit,
          isHost: !!data.isHost,
          joinStartTime: performance.now(),
        },
      });
    } catch (err: any) {
      setJoinError(err.response?.data?.error || 'Failed to join meeting');
    } finally {
      setIsJoining(false);
    }
  };

  const handleScheduleMeeting = async () => {
    if (!scheduleDate || !scheduleTime) {
      setAlertMessage('Please select a date and time');
      return;
    }

    setIsCreating(true);
    setAlertMessage('');
    try {
      const scheduledFor = new Date(`${scheduleDate}T${scheduleTime}`).toISOString();
      const { data } = await api.post('/meetings/schedule', {
        title: meetingTitle.trim() || 'Scheduled Music Class',
        scheduledFor,
      });
      setScheduledMeetings((prev) => [...prev, data.meeting].sort((a, b) => new Date(a.scheduled_for!).getTime() - new Date(b.scheduled_for!).getTime()));
      setShowScheduleModal(false);
      setMeetingTitle('');
      setScheduleDate('');
      setScheduleTime('');
    } catch (err: any) {
      setAlertMessage(err.response?.data?.error || 'Failed to schedule meeting');
    } finally {
      setIsCreating(false);
    }
  };

  const startScheduledMeeting = async (code: string) => {
    setIsJoining(true);
    setAlertMessage('');
    try {
      import('./Meeting');

      const { data } = await api.post('/meetings/join', {
        roomCode: code,
        displayName: user?.name,
      });


      navigate(`/meeting/${data.meeting.room_code}`, {
        state: {
          meeting: data.meeting,
          livekit: data.livekit,
          isHost: !!data.isHost,
          joinStartTime: performance.now(),
        },
      });
    } catch (err: any) {
      setAlertMessage(err.response?.data?.error || 'Failed to start meeting');
    } finally {
      setIsJoining(false);
    }
  };

  const handleDeleteMeeting = (meetingId: string) => {
    setMeetingToDelete(meetingId);
  };

  const confirmDelete = async () => {
    if (!meetingToDelete) return;
    const targetId = meetingToDelete;
    setMeetingToDelete(null);

    setRecentMeetings(prev => prev.filter(m => m.id !== targetId));
    setScheduledMeetings(prev => prev.filter(m => m.id !== targetId));

    try {
      await api.delete(`/meetings/${targetId}`);
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setAlertMessage(err.response?.data?.error || 'Failed to delete meeting');
        fetchMeetings();
      }
    }
  };


  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const userInitials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const learningStats = useMemo(() => {
    let totalMinutes = 0;
    recentMeetings.forEach(m => {
      if (m.created_at) {
        const start = new Date(m.created_at).getTime();
        const end = m.ended_at ? new Date(m.ended_at).getTime() : Date.now();
        const diffMins = (end - start) / (1000 * 60);
        if (diffMins > 0) totalMinutes += diffMins;
      }
    });

    if (totalMinutes < 1) return { value: 0, label: 'Minutes of Learning' };
    if (totalMinutes < 60) return { value: Math.floor(totalMinutes), label: 'Minutes of Learning' };
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.floor(totalMinutes % 60);
    if (mins === 0) return { value: hours, label: hours === 1 ? 'Hour of Learning' : 'Hours of Learning' };
    return { value: `${hours}h ${mins}m`, label: 'Total Learning Time' };
  }, [recentMeetings]);

  const activeCount = useMemo(() => recentMeetings.filter(m => m.is_active).length, [recentMeetings]);

  return (
    <div className="dashboard">
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        id="sidebar-toggle"
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar__header">
          <div className="sidebar__logo">
            <div className="sidebar__logo-icon">🎵</div>
            <div>
              <span className="sidebar__logo-text">
                Sangeet Arghya
                <span className="sidebar__logo-sub">Nada Upasana Academy</span>
              </span>
            </div>
          </div>
        </div>

        <nav className="sidebar__nav">
          <div className="sidebar__nav-item active">
            <span className="sidebar__nav-icon">🏠</span>
            Dashboard
          </div>
          <div className="sidebar__nav-item" onClick={() => setShowCreateModal(true)}>
            <span className="sidebar__nav-icon">📹</span>
            New Meeting
          </div>
          <div className="sidebar__nav-item" onClick={() => setShowJoinModal(true)}>
            <span className="sidebar__nav-icon">🔗</span>
            Join Meeting
          </div>
          <div className="sidebar__nav-item" onClick={() => setShowScheduleModal(true)}>
            <span className="sidebar__nav-icon">📅</span>
            Schedule
          </div>
          <div className="sidebar__nav-item">
            <span className="sidebar__nav-icon">📊</span>
            Analytics
          </div>
          <div className="sidebar__nav-item">
            <span className="sidebar__nav-icon">⚙️</span>
            Settings
          </div>
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__user">
            <div
              className="sidebar__user-avatar"
              style={{ backgroundColor: user?.avatar_color || '#7B2D26' }}
            >
              {userInitials}
            </div>
            <div className="sidebar__user-info">
              <div className="sidebar__user-name">{user?.name}</div>
              <div className="sidebar__user-role">{user?.role}</div>
            </div>
            <button
              className="sidebar__logout"
              onClick={() => setShowLogoutConfirm(true)}
              title="Logout"
              id="logout-btn"
            >
              🚪
            </button>
          </div>
        </div>
      </aside>

      <main className="dashboard__main">
        <header className="dashboard__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 className="dashboard__greeting">
              {getGreeting()},{' '}
              <span className="dashboard__greeting-accent">{user?.name?.split(' ')[0]}</span> 🎶
            </h1>
            <p className="dashboard__date">{getDate()}</p>
          </div>
          <LiveClock />
        </header>

        <div className="quick-actions">
          <button
            className="quick-action-card quick-action-card--create"
            onClick={() => setShowCreateModal(true)}
            id="create-meeting-btn"
          >
            <span className="quick-action-card__bg-icon">📹</span>
            <span className="quick-action-card__icon">🎥</span>
            <span className="quick-action-card__title">New Meeting</span>
            <span className="quick-action-card__desc">Start a new music class instantly</span>
          </button>

          <button
            className="quick-action-card quick-action-card--join"
            onClick={() => setShowJoinModal(true)}
            id="join-meeting-btn"
          >
            <span className="quick-action-card__bg-icon">🔗</span>
            <span className="quick-action-card__icon">🎯</span>
            <span className="quick-action-card__title">Join Meeting</span>
            <span className="quick-action-card__desc">Enter a room code to join a class</span>
          </button>

          <button className="quick-action-card quick-action-card--schedule" id="schedule-btn" onClick={() => setShowScheduleModal(true)}>
            <span className="quick-action-card__bg-icon">📅</span>
            <span className="quick-action-card__icon">📆</span>
            <span className="quick-action-card__title">Schedule</span>
            <span className="quick-action-card__desc">Plan your upcoming classes</span>
          </button>

        </div>

        <div className="stats-grid">
          <div className="stat-card">
            <span className="stat-card__icon">🎵</span>
            <div className="stat-card__value">{recentMeetings.length}</div>
            <div className="stat-card__label">Total Classes</div>
          </div>
          <div className="stat-card">
            <span className="stat-card__icon">⏱️</span>
            <div className="stat-card__value" style={{ fontSize: typeof learningStats.value === 'string' ? '1.8rem' : undefined }}>{learningStats.value}</div>
            <div className="stat-card__label">{learningStats.label}</div>
          </div>
          <div className="stat-card">
            <span className="stat-card__icon">🏆</span>
            <div className="stat-card__value">{activeCount}</div>
            <div className="stat-card__label">Active Now</div>
          </div>
          <div className="stat-card">
            <span className="stat-card__icon">👥</span>
            <div className="stat-card__value">100</div>
            <div className="stat-card__label">Max Students</div>
          </div>
        </div>

        {scheduledMeetings.length > 0 && (
          <>
            <h2 className="section-title">📆 Upcoming Classes</h2>
            <div className="meetings-list" style={{ marginBottom: '2rem' }}>
              {scheduledMeetings.map((meeting, idx) => (
                <div
                  key={meeting.id}
                  className="meeting-item"
                  style={{ animationDelay: `${0.1 * idx}s`, borderLeft: '4px solid #4CAF50' }}
                >
                  <div className="meeting-item__icon">📅</div>
                  <div className="meeting-item__info">
                    <div className="meeting-item__title">{meeting.title}</div>
                    <div className="meeting-item__meta" style={{ color: '#4CAF50', fontWeight: 600 }}>
                      {formatDate(meeting.scheduled_for!)}
                    </div>
                  </div>
                  <span className="meeting-item__code">{meeting.room_code}</span>
                  <button
                    className="btn-modal-primary"
                    style={{
                      padding: '8px 20px',
                      fontSize: '13px',
                      marginLeft: 'auto',
                      flex: '0 0 auto',
                      width: 'auto',
                      minWidth: '120px',
                      opacity: new Date(meeting.scheduled_for!).getTime() <= currentTime ? 1 : 0.5,
                      cursor: new Date(meeting.scheduled_for!).getTime() <= currentTime ? 'pointer' : 'not-allowed'
                    }}
                    onClick={() => startScheduledMeeting(meeting.room_code)}
                    disabled={new Date(meeting.scheduled_for!).getTime() > currentTime || isJoining}
                    title={new Date(meeting.scheduled_for!).getTime() > currentTime ? "You can start the class once the scheduled time arrives" : ""}
                  >
                    {isJoining ? 'Starting...' : '▶ Start Class'}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteMeeting(meeting.id); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', marginLeft: '10px' }}
                    title="Delete Scheduled Meeting"
                  >
                    🗑️
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <h2 className="section-title">📋 Recent Meetings</h2>
        <div className="meetings-list">
          {recentMeetings.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state__icon">🎵</div>
              <p className="empty-state__text">
                No meetings yet. Create your first music class!
              </p>
            </div>
          ) : (
            recentMeetings.map((meeting, idx) => (
              <div
                key={meeting.id}
                className="meeting-item"
                style={{ animationDelay: `${0.1 * idx}s` }}
              >
                <div className="meeting-item__icon">🎶</div>
                <div className="meeting-item__info">
                  <div className="meeting-item__title">{meeting.title}</div>
                  <div className="meeting-item__meta">{formatDate(meeting.created_at)}</div>
                </div>
                <span className="meeting-item__code">{meeting.room_code}</span>
                <span
                  className={`meeting-item__status ${meeting.is_active ? 'meeting-item__status--active' : 'meeting-item__status--ended'}`}
                >
                  {meeting.is_active ? '● Live' : 'Ended'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteMeeting(meeting.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', marginLeft: '10px' }}
                  title="Delete Meeting"
                >
                  🗑️
                </button>
              </div>
            ))
          )}
        </div>
      </main>

      {showJoinModal && (
        <div className="modal-overlay" onClick={() => setShowJoinModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">Join a Meeting</h3>
            <p className="modal__subtitle">Enter the room code shared by your teacher</p>

            {joinError && <div className="auth-error">{joinError}</div>}

            <input
              type="text"
              className="room-code-input"
              placeholder="ABC123"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              maxLength={6}
              autoFocus
              id="room-code-input"
            />

            <div className="modal__actions">
              <button
                className="btn-modal-secondary"
                onClick={() => setShowJoinModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-modal-primary"
                onClick={handleJoinMeeting}
                disabled={isJoining}
                id="join-btn"
              >
                {isJoining ? 'Joining...' : 'Join Meeting'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">Create a New Meeting</h3>
            <p className="modal__subtitle">Start a new music class for your students</p>

            <div className="form-group">
              <label htmlFor="meeting-title">Class Title (optional)</label>
              <input
                id="meeting-title"
                type="text"
                className="form-input"
                placeholder="e.g., Tabla Basics — Session 3"
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
              />
            </div>

            <div className="modal__actions">
              <button
                className="btn-modal-secondary"
                onClick={() => setShowCreateModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-modal-primary"
                onClick={handleCreateMeeting}
                disabled={isCreating}
                id="create-btn"
              >
                {isCreating ? 'Creating...' : '🎥 Start Meeting'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showScheduleModal && (
        <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">Schedule a Class</h3>
            <p className="modal__subtitle">Plan an upcoming music class</p>

            <div className="form-group">
              <label htmlFor="schedule-title">Class Title (optional)</label>
              <input
                id="schedule-title"
                type="text"
                className="form-input"
                placeholder="e.g., Raga Yaman Practice"
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
              <div style={{ flex: 1 }}>
                <label htmlFor="schedule-date">Date</label>
                <input
                  id="schedule-date"
                  type="date"
                  className="form-input"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label htmlFor="schedule-time">Time</label>
                <input
                  id="schedule-time"
                  type="time"
                  className="form-input"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
              </div>
            </div>

            <div className="modal__actions" style={{ marginTop: '24px' }}>
              <button
                className="btn-modal-secondary"
                onClick={() => setShowScheduleModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-modal-primary"
                onClick={handleScheduleMeeting}
                disabled={isCreating}
                style={{ background: '#4CAF50', borderColor: '#4CAF50' }}
              >
                {isCreating ? 'Scheduling...' : '📅 Schedule Class'}
              </button>
            </div>
          </div>
        </div>
      )}

      {alertMessage && (
        <div className="modal-overlay" onClick={() => setAlertMessage(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">Notice</h3>
            <p className="modal__subtitle">{alertMessage}</p>
            <div className="modal__actions" style={{ justifyContent: 'center' }}>
              <button
                className="btn-modal-primary"
                onClick={() => setAlertMessage(null)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {meetingToDelete && (
        <div className="modal-overlay" onClick={() => setMeetingToDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal__title">Delete Class</h3>
            <p className="modal__subtitle">Are you sure you want to permanently delete this music class? This action cannot be undone.</p>
            <div className="modal__actions">
              <button
                className="btn-modal-secondary"
                onClick={() => setMeetingToDelete(null)}
              >
                Cancel
              </button>
              <button
                className="btn-modal-primary"
                style={{ background: '#E53E3E', color: 'white', borderColor: '#E53E3E' }}
                onClick={confirmDelete}
              >
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}


      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ textAlign: 'center', padding: '32px 24px', maxWidth: '340px' }}>
            <h3 style={{ fontSize: '1.25rem', color: '#111827', marginBottom: '8px', fontWeight: 600 }}>Log Out?</h3>
            <p style={{ color: '#4B5563', fontSize: '0.95rem', marginBottom: '24px', lineHeight: 1.5 }}>
              Are you sure you want to log out of your account?
            </p>
            <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
              <button
                onClick={() => setShowLogoutConfirm(false)}
                style={{ flex: 1, padding: '10px', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                  navigate('/login');
                }}
                style={{ flex: 1, padding: '10px', background: '#DC2626', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 6px rgba(220, 38, 38, 0.2)' }}
              >
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
