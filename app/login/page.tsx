"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Client-side lockout countdown
  useEffect(() => {
    if (lockedUntil) {
      timerRef.current = setInterval(() => {
        const left = Math.ceil((lockedUntil - Date.now()) / 1000);
        if (left <= 0) {
          setLockedUntil(null);
          setTimeLeft(0);
          if (timerRef.current) clearInterval(timerRef.current);
        } else {
          setTimeLeft(left);
        }
      }, 500);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [lockedUntil]);

  // Disable right-click, F12, DevTools shortcuts on login page
  useEffect(() => {
    function blockContextMenu(e: MouseEvent) { e.preventDefault(); }
    function blockKeys(e: KeyboardEvent) {
      // F12
      if (e.key === "F12") { e.preventDefault(); return; }
      // Ctrl+Shift+I / Cmd+Option+I
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "I" || e.key === "i")) { e.preventDefault(); return; }
      // Ctrl+Shift+J
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "J" || e.key === "j")) { e.preventDefault(); return; }
      // Ctrl+U (view source)
      if ((e.ctrlKey || e.metaKey) && (e.key === "U" || e.key === "u")) { e.preventDefault(); return; }
      // Ctrl+Shift+C
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "C" || e.key === "c")) { e.preventDefault(); return; }
    }

    document.addEventListener("contextmenu", blockContextMenu);
    document.addEventListener("keydown", blockKeys);
    return () => {
      document.removeEventListener("contextmenu", blockContextMenu);
      document.removeEventListener("keydown", blockKeys);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lockedUntil && Date.now() < lockedUntil) return;

    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);

        // Progressive lockout: 3 fails = 30s, 5 fails = 120s, 7+ = 300s
        if (newAttempts >= 7) {
          const until = Date.now() + 5 * 60 * 1000;
          setLockedUntil(until);
          setError("Too many failed attempts. Account locked for 5 minutes.");
        } else if (newAttempts >= 5) {
          const until = Date.now() + 2 * 60 * 1000;
          setLockedUntil(until);
          setError("Too many failed attempts. Please wait 2 minutes.");
        } else if (newAttempts >= 3) {
          const until = Date.now() + 30 * 1000;
          setLockedUntil(until);
          setError("Too many failed attempts. Please wait 30 seconds.");
        } else {
          setError(data.error || "Invalid email or password");
        }
      } else {
        setAttempts(0);
        router.push("/dashboard");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const isLocked = lockedUntil !== null && Date.now() < lockedUntil;

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--background)" }}
      onContextMenu={e => e.preventDefault()}
    >
      <style>{`
        * { -webkit-user-select: none; user-select: none; }
        input { -webkit-user-select: text; user-select: text; }
      `}</style>

      <div className="w-full max-w-md px-6">
        {/* Logo / Brand */}
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--accent)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="w-5 h-5">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <span className="text-xl font-semibold tracking-tight" style={{ color: "var(--text-primary)" }}>
              CreatorDiscover
            </span>
          </div>
          <p style={{ color: "var(--text-secondary)" }} className="text-sm">
            Internal platform — authorized access only
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-8" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(99,102,241,0.15)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" className="w-4 h-4">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              Sign in to your account
            </h1>
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg text-sm flex items-start gap-2" style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              color: "#f87171",
            }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0 mt-0.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <span>
                {error}
                {isLocked && timeLeft > 0 && (
                  <span className="block mt-1 font-semibold">
                    Try again in {timeLeft}s
                  </span>
                )}
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                Email address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={isLocked}
                className="w-full px-4 py-2.5 rounded-lg text-sm outline-none transition-all disabled:opacity-50"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-primary)",
                }}
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={isLocked}
                  className="w-full px-4 py-2.5 pr-10 rounded-lg text-sm outline-none transition-all disabled:opacity-50"
                  style={{
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                  }}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--text-secondary)" }}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            {/* Attempts indicator */}
            {attempts >= 2 && !isLocked && (
              <div className="px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b" }}>
                Warning: {attempts} failed attempt{attempts !== 1 ? "s" : ""}. Account will be temporarily locked after too many failures.
              </div>
            )}

            <button
              type="submit"
              disabled={loading || isLocked}
              className="w-full py-2.5 rounded-lg text-sm font-medium transition-all mt-2 flex items-center justify-center gap-2"
              style={{
                background: isLocked ? "var(--surface-2)" : loading ? "var(--surface-2)" : "var(--accent)",
                color: isLocked || loading ? "var(--text-secondary)" : "white",
                cursor: isLocked || loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  Signing in…
                </>
              ) : isLocked ? `Locked — wait ${timeLeft}s` : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center mt-6 text-xs" style={{ color: "var(--text-secondary)" }}>
          Contact your administrator if you need access
        </p>
      </div>
    </div>
  );
}