import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#2D1B22', color: '#FF8888', fontFamily: 'monospace', minHeight: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <h2>🚨 Application Crashed</h2>
          <pre style={{ background: '#1A0D12', padding: '15px', borderRadius: '8px', overflow: 'auto', maxWidth: '90vw', whiteSpace: 'pre-wrap' }}>
            {this.state.error?.message}
            {'\n'}
            {this.state.error?.stack}
          </pre>
          <button 
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.href = '/dashboard';
            }} 
            style={{ marginTop: '20px', padding: '10px 20px', background: '#FF4444', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Go Back to Dashboard
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
