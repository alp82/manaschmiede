import * as React from 'react'
import { Button } from './ui/Button'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/**
 * Specimen error boundary — catches render errors anywhere below it and
 * paints a brutalist-editorial fallback plate: Cinzel display title in
 * ink-red, Geist body, single RELOAD action, and the raw error message
 * as mono marginalia underneath for debugging.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught:', error, info)
    }
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 py-16 text-center">
          <h1 className="font-display text-display-title uppercase tracking-display text-ink-red-bright">
            Something Broke
          </h1>
          <p className="max-w-md font-body text-sm italic text-cream-300">
            An unexpected error occurred. Reload to try again.
          </p>
          <Button variant="primary" size="lg" onClick={this.handleReload}>
            Reload
          </Button>
          <pre className="mt-4 max-w-xl whitespace-pre-wrap break-words font-mono text-mono-marginal text-cream-500">
            {this.state.error.message}
          </pre>
        </div>
      )
    }

    return this.props.children
  }
}
