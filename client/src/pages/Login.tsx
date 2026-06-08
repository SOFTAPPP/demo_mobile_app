import React, { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/auth.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setIsLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      if (!err.response) {
        setError('Unable to connect to the server. Please check your network connection.');
      } else if (err.response.status === 401) {
        setError('Invalid credentials. Please verify your email and password.');
      } else {
        setError(err.response.data?.error || 'An error occurred during login. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Animated Background */}
      <div className="auth-page__bg">
        <div className="auth-page__bg-circle" />
        <div className="auth-page__bg-circle" />
        <div className="auth-page__bg-circle" />
        <div className="auth-page__music-note" style={{ top: '80%' }}>♪</div>
        <div className="auth-page__music-note" style={{ top: '70%' }}>♫</div>
        <div className="auth-page__music-note" style={{ top: '90%' }}>♬</div>
        <div className="auth-page__music-note" style={{ top: '75%' }}>♩</div>
        <div className="auth-page__music-note" style={{ top: '85%' }}>♪</div>
        <div className="auth-page__music-note" style={{ top: '65%' }}>♫</div>
      </div>

      {/* Left Panel — Branding */}
      <div className="auth-page__brand">
        <div className="auth-page__brand-logo">🎵</div>
        <h1 className="auth-page__brand-title">Sangeet Arghya</h1>
        <p className="auth-page__brand-subtitle">Nada Upasana Academy</p>
        <div className="auth-page__brand-tagline">
          <p>Guided by Grace, Inspired by the Divine</p>
          <p style={{ marginTop: '8px', opacity: 0.6, fontSize: '0.8rem' }}>
            Join online music classes with crystal-clear audio & video.
            Learn from the comfort of your home.
          </p>
        </div>
      </div>

      {/* Right Panel — Login Form */}
      <div className="auth-page__form-panel">
        <div className="auth-card">
          <h2 className="auth-card__title">Welcome back</h2>
          <p className="auth-card__subtitle">Sign in to continue your musical journey</p>

          {error && <div className="auth-error">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="login-email">Email Address</label>
              <input
                id="login-email"
                type="email"
                className="form-input"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                className="form-input"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className={`btn-submit ${isLoading ? 'btn-submit--loading' : ''}`}
              disabled={isLoading}
            >
              {isLoading ? <span className="loader" /> : 'Sign In'}
            </button>
          </form>

          <p className="auth-toggle">
            Don't have an account?{' '}
            <Link to="/signup">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
