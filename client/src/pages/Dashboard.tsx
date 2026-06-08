import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import type { Meeting } from '../types';
import '../styles/dashboard.css';

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
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingToDelete, setMeetingToDelete] = useState<string | null>(null);
  const [alertMessage, setAlertMessage] = useState<string | null>(null);

  // Fetch recent meetings
  useEffect(() => {
    const fetchMeetings = async () => {
      try {
        const { data } = await api.get('/meetings/recent');
        setRecentMeetings(data.meetings || []);
      } catch {
        // Not critical — ignore
      }
    };
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
      const { data } = await api.post('/meetings/create', {
        title: meetingTitle.trim() || 'Music Class',
      });
      console.log(`[⏱️ Profiling] 2. API /create responded in ${(performance.now() - joinStartTime).toFixed(0)}ms`);

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
      const { data } = await api.post('/meetings/join', {
        roomCode: roomCode.trim().toUpperCase(),
        displayName: user?.name,
      });
      console.log(`[⏱️ Profiling] 2. API /join responded in ${(performance.now() - joinStartTime).toFixed(0)}ms`);
      
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

  const handleDeleteMeeting = (meetingId: string) => {
    setMeetingToDelete(meetingId);
  };

  const confirmDelete = async () => {
    if (!meetingToDelete) return;
    try {
      await api.delete(`/meetings/${meetingToDelete}`);
      setRecentMeetings(prev => prev.filter(m => m.id !== meetingToDelete));
    } catch (err: any) {
      if (err.response?.status === 404) {
        // Meeting is already deleted on the server (e.g. by another window), so just remove it from UI
        setRecentMeetings(prev => prev.filter(m => m.id !== meetingToDelete));
      } else {
        setAlertMessage(err.response?.data?.error || 'Failed to delete meeting');
      }
    } finally {
      setMeetingToDelete(null);
    }
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const userInitials = user?.name
    ? user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : '?';

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
          <div className="sidebar__nav-item">
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
            <button className="sidebar__logout" onClick={logout} title="Logout" id="logout-btn">
              🚪
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="dashboard__main">
        {/* Header Greeting */}
        <header className="dashboard__header">
          <h1 className="dashboard__greeting">
            {getGreeting()},{' '}
            <span className="dashboard__greeting-accent">{user?.name?.split(' ')[0]}</span> 🎶
          </h1>
          <p className="dashboard__date">{getDate()}</p>
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

          <button className="quick-action-card quick-action-card--schedule" id="schedule-btn">
            <span className="quick-action-card__bg-icon">📅</span>
            <span className="quick-action-card__icon">📆</span>
            <span className="quick-action-card__title">Schedule</span>
            <span className="quick-action-card__desc">Plan your upcoming classes</span>
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
            <div className="stat-card__value">{Math.floor(recentMeetings.length * 45)}</div>
            <div className="stat-card__label">Minutes of Learning</div>
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
                  className={`meeting-item__status ${
                    meeting.is_active ? 'meeting-item__status--active' : 'meeting-item__status--ended'
                  }`}
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
    </div>
  );
}
