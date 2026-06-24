"use client";
// app/creators/[id]/page.tsx

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Toaster, toast } from "react-hot-toast";
import { cachedFetch, setCached, invalidateCache, invalidateCacheByPrefix } from "@/lib/client-cache";
import Sidebar from "@/components/Sidebar";

type Creator = Record<string, unknown>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: string | number | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? parseInt(n) : n;
  if (isNaN(num as number)) return "—";
  if ((num as number) >= 1_000_000) return `${((num as number) / 1_000_000).toFixed(1)}M`;
  if ((num as number) >= 1_000) return `${((num as number) / 1_000).toFixed(1)}K`;
  return (num as number).toLocaleString();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-4" style={{ color: "var(--text-secondary)" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5" style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="text-sm flex-shrink-0" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="text-sm text-right break-all" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function StatBox({ emoji, color, label, value }: { emoji: string; color: string; label: string; value: string }) {
  return (
    <div className="rounded-lg p-2.5 text-center" style={{ background: "var(--surface)" }}>
      <p className="text-sm font-bold" style={{ color }}>{emoji} {value}</p>
      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{label}</p>
    </div>
  );
}

function PostCard({ n, c }: { n: number; c: Creator }) {
  const link     = c[`post${n}Link`] as string | undefined;
  const likes    = c[`post${n}LikesCount`];
  const comments = c[`post${n}CommentsCount`];
  const views    = c[`post${n}ViewsCount`];
  const reposts  = c[`post${n}RepostsCount`];
  const caption  = c[`post${n}Captions`] as string | undefined;
  const hashtags = c[`post${n}Hashtags`] as string | undefined;
  if (!link && !likes && !views) return null;
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Post {n}</span>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer"
            className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
            View ↗
          </a>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {likes    != null && <StatBox emoji="❤️" color="#ef4444" label="Likes"    value={fmtNum(likes as number)} />}
        {views    != null && <StatBox emoji="👁"  color="#3b82f6" label="Views"    value={fmtNum(views as number)} />}
        {comments != null && <StatBox emoji="💬" color="#8b5cf6" label="Comments" value={fmtNum(comments as number)} />}
        {reposts  != null && <StatBox emoji="🔁" color="#22c55e" label="Reposts"  value={fmtNum(reposts as number)} />}
      </div>
      {caption && (
        <div className="mt-1 px-3 py-2 rounded-lg" style={{ background: "var(--surface)" }}>
          <p className="text-xs line-clamp-2" style={{ color: "var(--text-secondary)" }}>{caption}</p>
        </div>
      )}
      {hashtags && (
        <p className="text-xs line-clamp-2" style={{ color: "var(--accent)", opacity: 0.8 }}>{hashtags}</p>
      )}
    </div>
  );
}

// ─── Admin Edit Panel ─────────────────────────────────────────────────────────

const ADMIN_EDIT_GROUPS: { section: string; icon: string; fields: { key: string; label: string; type?: string; textarea?: boolean }[] }[] = [
  {
    section: "Identity",
    icon: "👤",
    fields: [
      { key: "username",  label: "Username" },
      { key: "firstName", label: "First Name" },
      { key: "lastName",  label: "Last Name" },
      { key: "fullName",  label: "Full Name" },
      { key: "gender",    label: "Gender" },
      { key: "ageGroup",  label: "Age Group" },
      { key: "age",       label: "Age", type: "number" },
    ],
  },
  {
    section: "Contact",
    icon: "📬",
    fields: [
      { key: "email",       label: "Email" },
      { key: "phoneNumber", label: "Phone Number" },
      { key: "priceUsd",    label: "Price (USD)" },
    ],
  },
  {
    section: "Social Links",
    icon: "🔗",
    fields: [
      { key: "primarySocialLink", label: "Instagram" },
      { key: "tiktokLink",        label: "TikTok" },
      { key: "youtubeLink",       label: "YouTube" },
      { key: "xLink",             label: "X / Twitter" },
      { key: "linktreeLink",      label: "Linktree" },
      { key: "otherSocialMedia",  label: "Other Social" },
    ],
  },
  {
    section: "Profile",
    icon: "📊",
    fields: [
      { key: "nichePrimary",        label: "Primary Niche" },
      { key: "nicheSecondary",      label: "Secondary Niche" },
      { key: "creatorType",         label: "Creator Type" },
      { key: "creatorSize",         label: "Creator Size" },
      { key: "businessCategory",    label: "Business Category" },
      { key: "collaborationStatus", label: "Collab Status" },
      { key: "topCollaboration",    label: "Top Brand" },
      { key: "followerCount",       label: "Follower Count", type: "number" },
      { key: "profilePicture",      label: "Profile Picture URL" },
    ],
  },
  {
    section: "Location",
    icon: "📍",
    fields: [
      { key: "addressCity",    label: "City" },
      { key: "addressState",   label: "State" },
      { key: "addressCountry", label: "Country" },
      { key: "addressZip",     label: "ZIP" },
    ],
  },
  {
    section: "Content",
    icon: "✍️",
    fields: [
      { key: "bioData",     label: "Bio", textarea: true },
      { key: "ugcExamples", label: "UGC Examples URL" },
    ],
  },
];

