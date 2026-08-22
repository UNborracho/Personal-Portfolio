import { Component, type ReactNode } from "react"

/** Minimal error boundary — a crash inside the WebGL gallery must not
 *  white-screen the whole app (React 19 has no implicit boundary; the
 *  StrictMode context-loss crash proved the blast radius). The fallback
 *  is App's DOM masonry — the same markup the no-WebGL path renders, so
 *  a dead gallery degrades to a working photo grid, not a blank page.
 *  No reset API on purpose: once WebGL fails it will fail again — the
 *  fallback holds for the session, a reload gives it one more chance. */
interface Props {
  fallback: ReactNode
  children: ReactNode
}

interface State {
  failed: boolean
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error("[gallery] crashed — falling back to DOM masonry", error)
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
