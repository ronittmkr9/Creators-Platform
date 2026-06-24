"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import toast, { Toaster } from "react-hot-toast";
import { cachedFetch } from "@/lib/client-cache";
import Sidebar from "@/components/Sidebar";

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
interface MetaResponse { countries: string[] }

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
      <Sidebar />

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