"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import toast, { Toaster } from "react-hot-toast";
import { cachedFetch, invalidateCache } from "@/lib/client-cache";
import Link from "next/link";

interface Row { name: string; count: number }
interface AnalyticsData {
  summary: { total: number; countries: number; niches: number };
  byCountry: Row[];
  byNiche: Row[];
  byAgeGroup: Row[];
  byGender: Row[];
  byCreatorType: Row[];
  states: Row[];
  cities: Row[];
}
interface User { id: string; email: string; fullName: string; role: string }
interface SavedList { id: string; name: string; _count: { items: number } }
interface MetaResponse { countries: string[] }
interface ListsResponse { lists: SavedList[] }

const COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#ef4444", "#14b8a6", "#f97316", "#84cc16",
  "#06b6d4", "#a855f7",
];

function fmtNum(n: number | string) {
  const num = typeof n === "string" ? parseInt(n) : n;
  if (isNaN(num)) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

const CARD = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "0.75rem",
  padding: "1.25rem",
};

const TIP = {
  contentStyle: {
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
    borderRadius: "0.5rem",
    color: "var(--text-primary)",
    fontSize: "0.75rem",
  },
  labelStyle: { color: "var(--text-secondary)" },
  cursor: { fill: "rgba(99,102,241,0.08)" },
};

const SEL: React.CSSProperties = {
  background: "var(--surface-2)",
  border: "1px solid var(--border)",
  color: "var(--text-primary)",
  borderRadius: "0.5rem",
  padding: "0.45rem 0.75rem",
  fontSize: "0.8rem",
  outline: "none",
  minWidth: "170px",
  cursor: "pointer",
};

function PieInnerLabel({
  cx, cy, midAngle, innerRadius, outerRadius, percent, name,
}: {
  cx: number; cy: number; midAngle: number; innerRadius: number;
  outerRadius: number; percent: number; name: string;
}) {
  if (percent < 0.04) return null;
  const R = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * R);
  const y = cy + r * Math.sin(-midAngle * R);
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>
      {name}
      <tspan x={x} dy={13}>{(percent * 100).toFixed(0)}%</tspan>
    </text>
  );
}

// Analytics responses are cheap to revalidate but expensive to compute server-side,
// so give them a slightly longer TTL than the 5-minute default.
const ANALYTICS_TTL_MS = 2 * 60 * 1000; // 2 minutes

