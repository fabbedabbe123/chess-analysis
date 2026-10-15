import { storageRemove } from '@/utils/storage';
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last line of defence: a render error shows a recovery screen instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="fatal" role="alert">
        <h2>Something went wrong</h2>
        <p className="muted">{this.state.error.message}</p>
        <div className="row">
          <button className="btn primary" onClick={() => location.reload()}>Reload</button>
          <button
            className="btn danger"
            onClick={() => {
              storageRemove('chess-analysis:game:v1');
              location.reload();
            }}
          >
            Discard the saved game and reload
          </button>
        </div>
      </div>
    );
  }
}
