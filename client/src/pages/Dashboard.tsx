import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { clearSharedRoom, prepareLiveKitRoom } from '../services/livekitPrewarm';
import '../styles/dashboard.css';
import type { Meeting } from '../types';

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
  const [showRecordingsModal, setShowRecordingsModal] = useState(false);
  const [selectedRecordings, setSelectedRecordings] = useState<any[]>([]);
  const [isLoadingRecordings, setIsLoadingRecordings] = useState(false);
  const [deleteRecordingId, setDeleteRecordingId] = useState<string | null>(null);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [meetingToDelete, setMeetingToDelete] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every second to auto-enable start buttons and power the live clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // CRITICAL FIX: Kill any lingering WebRTC connections if the user lands here
  // (e.g. by pressing the browser's Back button from the Meeting room).
  // This completely prevents the "ghost participant" bug without being affected by
  // React 18 Strict Mode double-render bugs!
  useEffect(() => {
    clearSharedRoom();
  }, []);

  // Live Socket.io connection to update Dashboard badges instantly
  useEffect(() => {
    const socketUrl = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('/api', '') : '/';
    const socket = io(socketUrl);

    socket.on('meeting-ended-global', (endedRoomCode: string) => {
      setRecentMeetings(prev =>
        prev.map(m => m.room_code === endedRoomCode ? { ...m, is_active: 0 } : m)
      );
      setScheduledMeetings(prev =>
        prev.map(m => m.room_code === endedRoomCode ? { ...m, is_active: 0 } : m)
      );
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  // Fetch recent and scheduled meetings
  const fetchMeetings = async () => {
    try {
      const [recentRes, scheduledRes] = await Promise.all([
        api.get('/meetings/recent'),
        api.get('/meetings/scheduled')
      ]);
      setRecentMeetings(recentRes.data.meetings || []);
      setScheduledMeetings(scheduledRes.data.meetings || []);
    } catch {
      // Not critical — ignore
    }
  };

  useEffect(() => {
    fetchMeetings();
  }, []);

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
    const joinStartTime = performance.now();
    console.log(`[⏱️ Profiling] 1. "Create Meeting" clicked at 0ms`);

    try {
      // PROFILING OPTIMIZATION: Eagerly prefetch the massive WebRTC Meeting component bundle 
      // *in parallel* with the API request. This completely eliminates the lazy-load delay!
      const prefetchMeeting = import('./Meeting');

      const { data } = await api.post('/meetings/create', {
        title: meetingTitle.trim() || 'Music Class',
      });
      console.log(`[⏱️ Profiling] 2. API /create responded in ${(performance.now() - joinStartTime).toFixed(0)}ms`);

      // PROFILING OPTIMIZATION: Start WebRTC background negotiation BEFORE React even navigates
      prepareLiveKitRoom(data.livekit.url, data.livekit.token);

      // We do NOT await prefetchMeeting here. We want to navigate immediately and let 
      // React.Suspense handle the loading state, so the UI feels instantly responsive!

      navigate(`/meeting/${data.meeting.room_code}`, {
        state: {
          meeting: data.meeting,
          livekit: data.livekit,
          isHost: true,
          joinStartTime,
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
    const joinStartTime = performance.now();
    console.log(`[⏱️ Profiling] 1. "Join Meeting" clicked at 0ms`);

    try {
      // PROFILING OPTIMIZATION: Parallel prefetch of the heavy WebRTC chunk
      const prefetchMeeting = import('./Meeting');

      const { data } = await api.post('/meetings/join', {
        roomCode: roomCode.trim().toUpperCase(),
        displayName: user?.name,
      });
      console.log(`[⏱️ Profiling] 2. API /join responded in ${(performance.now() - joinStartTime).toFixed(0)}ms`);

      // PROFILING OPTIMIZATION: Start WebRTC background negotiation BEFORE React even navigates
      prepareLiveKitRoom(data.livekit.url, data.livekit.token);

      // We do NOT await prefetchMeeting here. We navigate immediately!

      navigate(`/meeting/${data.meeting.room_code}`, {
        state: {
          meeting: data.meeting,
          livekit: data.livekit,
          isHost: !!data.isHost,
          joinStartTime,
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
    const joinStartTime = performance.now();
    try {
      const { data } = await api.post('/meetings/join', {
        roomCode: code,
        displayName: user?.name,
      });
      navigate(`/meeting/${data.meeting.room_code}`, {
        state: {
          meeting: data.meeting,
          livekit: data.livekit,
          isHost: !!data.isHost,
          joinStartTime,
        },
      });
    } catch (err: any) {
      setAlertMessage(err.response?.data?.error || 'Failed to start meeting');
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
    
    // Optimistic UI update
    setRecentMeetings(prev => prev.filter(m => m.id !== targetId));
    
    try {
      await api.delete(`/meetings/${targetId}`);
    } catch (err: any) {
      // Revert if error isn't 404
      if (err.response?.status !== 404) {
        setAlertMessage(err.response?.data?.error || 'Failed to delete meeting');
        fetchMeetings(); // Re-fetch to restore
      }
    }
  };

  const handleViewRecordings = async (meetingId: string) => {
    setShowRecordingsModal(true);
    setIsLoadingRecordings(true);
    setSelectedRecordings([]);
    try {
      const { data } = await api.get(`/meetings/${meetingId}/recordings`);
      setSelectedRecordings(data.recordings || []);
    } catch (err) {
      console.error('Failed to fetch recordings', err);
    } finally {
      setIsLoadingRecordings(false);
    }
  };

  const handleViewAllRecordings = async () => {
    setShowRecordingsModal(true);
    setIsLoadingRecordings(true);
    setSelectedRecordings([]);
    try {
      const { data } = await api.get(`/meetings/recordings/all`);
      setSelectedRecordings(data.recordings || []);
    } catch (err) {
      console.error('Failed to fetch recordings', err);
    } finally {
      setIsLoadingRecordings(false);
    }
  };

  const confirmDeleteRecording = async () => {
    if (!deleteRecordingId) return;
    const targetId = deleteRecordingId;
    setDeleteRecordingId(null);
    
    // Optimistic UI update
    setSelectedRecordings(prev => prev.filter(r => r.id !== targetId));
    
    try {
      await api.delete(`/meetings/recordings/${targetId}`);
    } catch (err: any) {
      console.error('Failed to delete recording', err);
      setAlertMessage(err.response?.data?.error || 'Failed to delete recording');
      // In a real app we'd revert the state here, but for now just show error
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const userInitials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

  const getLearningStats = () => {
    let totalMinutes = 0;
    
    recentMeetings.forEach(m => {
      if (m.created_at) {
        const start = new Date(m.created_at).getTime();
        const end = m.ended_at ? new Date(m.ended_at).getTime() : Date.now();
        const diffMins = (end - start) / (1000 * 60);
        if (diffMins > 0) {
          totalMinutes += diffMins;
        }
      }
    });

    if (totalMinutes < 1) {
      return { value: 0, label: 'Minutes of Learning' };
    } else if (totalMinutes < 60) {
      return { value: Math.floor(totalMinutes), label: 'Minutes of Learning' };
    } else {
      const hours = Math.floor(totalMinutes / 60);
      const mins = Math.floor(totalMinutes % 60);
      if (mins === 0) {
        return { value: hours, label: hours === 1 ? 'Hour of Learning' : 'Hours of Learning' };
      }
      return { value: `${hours}h ${mins}m`, label: 'Total Learning Time' };
    }
  };

  const learningStats = getLearningStats();

  return (
    <div className="dashboard">
      {/* Mobile sidebar toggle */}
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

      {/* Sidebar */}
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

      {/* Main Content */}
      <main className="dashboard__main">
        {/* Header Greeting */}
        <header className="dashboard__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 className="dashboard__greeting">
              {getGreeting()},{' '}
              <span className="dashboard__greeting-accent">{user?.name?.split(' ')[0]}</span> 🎶
            </h1>
            <p className="dashboard__date">{getDate()}</p>
          </div>

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
            {new Date(currentTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </header>

        {/* Quick Actions */}
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

          <button className="quick-action-card" id="recordings-btn" style={{ background: 'linear-gradient(135deg, #2563EB 0%, #3B82F6 100%)' }} onClick={handleViewAllRecordings}>
            <span className="quick-action-card__bg-icon" style={{ opacity: 0.1 }}>🎞️</span>
            <span className="quick-action-card__icon">☁️</span>
            <span className="quick-action-card__title">Class Recordings</span>
            <span className="quick-action-card__desc">Watch all past classes</span>
          </button>
        </div>

        {/* Stats */}
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
            <div className="stat-card__value">{recentMeetings.filter(m => m.is_active).length}</div>
            <div className="stat-card__label">Active Now</div>
          </div>
          <div className="stat-card">
            <span className="stat-card__icon">👥</span>
            <div className="stat-card__value">100</div>
            <div className="stat-card__label">Max Students</div>
          </div>
        </div>

        {/* Upcoming Classes */}
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
                    disabled={new Date(meeting.scheduled_for!).getTime() > currentTime}
                    title={new Date(meeting.scheduled_for!).getTime() > currentTime ? "You can start the class once the scheduled time arrives" : ""}
                  >
                    ▶ Start Class
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

        {/* Recent Meetings */}
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
                  className={`meeting-item__status ${meeting.is_active ? 'meeting-item__status--active' : 'meeting-item__status--ended'
                    }`}
                >
                  {meeting.is_active ? '● Live' : 'Ended'}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleViewRecordings(meeting.id); }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', marginLeft: '10px' }}
                  title="View Recordings"
                >
                  🎞️
                </button>
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

      {/* Join Meeting Modal */}
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

      {/* Create Meeting Modal */}
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

      {/* Schedule Meeting Modal */}
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

      {/* Alert Modal */}
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

      {/* Confirm Delete Modal */}
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

      {/* Recordings Modal */}
      {showRecordingsModal && (
        <div className="modal-overlay" onClick={() => setShowRecordingsModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
            <h3 className="modal__title">Class Recordings</h3>
            <p className="modal__subtitle">Stream or download past sessions directly from Cloudflare R2</p>

            <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '350px', overflowY: 'auto' }}>
              {isLoadingRecordings ? (
                <div style={{ textAlign: 'center', padding: '20px' }}>Loading...</div>
              ) : selectedRecordings.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: 'gray' }}>No recordings available yet.</div>
              ) : (
                selectedRecordings.map((rec) => (
                  <div key={rec.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', background: 'rgba(0,0,0,0.05)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{rec.meeting_title || 'Video Recording'}</span>
                      <span style={{ fontSize: '0.8rem', color: 'gray' }}>{new Date(rec.created_at).toLocaleString()}</span>
                      <span style={{ fontSize: '0.75rem', color: rec.status === 'completed' ? 'green' : 'orange' }}>Status: {rec.status}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {rec.status === 'completed' && rec.file_url ? (
                        <a
                          href={rec.file_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            padding: '6px 14px',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            textDecoration: 'none',
                            background: '#DC2626',
                            color: 'white',
                            borderRadius: '6px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            boxShadow: '0 2px 4px rgba(220, 38, 38, 0.2)'
                          }}
                        >
                          ▶ Watch
                        </a>
                      ) : (
                        <span style={{ fontSize: '0.8rem', color: 'gray', padding: '6px 14px', background: 'rgba(0,0,0,0.05)', borderRadius: '6px' }}>Processing...</span>
                      )}

                      {(rec.host_id === user?.id) && (
                        <button
                          onClick={() => setDeleteRecordingId(rec.id)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            padding: '8px', color: '#6B7280', borderRadius: '6px',
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = '#DC2626'; e.currentTarget.style.background = 'rgba(220,38,38,0.1)'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = '#6B7280'; e.currentTarget.style.background = 'none'; }}
                          title="Delete Recording"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <button
              onClick={() => setShowRecordingsModal(false)}
              className="btn-modal-secondary"
              style={{ width: '100%', marginTop: '16px' }}
            >
              Close
            </button>

            {/* Custom Delete Confirmation Modal overlaying this modal */}
            {deleteRecordingId && (
              <div style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(255,255,255,0.9)',
                backdropFilter: 'blur(4px)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                borderRadius: '16px', zIndex: 10, padding: '24px', textAlign: 'center'
              }}>
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#DC2626', marginBottom: '16px' }}>
                  <Trash2 size={24} />
                </div>
                <h3 style={{ fontSize: '1.25rem', color: '#111827', marginBottom: '8px', fontWeight: 600 }}>Delete Recording?</h3>
                <p style={{ color: '#4B5563', fontSize: '0.95rem', marginBottom: '24px', lineHeight: 1.5 }}>
                  This recording will be permanently deleted and cannot be recovered. Students will lose access to it immediately.
                </p>
                <div style={{ display: 'flex', gap: '12px', width: '100%' }}>
                  <button
                    onClick={() => setDeleteRecordingId(null)}
                    style={{ flex: 1, padding: '10px', background: '#F3F4F6', color: '#374151', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteRecording}
                    style={{ flex: 1, padding: '10px', background: '#DC2626', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 600, cursor: 'pointer', boxShadow: '0 4px 6px rgba(220, 38, 38, 0.2)' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal */}
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
