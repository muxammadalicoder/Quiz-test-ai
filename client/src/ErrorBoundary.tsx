import { Component, ReactNode } from "react";
import { api } from "./api";

/** Client xatosini serverga yuboradi (AI muhandis jurnali uchun). Foydalanuvchiga esa oq ekran o‘rniga xabar ko‘rsatiladi. */
export function reportError(message: string, stack?: string, where?: string) {
  try { void api("/api/client-error", { body: { message, stack, where } }).catch(() => {}); } catch { /* e'tiborsiz */ }
}
export function installClientErrorReporting() {
  window.addEventListener("error", e => reportError(e.message || "window.error", e.error?.stack, "window.onerror"));
  window.addEventListener("unhandledrejection", e => reportError("unhandledrejection: " + String((e as PromiseRejectionEvent).reason?.message || (e as PromiseRejectionEvent).reason), (e as PromiseRejectionEvent).reason?.stack, "promise"));
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) { reportError(error.message, (error.stack || "") + "\n" + (info.componentStack || ""), "ErrorBoundary"); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="stack" style={{ padding: 24, textAlign: "center" }}>
        <h2>😕 Nimadir noto‘g‘ri ketdi</h2>
        <p className="muted">Xato qayd etildi. Sahifani qayta yuklab ko‘ring.</p>
        <button className="primary" onClick={() => location.reload()}>Qayta yuklash</button>
      </div>
    );
  }
}
