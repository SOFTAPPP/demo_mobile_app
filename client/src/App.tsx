import React, { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import ErrorBoundary from './components/ErrorBoundary';
import Login from './pages/Login';
import Signup from './pages/Signup';
import './styles/index.css';

// Register service worker for offline caching
if ('serviceWorker' in navigator && !window.location.hostname.includes('localhost')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Lazy load heavy components
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Meeting = lazy(() => import('./pages/Meeting'));
const MeetingEnded = lazy(() => import('./pages/MeetingEnded'));

// Loading Fallback
const PageLoader = () => (
  <div className="page-loader">
    <span className="loader" />
    <span className="page-loader__text">Loading...</span>
  </div>
);

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="page-loader">
        <span className="loader" />
        <span className="page-loader__text">Loading...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Redirect if already logged in
function PublicRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="page-loader">
        <span className="loader" />
        <span className="page-loader__text">Loading...</span>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route
        path="/login"
        element={
          <PublicRoute>
            <Login />
          </PublicRoute>
        }
      />
      <Route
        path="/signup"
        element={
          <PublicRoute>
            <Signup />
          </PublicRoute>
        }
      />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Suspense fallback={<PageLoader />}>
              <Dashboard />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/meeting/:roomCode"
        element={
          <ProtectedRoute>
            <Suspense fallback={<PageLoader />}>
              <Meeting />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route
        path="/meeting-ended"
        element={
          <ProtectedRoute>
            <Suspense fallback={<PageLoader />}>
              <MeetingEnded />
            </Suspense>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <Router>
      <ErrorBoundary>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