export default function OverviewPage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [showListsSidebar, setShowListsSidebar] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [showSignOut, setShowSignOut] = useState(false);
  const [allCountries, setAllCountries] = useState<string[]>([]);
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedState, setSelectedState] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  // Auth check stays uncached — this must always reflect the live session.
  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data?.user) { router.replace("/login"); return; }
        setUser(data.user);
        setLoading(false);
      })
      .catch(() => router.replace("/login"));
  }, [router]);

  // Country list rarely changes — cache it across route changes.
  useEffect(() => {
    cachedFetch<MetaResponse>("creators-meta", () =>
      fetch("/api/creators/meta").then(r => r.json()),
    ).then(d => setAllCountries(d.countries || []));
  }, []);

  // Saved lists — cached, but invalidated on create so mutations stay correct.
  useEffect(() => {
    if (!user) return;
    cachedFetch<ListsResponse>("saved-lists", () =>
      fetch("/api/lists").then(r => r.json()),
    ).then(d => setSavedLists(d.lists || []));
  }, [user]);

  const fetchAnalytics = useCallback(async () => {
    setLoadingData(true);
    const p = new URLSearchParams();
    if (selectedCountry) p.set("country", selectedCountry);
    if (selectedState) p.set("state", selectedState);
    if (selectedCity) p.set("city", selectedCity);

    const key = `analytics:${p.toString()}`;
    try {
      const data = await cachedFetch<AnalyticsData>(
        key,
        async () => {
          const res = await fetch(`/api/analytics?${p}`);
          if (!res.ok) throw new Error(`Analytics fetch failed: ${res.status}`);
          return res.json();
        },
        ANALYTICS_TTL_MS,
      );
      setAnalytics(data);
    } catch {
      toast.error("Couldn't load analytics");
    } finally {
      setLoadingData(false);
    }
  }, [selectedCountry, selectedState, selectedCity]);

  useEffect(() => {
    if (!loading) fetchAnalytics();
  }, [loading, fetchAnalytics]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const createList = async () => {
    if (!newListName.trim()) return;
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newListName.trim() }),
    });
    if (res.ok) {
      const d = await res.json();
      setSavedLists(p => [...p, d.list]);
      invalidateCache("saved-lists"); // keep the module cache in sync with the mutation
      setNewListName("");
      toast.success("List created");
    }
  };

  const clearFilter = () => { setSelectedCountry(""); setSelectedState(""); setSelectedCity(""); };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Loading…</p>
      </div>
    );
  }

  const hasFilter = !!(selectedCountry || selectedState || selectedCity);

  return (
    <div className="h-screen flex overflow-hidden" style={{ background: "var(--background)" }}>
      <Toaster position="top-right" />

      {/* ── Sidebar ── */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="px-4 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "var(--accent)" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" className="w-4 h-4"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-xs leading-tight truncate" style={{ color: "var(--text-primary)" }}>CreatorDiscover</p>
              <p className="text-xs leading-tight" style={{ color: "var(--text-secondary)" }}>Veel</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
          {/* Dashboard — active */}
          <Link href="/overview"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium"
            style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            <span>Dashboard</span>
          </Link>

          {/* Search */}
          <Link href="/dashboard"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            <span>Search</span>
          </Link>

          {/* Notes */}
          <Link href="/notes"
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{ color: "var(--text-secondary)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            <span>Notes</span>
          </Link>

          {/* Saved Lists */}
          <div>
            <button onClick={() => setShowListsSidebar(!showListsSidebar)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
              style={{ color: showListsSidebar ? "var(--accent)" : "var(--text-secondary)", background: showListsSidebar ? "rgba(99,102,241,0.1)" : "transparent" }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
              <span className="flex-1 text-left">Saved Lists</span>
              {savedLists.length > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: showListsSidebar ? "rgba(99,102,241,0.2)" : "var(--surface-2)", color: showListsSidebar ? "var(--accent)" : "var(--text-secondary)" }}>
                  {savedLists.length}
                </span>
              )}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className={`w-3 h-3 flex-shrink-0 transition-transform duration-150 ${showListsSidebar ? "rotate-180" : ""}`}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {showListsSidebar && (
              <div className="mt-0.5 ml-2 pl-3 border-l space-y-0.5" style={{ borderColor: "var(--border)" }}>
                {savedLists.length === 0
                  ? <p className="text-xs px-2 py-2" style={{ color: "var(--text-secondary)" }}>No lists yet</p>
                  : savedLists.map(list => (
                    <button key={list.id} onClick={() => router.push("/dashboard")}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left transition-colors"
                      style={{ color: "var(--text-secondary)" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 flex-shrink-0" style={{ color: "var(--accent)", opacity: 0.7 }}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                      <span className="flex-1 truncate">{list.name}</span>
                      <span className="text-xs tabular-nums px-1 py-0.5 rounded"
                        style={{ background: "var(--surface-2)", color: "var(--text-secondary)", minWidth: "1.25rem", textAlign: "center" }}>
                        {list._count.items}
                      </span>
                    </button>
                  ))
                }
                <div className="flex gap-1.5 pt-1.5 pb-1">
                  <input value={newListName} onChange={e => setNewListName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && createList()}
                    placeholder="New list…"
                    className="flex-1 px-2 py-1 rounded-lg text-xs outline-none"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text-primary)" }} />
                  <button onClick={createList} disabled={!newListName.trim()}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold disabled:opacity-40 flex-shrink-0"
                    style={{ background: "var(--accent)", color: "white" }}>+</button>
                </div>
              </div>
            )}
          </div>

          {user?.role === "ADMIN" && (
            <a href="/admin"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-primary)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-secondary)"; }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span>Admin</span>
            </a>
          )}
        </nav>

        <div className="p-2 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-0.5" style={{ background: "var(--surface-2)" }}>
            <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold"
              style={{ background: "var(--accent)", color: "white" }}>
              {(user?.fullName || user?.email || "?").charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate leading-tight" style={{ color: "var(--text-primary)" }}>{user?.fullName || "—"}</p>
              <p className="text-xs truncate leading-tight" style={{ color: "var(--text-secondary)" }}>{user?.email}</p>
            </div>
          </div>
          {showSignOut ? (
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="text-xs flex-1" style={{ color: "var(--text-secondary)" }}>Sign out?</span>
              <button onClick={handleLogout} className="text-xs font-semibold px-2 py-0.5 rounded" style={{ color: "#ef4444", background: "rgba(239,68,68,0.1)" }}>Yes</button>
              <button onClick={() => setShowSignOut(false)} className="text-xs px-2 py-0.5 rounded" style={{ color: "var(--text-secondary)", background: "var(--surface-2)" }}>No</button>
            </div>
          ) : (
            <button onClick={() => setShowSignOut(true)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors"
              style={{ color: "var(--text-secondary)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.08)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              <span>Sign out</span>
            </button>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="flex-1 overflow-y-auto">
        {/* Sticky header with filters */}
        <div className="px-6 py-3 border-b sticky top-0 z-10" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Analytics Dashboard</h1>
              <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {hasFilter
                  ? `Filtered: ${[selectedCountry, selectedState, selectedCity].filter(Boolean).join(" › ")}`
                  : "Global overview · all creators"}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={selectedCountry}
                onChange={e => { setSelectedCountry(e.target.value); setSelectedState(""); setSelectedCity(""); }}
                style={SEL}>
                <option value="">All Countries</option>
                {allCountries.map(c => <option key={c} value={c}>{c}</option>)}
              </select>

              {selectedCountry && (analytics?.states ?? []).length > 0 && (
                <select value={selectedState}
                  onChange={e => { setSelectedState(e.target.value); setSelectedCity(""); }}
                  style={SEL}>
                  <option value="">All States</option>
                  {analytics!.states.map(s => (
                    <option key={s.name} value={s.name}>{s.name} ({fmtNum(s.count)})</option>
                  ))}
                </select>
              )}

              {selectedState && (analytics?.cities ?? []).length > 0 && (
                <select value={selectedCity} onChange={e => setSelectedCity(e.target.value)} style={SEL}>
                  <option value="">All Cities</option>
                  {analytics!.cities.map(c => (
                    <option key={c.name} value={c.name}>{c.name} ({fmtNum(c.count)})</option>
                  ))}
                </select>
              )}

              {hasFilter && (
                <button onClick={clearFilter}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
                  style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Summary cards */}
          {analytics && (
            <div className="grid grid-cols-3 gap-4">
              {([
                { label: "Total Creators", value: analytics.summary.total, color: "var(--accent)" },
                { label: "Countries", value: analytics.summary.countries, color: "#10b981" },
                { label: "Niches", value: analytics.summary.niches, color: "#f59e0b" },
              ] as const).map(card => (
                <div key={card.label} className="rounded-xl p-4 flex items-center gap-4"
                  style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: `${card.color}1a` }}>
                    <span className="text-lg font-bold" style={{ color: card.color }}>
                      {card.label === "Total Creators" ? "👥" : card.label === "Countries" ? "🌍" : "🎯"}
                    </span>
                  </div>
                  <div>
                    <p className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
                      {fmtNum(card.value)}
                    </p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{card.label}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {loadingData && !analytics && (
            <div className="flex items-center justify-center py-20">
              <div className="flex flex-col items-center gap-3">
                <svg className="animate-spin w-6 h-6" viewBox="0 0 24 24" fill="none" style={{ color: "var(--accent)" }}>
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Loading charts…</p>
              </div>
            </div>
          )}

          {analytics && (
            <>
              {/* Country bar — global view */}
              {!selectedCountry && analytics.byCountry.length > 0 && (
                <div style={CARD}>
                  <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
                    Creators by Country
                    <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-secondary)" }}>top {analytics.byCountry.length}</span>
                  </h3>
                  <ResponsiveContainer width="100%" height={270}>
                    <BarChart data={analytics.byCountry} margin={{ top: 4, right: 8, left: 0, bottom: 64 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} angle={-45} textAnchor="end" interval={0} />
                      <YAxis tick={{ fill: "var(--text-secondary)", fontSize: 11 }} tickFormatter={fmtNum} width={48} />
                      <Tooltip {...TIP} formatter={(v: number) => [fmtNum(v), "Creators"]} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {analytics.byCountry.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* State breakdown — when country selected */}
              {selectedCountry && analytics.states.length > 0 && (
                <div style={CARD}>
                  <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
                    States in {selectedCountry}
                  </h3>
                  <ResponsiveContainer width="100%" height={Math.max(220, analytics.states.length * 30)}>
                    <BarChart data={analytics.states} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} tickFormatter={fmtNum} />
                      <YAxis type="category" dataKey="name" width={160} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                      <Tooltip {...TIP} formatter={(v: number) => [fmtNum(v), "Creators"]} />
                      <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]}
                        label={{ position: "right", fill: "var(--text-secondary)", fontSize: 11, formatter: fmtNum }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* City breakdown — when state selected */}
              {selectedState && analytics.cities.length > 0 && (
                <div style={CARD}>
                  <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
                    Cities in {selectedState}
                    <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-secondary)" }}>top {Math.min(analytics.cities.length, 30)}</span>
                  </h3>
                  <ResponsiveContainer width="100%" height={Math.max(220, Math.min(analytics.cities.length, 30) * 30)}>
                    <BarChart data={analytics.cities.slice(0, 30)} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                      <XAxis type="number" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} tickFormatter={fmtNum} />
                      <YAxis type="category" dataKey="name" width={160} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                      <Tooltip {...TIP} formatter={(v: number) => [fmtNum(v), "Creators"]} />
                      <Bar dataKey="count" fill="#10b981" radius={[0, 4, 4, 0]}
                        label={{ position: "right", fill: "var(--text-secondary)", fontSize: 11, formatter: fmtNum }} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* 2-column grid: Niches + Creator Types */}
              <div className="grid grid-cols-2 gap-5">
                {analytics.byNiche.length > 0 && (
                  <div style={CARD}>
                    <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
                      Top Niches
                      <span className="ml-2 text-xs font-normal" style={{ color: "var(--text-secondary)" }}>{analytics.byNiche.length} shown</span>
                    </h3>
                    <ResponsiveContainer width="100%" height={Math.max(220, analytics.byNiche.length * 30)}>
                      <BarChart data={analytics.byNiche} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                        <XAxis type="number" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} tickFormatter={fmtNum} />
                        <YAxis type="category" dataKey="name" width={130} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                        <Tooltip {...TIP} formatter={(v: number) => [fmtNum(v), "Creators"]} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}
                          label={{ position: "right", fill: "var(--text-secondary)", fontSize: 10, formatter: fmtNum }}>
                          {analytics.byNiche.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {analytics.byCreatorType.length > 0 && (
                  <div style={CARD}>
                    <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Creator Types</h3>
                    <ResponsiveContainer width="100%" height={Math.max(220, analytics.byCreatorType.length * 30)}>
                      <BarChart data={analytics.byCreatorType} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                        <XAxis type="number" tick={{ fill: "var(--text-secondary)", fontSize: 11 }} tickFormatter={fmtNum} />
                        <YAxis type="category" dataKey="name" width={130} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
                        <Tooltip {...TIP} formatter={(v: number) => [fmtNum(v), "Creators"]} />
                        <Bar dataKey="count" radius={[0, 4, 4, 0]}
                          label={{ position: "right", fill: "var(--text-secondary)", fontSize: 10, formatter: fmtNum }}>
                          {analytics.byCreatorType.map((_, i) => <Cell key={i} fill={COLORS[(i + 4) % COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* 2-column grid: Age Group + Gender */}
              <div className="grid grid-cols-2 gap-5">
                {analytics.byAgeGroup.length > 0 && (
                  <div style={CARD}>
                    <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Age Groups</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={analytics.byAgeGroup}
                          dataKey="count"
                          nameKey="name"
                          cx="50%" cy="50%"
                          outerRadius={105}
                          labelLine={false}
                          label={PieInnerLabel as never}
                        >
                          {analytics.byAgeGroup.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip {...TIP} formatter={(v: number) => [fmtNum(v), "Creators"]} />
                        <Legend
                          formatter={v => <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>{v}</span>}
                          iconSize={10}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}

                {analytics.byGender.length > 0 && (
                  <div style={CARD}>
                    <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>Gender Distribution</h3>
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie
                          data={analytics.byGender}
                          dataKey="count"
                          nameKey="name"
                          cx="50%" cy="50%"
                          outerRadius={105}
                          labelLine={false}
                          label={PieInnerLabel as never}
                        >
                          {analytics.byGender.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
                        </Pie>
                        <Tooltip {...TIP} formatter={(v: number) => [fmtNum(v), "Creators"]} />
                        <Legend
                          formatter={v => <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>{v}</span>}
                          iconSize={10}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}