interface AdminEditPanelProps {
  creator: Creator;
  onSaved: (updated: Creator) => void;
}

function AdminEditPanel({ creator, onSaved }: AdminEditPanelProps) {
  const [open, setOpen]           = useState(false);
  const [edits, setEdits]         = useState<Record<string, string>>({});
  const [saving, setSaving]       = useState(false);
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [activeSection, setActiveSection] = useState<string>(ADMIN_EDIT_GROUPS[0].section);

  useEffect(() => {
    const initial: Record<string, string> = {};
    ADMIN_EDIT_GROUPS.forEach((g) =>
      g.fields.forEach((f) => {
        initial[f.key] = creator[f.key] != null ? String(creator[f.key]) : "";
      }),
    );
    setEdits(initial);
    setDirtyKeys(new Set());
  }, [creator]);

  const handleChange = (key: string, value: string) => {
    const original = creator[key] != null ? String(creator[key]) : "";
    setEdits((prev) => ({ ...prev, [key]: value }));
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      if (value !== original) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleSave = async () => {
    if (dirtyKeys.size === 0) {
      toast("No changes to save", { icon: "ℹ️" });
      return;
    }

    setSaving(true);

    const changed: Record<string, unknown> = {};
    ADMIN_EDIT_GROUPS.forEach((g) =>
      g.fields.forEach((f) => {
        if (!dirtyKeys.has(f.key)) return;
        changed[f.key] =
          f.type === "number"
            ? edits[f.key] === "" ? null : Number(edits[f.key])
            : edits[f.key] === "" ? null : edits[f.key];
      }),
    );

    const saveToast = toast.loading(`Saving ${Object.keys(changed).length} field${Object.keys(changed).length !== 1 ? "s" : ""}…`);

    try {
      const res = await fetch(`/api/creators/${encodeURIComponent(creator.username as string)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changed),
      });

      if (!res.ok) {
        let errMsg = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          errMsg = data.error ?? errMsg;
        } catch { /* body not JSON */ }
        throw new Error(errMsg);
      }

      const updated = { ...creator, ...changed };
      setCached(`creator:${creator.username}`, { creator: updated });
      invalidateCache("creators");

      onSaved(updated);
      setDirtyKeys(new Set());
      toast.success(`Saved ${Object.keys(changed).length} field${Object.keys(changed).length !== 1 ? "s" : ""}`, { id: saveToast });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      toast.error(msg, { id: saveToast });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    const initial: Record<string, string> = {};
    ADMIN_EDIT_GROUPS.forEach((g) =>
      g.fields.forEach((f) => {
        initial[f.key] = creator[f.key] != null ? String(creator[f.key]) : "";
      }),
    );
    setEdits(initial);
    setDirtyKeys(new Set());
    toast("Changes discarded", { icon: "↩️" });
  };

  const activeGroup = ADMIN_EDIT_GROUPS.find((g) => g.section === activeSection)!;
  const dirtyInSection = (section: string) =>
    ADMIN_EDIT_GROUPS.find((g) => g.section === section)?.fields.some((f) => dirtyKeys.has(f.key));

  return (
    <div className="mb-8 rounded-xl overflow-hidden shadow-lg" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>

      {/* ── Header toggle ── */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-6 py-4 text-left transition-colors hover:bg-opacity-5"
        style={{ borderBottom: open ? "1px solid var(--border)" : "none", background: "var(--surface)" }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
            style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)" }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Admin Controls</span>
            {dirtyKeys.size > 0 && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: "rgba(251,191,36,0.15)", color: "#f59e0b" }}>
                {dirtyKeys.size} unsaved
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {open && dirtyKeys.size > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-lg"
              style={{ background: "rgba(251,191,36,0.08)", color: "#f59e0b", border: "1px solid rgba(251,191,36,0.2)" }}>
              Unsaved changes
            </span>
          )}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`w-4 h-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            style={{ color: "var(--text-secondary)" }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {open && (
        <div className="flex flex-col md:flex-row" style={{ minHeight: 500, background: "var(--surface)" }}>
          {/* ── Left nav ── */}
          <div className="md:w-48 flex-shrink-0 border-r flex flex-row md:flex-col gap-0.5 overflow-x-auto md:overflow-y-auto p-2 md:p-3"
            style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            {ADMIN_EDIT_GROUPS.map((g) => {
              const isActive = g.section === activeSection;
              const isDirty  = dirtyInSection(g.section);
              return (
                <button
                  key={g.section}
                  onClick={() => setActiveSection(g.section)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-all rounded-lg whitespace-nowrap md:whitespace-normal"
                  style={{
                    background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                    color: isActive ? "var(--accent)" : "var(--text-secondary)",
                    fontWeight: isActive ? 600 : 400,
                    border: isActive ? "1px solid rgba(99,102,241,0.2)" : "1px solid transparent",
                  }}
                >
                  <span className="text-base">{g.icon}</span>
                  <span className="flex-1 truncate">{g.section}</span>
                  {isDirty && (
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: "#f59e0b" }} />
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Right field area ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <div className="flex items-center gap-2 mb-6 pb-4" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="text-xl">{activeGroup.icon}</span>
                <h4 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {activeGroup.section}
                </h4>
                {activeGroup.fields.filter((f) => dirtyKeys.has(f.key)).length > 0 && (
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full"
                    style={{ background: "rgba(251,191,36,0.12)", color: "#f59e0b" }}>
                    {activeGroup.fields.filter((f) => dirtyKeys.has(f.key)).length} edited
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {activeGroup.fields.map((f) => {
                  const isDirty = dirtyKeys.has(f.key);
                  return (
                    <div key={f.key} className={f.textarea ? "lg:col-span-2" : ""}>
                      <label className="flex items-center gap-1.5 text-xs mb-1.5 font-medium"
                        style={{ color: isDirty ? "#f59e0b" : "var(--text-secondary)" }}>
                        {f.label}
                        {isDirty && (
                          <span className="w-1.5 h-1.5 rounded-full inline-block"
                            style={{ background: "#f59e0b" }} />
                        )}
                      </label>
                      {f.textarea ? (
                        <textarea
                          rows={4}
                          value={edits[f.key] ?? ""}
                          onChange={(e) => handleChange(f.key, e.target.value)}
                          className="w-full rounded-lg px-3.5 py-2.5 text-sm resize-none focus:outline-none transition-all"
                          style={{
                            background: "var(--surface-2)",
                            border: isDirty
                              ? "2px solid rgba(251,191,36,0.5)"
                              : "1px solid var(--border)",
                            color: "var(--text-primary)",
                            boxShadow: isDirty ? "0 0 0 3px rgba(251,191,36,0.06)" : "none",
                          }}
                        />
                      ) : (
                        <input
                          type={f.type === "number" ? "number" : "text"}
                          value={edits[f.key] ?? ""}
                          onChange={(e) => handleChange(f.key, e.target.value)}
                          className="w-full rounded-lg px-3.5 py-2.5 text-sm focus:outline-none transition-all"
                          style={{
                            background: "var(--surface-2)",
                            border: isDirty
                              ? "2px solid rgba(251,191,36,0.5)"
                              : "1px solid var(--border)",
                            color: "var(--text-primary)",
                            boxShadow: isDirty ? "0 0 0 3px rgba(251,191,36,0.06)" : "none",
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* ── Sticky footer bar ── */}
            <div className="flex-shrink-0 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-4"
              style={{ borderTop: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                {dirtyKeys.size > 0
                  ? `${dirtyKeys.size} field${dirtyKeys.size !== 1 ? "s" : ""} modified`
                  : "No changes to save"}
              </span>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {dirtyKeys.size > 0 && (
                  <button
                    onClick={handleReset}
                    disabled={saving}
                    className="flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40 hover:opacity-80"
                    style={{ color: "var(--text-secondary)", border: "1px solid var(--border)", background: "transparent" }}
                  >
                    Discard
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving || dirtyKeys.size === 0}
                  className="flex-1 sm:flex-none px-6 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-all hover:opacity-90"
                  style={{
                    background: dirtyKeys.size === 0 ? "var(--surface-2)" : "var(--accent)",
                    color: dirtyKeys.size === 0 ? "var(--text-secondary)" : "#fff",
                    cursor: saving || dirtyKeys.size === 0 ? "not-allowed" : "pointer",
                    opacity: dirtyKeys.size === 0 ? 0.5 : 1,
                  }}
                >
                  {saving ? (
                    <>
                      <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                        <path d="M12 2a10 10 0 0 1 10 10" />
                      </svg>
                      Saving…
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3.5 h-3.5">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                        <polyline points="17 21 17 13 7 13 7 21" />
                        <polyline points="7 3 7 8 15 8" />
                      </svg>
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Notes Section ────────────────────────────────────────────────────────────

const CAMPAIGN_NICHES = [
  "Fashion", "Beauty", "Fitness", "Food", "Travel", "Tech", "Gaming",
  "Lifestyle", "Health", "Finance", "Education", "Music", "Sports",
  "Parenting", "Home & Decor", "Business", "Comedy", "Art", "Automotive",
];

function NotesSection({ creatorId }: { creatorId: string }) {
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [campaignNiches, setCampaignNiches] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`/api/creators/${creatorId}/notes`)
      .then(r => r.json())
      .then(({ note: n }) => {
        if (n) {
          setIsOnboarded(n.isOnboarded ?? false);
          setCampaignNiches(n.campaignNiches ?? []);
          setNote(n.note ?? "");
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [creatorId]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/creators/${creatorId}/notes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isOnboarded, campaignNiches, note }),
      });
      if (!res.ok) throw new Error();
      invalidateCacheByPrefix("notes:");
      toast.success("Notes saved successfully");
    } catch {
      toast.error("Failed to save notes");
    } finally {
      setSaving(false);
    }
  }

  function toggleNiche(n: string) {
    setCampaignNiches(prev => prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]);
  }

  if (!loaded) return null;

  return (
    <div className="rounded-xl p-6 mt-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex items-center gap-3 mb-6 pb-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
          style={{ background: "rgba(99,102,241,0.12)", color: "var(--accent)" }}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
        </div>
        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          Creator Notes
        </h3>
        <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
          Internal
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Onboarded Status */}
        <div className="lg:col-span-1">
          <div className="p-4 rounded-lg" style={{ background: "var(--surface-2)" }}>
            <p className="text-xs font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Onboarding Status</p>
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                {isOnboarded ? "✅ Onboarded" : "⏳ Pending"}
              </span>
              <button
                onClick={() => setIsOnboarded(!isOnboarded)}
                className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0"
                style={{ background: isOnboarded ? "var(--accent)" : "var(--surface-2)" }}
              >
                <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform"
                  style={{ left: isOnboarded ? "1.375rem" : "0.125rem" }} />
              </button>
            </div>
          </div>
        </div>

        {/* Campaign Niches */}
        <div className="lg:col-span-2">
          <p className="text-xs font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Campaign Niches</p>
          <div className="flex flex-wrap gap-2">
            {CAMPAIGN_NICHES.map(n => (
              <button
                key={n}
                onClick={() => toggleNiche(n)}
                className="text-xs px-3 py-1.5 rounded-full transition-all hover:scale-105"
                style={{
                  background: campaignNiches.includes(n) ? "var(--accent)" : "var(--surface-2)",
                  color: campaignNiches.includes(n) ? "#fff" : "var(--text-secondary)",
                  border: `1px solid ${campaignNiches.includes(n) ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Note */}
        <div className="lg:col-span-3">
          <p className="text-xs font-medium mb-3" style={{ color: "var(--text-secondary)" }}>Private Note</p>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            maxLength={2000}
            rows={4}
            placeholder="Add internal notes about this creator..."
            className="w-full rounded-lg px-4 py-3 text-sm resize-none focus:outline-none transition-all"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              color: "var(--text-primary)",
              outline: "none",
            }}
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {note.length}/2000 characters
            </span>
            <button
              onClick={save}
              disabled={saving}
              className="px-6 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90 disabled:opacity-60"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              {saving ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  Saving…
                </span>
              ) : (
                "Save Notes"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CreatorDetailPage() {
  const router = useRouter();
  const params = useParams();

  const [creator, setCreator]           = useState<Creator | null>(null);
  const [loading, setLoading]           = useState(true);
  const [isAdmin, setIsAdmin]           = useState(false);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const fetchedRef = useRef(false);

  const username = decodeURIComponent(params.id as string);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    cachedFetch(
      `creator:${username}`,
      () =>
        fetch(`/api/creators/${encodeURIComponent(params.id as string)}`).then(async (r) => {
          if (r.status === 401) { router.push("/login"); return null; }
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
      10 * 60 * 1000,
    )
      .then((d: unknown) => {
        const data = d as { creator: Creator } | null;
        if (data) setCreator(data.creator);
        setLoading(false);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to load creator";
        toast.error(msg);
        setLoading(false);
      });

    cachedFetch(
      "auth/me",
      () =>
        fetch("/api/auth/me").then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
      30 * 60 * 1000,
    )
      .then((me: unknown) => {
        const data = me as { user?: { role?: string } } | null;
        if (data?.user?.role === "ADMIN") setIsAdmin(true);
      })
      .catch(() => { /* non-fatal — admin panel just won't show */ });
  }, [username, params.id, router]);

  const handleAdminSave = useCallback(
    (updated: Creator) => setCreator(updated),
    [],
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
        <div className="flex flex-col items-center gap-3">
          <svg className="w-6 h-6 animate-spin" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
            <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
            <path d="M12 2a10 10 0 0 1 10 10" />
          </svg>
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>Loading creator…</span>
        </div>
      </div>
    );
  }

  if (!creator) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ background: "var(--background)" }}>
        <p style={{ color: "var(--text-primary)" }}>Creator not found</p>
        <button onClick={() => router.back()} style={{ color: "var(--accent)" }}>← Go back</button>
      </div>
    );
  }

  const fullName = (creator.fullName as string)
    || [(creator.firstName as string), (creator.lastName as string)].filter(Boolean).join(" ")
    || (creator.username as string)
    || "Unknown";
  const location = [(creator.addressCity as string), (creator.addressState as string), (creator.addressCountry as string)]
    .filter(Boolean).join(", ");

  const postMetrics = Array.from({ length: 25 }, (_, i) => i + 1)
    .map((n) => ({
      likes:    parseInt(creator[`post${n}LikesCount`] as string) || 0,
      views:    parseInt(creator[`post${n}ViewsCount`] as string) || 0,
      comments: parseInt(creator[`post${n}CommentsCount`] as string) || 0,
    }))
    .filter((p) => p.likes > 0 || p.views > 0);

  const avg = (key: "likes" | "views" | "comments") =>
    postMetrics.length
      ? Math.round(postMetrics.reduce((s, p) => s + p[key], 0) / postMetrics.length)
      : null;

  const postsToShow = showAllPosts ? 25 : 6;

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--background)" }}>
      <Toaster
        position="bottom-center"
        toastOptions={{
          duration: 3500,
          style: {
            background: "var(--surface)",
            color: "var(--text-primary)",
            border: "1px solid var(--border)",
            borderRadius: "9999px",
            fontSize: "0.8125rem",
            fontWeight: 500,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            padding: "10px 18px",
          },
          success: {
            iconTheme: { primary: "#22c55e", secondary: "transparent" },
          },
          error: {
            iconTheme: { primary: "#ef4444", secondary: "transparent" },
            duration: 5000,
          },
          loading: {
            iconTheme: { primary: "var(--accent)", secondary: "transparent" },
          },
        }}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 0.7s linear infinite; }
      `}</style>

      <Sidebar />

      <main className="flex-1 overflow-y-auto pb-16">
        <div className="max-w-5xl mx-auto px-6 py-8">

          {/* Back */}
          <button onClick={() => router.back()}
            className="flex items-center gap-2 text-sm mb-6 transition-colors hover:opacity-70"
            style={{ color: "var(--text-secondary)" }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </button>

          {/* Admin edit panel */}
          {isAdmin && <AdminEditPanel creator={creator} onSaved={handleAdminSave} />}

          {/* Profile header */}
          <div className="rounded-xl p-6 mb-6 flex flex-col sm:flex-row items-start gap-5"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            {creator.profilePicture ? (
              <img
                src={creator.profilePicture as string}
                alt=""
                className="w-20 h-20 rounded-2xl object-cover flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl flex-shrink-0 flex items-center justify-center text-3xl font-bold"
                style={{ background: "var(--accent)", color: "white" }}>
                {((creator.username as string) || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-semibold">{(creator.username as string) || "—"}</h1>
                {creator.creatorSize && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium"
                    style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
                    {creator.creatorSize as string}
                  </span>
                )}
                {creator.collaborationStatus && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-medium capitalize"
                    style={{
                      background: ["open", "active"].includes((creator.collaborationStatus as string).toLowerCase())
                        ? "rgba(34,197,94,0.15)" : "var(--surface-2)",
                      color: ["open", "active"].includes((creator.collaborationStatus as string).toLowerCase())
                        ? "#22c55e" : "var(--text-secondary)",
                    }}>
                    {creator.collaborationStatus as string}
                  </span>
                )}
              </div>
              {fullName !== creator.username && (
                <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>{fullName}</p>
              )}
              {creator.bioData && (
                <p className="text-sm mt-3 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {creator.bioData as string}
                </p>
              )}
              <div className="flex flex-wrap gap-2 mt-3">
                {creator.nichePrimary && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium"
                    style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
                    #{creator.nichePrimary as string}
                  </span>
                )}
                {creator.nicheSecondary && (
                  <span className="px-2.5 py-1 rounded-full text-xs"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                    #{creator.nicheSecondary as string}
                  </span>
                )}
                {creator.businessCategory && (
                  <span className="px-2.5 py-1 rounded-full text-xs"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                    {creator.businessCategory as string}
                  </span>
                )}
                {creator.creatorType && (
                  <span className="px-2.5 py-1 rounded-full text-xs"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                    {creator.creatorType as string}
                  </span>
                )}
                {location && (
                  <span className="px-2.5 py-1 rounded-full text-xs"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                    📍 {location}
                  </span>
                )}
                {creator.gender && (
                  <span className="px-2.5 py-1 rounded-full text-xs capitalize"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                    {creator.gender as string}
                  </span>
                )}
                {creator.ageGroup && (
                  <span className="px-2.5 py-1 rounded-full text-xs"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                    {creator.ageGroup as string}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {[
              { label: "Followers",    value: fmtNum(creator.followerCount as number), color: "var(--accent)" },
              { label: "Avg Likes",    value: fmtNum(avg("likes")),                    color: "#ef4444" },
              { label: "Avg Views",    value: fmtNum(avg("views")),                    color: "#3b82f6" },
              { label: "Avg Comments", value: fmtNum(avg("comments")),                 color: "#8b5cf6" },
            ].map((s) => (
              <div key={s.label} className="rounded-xl p-4 text-center"
                style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Info sections */}
          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <Section title="Contact">
              <Row label="Email"       value={creator.email as string} />
              <Row label="Phone"       value={creator.phoneNumber as string} />
              <Row label="Price (USD)" value={creator.priceUsd as string} />
            </Section>

            <Section title="Social Profiles">
              {creator.primarySocialLink && (
                <Row label="Instagram" value={
                  <a href={creator.primarySocialLink as string} target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--accent)" }}>{creator.primarySocialLink as string}</a>
                } />
              )}
              {creator.tiktokLink && (
                <Row label="TikTok" value={
                  <a href={creator.tiktokLink as string} target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--accent)" }}>{creator.tiktokLink as string}</a>
                } />
              )}
              {creator.youtubeLink && (
                <Row label="YouTube" value={
                  <a href={creator.youtubeLink as string} target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--accent)" }}>{creator.youtubeLink as string}</a>
                } />
              )}
              {creator.xLink && (
                <Row label="X / Twitter" value={
                  <a href={creator.xLink as string} target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--accent)" }}>{creator.xLink as string}</a>
                } />
              )}
              {creator.linktreeLink && (
                <Row label="Linktree" value={
                  <a href={creator.linktreeLink as string} target="_blank" rel="noopener noreferrer"
                    style={{ color: "var(--accent)" }}>{creator.linktreeLink as string}</a>
                } />
              )}
              {creator.otherSocialMedia && <Row label="Other" value={creator.otherSocialMedia as string} />}
            </Section>

            <Section title="Collaboration">
              <Row label="Status"                  value={creator.collaborationStatus as string} />
              <Row label="Top Brand"               value={creator.topCollaboration as string} />
              <Row label="Collabs (last 25 posts)" value={creator.totalCollaborationsInRecent25 as number} />
              <Row label="Creator Type"            value={creator.creatorType as string} />
              <Row label="UGC Examples"            value={
                creator.ugcExamples
                  ? <a href={creator.ugcExamples as string} target="_blank" rel="noopener noreferrer"
                      style={{ color: "var(--accent)" }}>View</a>
                  : null
              } />
              <Row label="Latest Post" value={
                creator.latestPostDate
                  ? new Date(creator.latestPostDate as string).toLocaleDateString()
                  : null
              } />
            </Section>

            <Section title="Profile Details">
              <Row label="Age Group"         value={creator.ageGroup as string} />
              <Row label="Gender"            value={creator.gender as string} />
              <Row label="Creator Size"      value={creator.creatorSize as string} />
              <Row label="Primary Niche"     value={creator.nichePrimary as string} />
              <Row label="Secondary Niche"   value={creator.nicheSecondary as string} />
              <Row label="Business Category" value={creator.businessCategory as string} />
              <Row label="Creator Type"      value={creator.creatorType as string} />
            </Section>
          </div>

          {(creator.combinedHashtags || creator.hashtagsLast90Days) && (
            <div className="mb-6">
              <Section title="Hashtags & Mentions">
                {creator.combinedHashtags && (
                  <Row label="All hashtags" value={<span className="text-xs break-all">{creator.combinedHashtags as string}</span>} />
                )}
                {creator.hashtagsLast90Days && (
                  <Row label="Last 90 days" value={<span className="text-xs break-all">{creator.hashtagsLast90Days as string}</span>} />
                )}
                {creator.combinedMentions && (
                  <Row label="Mentions" value={<span className="text-xs break-all">{creator.combinedMentions as string}</span>} />
                )}
                <Row label="Hashtag count" value={creator.combinedHashtagsCount as number} />
                <Row label="Mention count" value={creator.combinedMentionsCount as number} />
              </Section>
            </div>
          )}

          {/* Posts */}
          <div className="rounded-xl p-6" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                  Recent Posts
                </h3>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                  {postMetrics.length} with data
                </span>
              </div>
              {postMetrics.length > 6 && (
                <button onClick={() => setShowAllPosts(!showAllPosts)}
                  className="text-xs font-medium transition-colors hover:opacity-70" style={{ color: "var(--accent)" }}>
                  {showAllPosts ? "Show less" : "Show all 25"}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: postsToShow }, (_, i) => i + 1).map((n) => (
                <PostCard key={n} n={n} c={creator} />
              ))}
            </div>
            {postMetrics.length === 0 && (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No post data available</p>
            )}
          </div>

          {/* Notes */}
          <NotesSection creatorId={params.id as string} />

        </div>
      </main>
    </div>
  );
}