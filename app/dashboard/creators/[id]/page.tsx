"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";

type Creator = Record<string, any>;

function fmtNum(n: string | number | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? parseInt(n) : n;
  if (isNaN(num as number)) return "—";
  if ((num as number) >= 1_000_000) return `${((num as number) / 1_000_000).toFixed(1)}M`;
  if ((num as number) >= 1_000) return `${((num as number) / 1_000).toFixed(1)}K`;
  return (num as number).toLocaleString();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <h3 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: "var(--text-secondary)" }}>{title}</h3>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className="flex items-start justify-between gap-4 py-2" style={{ borderBottom: "1px solid var(--border)" }}>
      <span className="text-sm flex-shrink-0" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="text-sm text-right break-all" style={{ color: "var(--text-primary)" }}>{value}</span>
    </div>
  );
}

function PostCard({ n, c }: { n: number; c: Creator }) {
  const link = c[`post${n}Link`];
  const likes = c[`post${n}LikesCount`];
  const comments = c[`post${n}CommentsCount`];
  const views = c[`post${n}ViewsCount`];
  const reposts = c[`post${n}RepostsCount`];
  const caption = c[`post${n}Captions`];
  const hashtags = c[`post${n}Hashtags`];
  if (!link && !likes && !views) return null;
  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      {/* Header */}
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

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2">
        {likes != null && (
          <div className="rounded-lg p-2.5 text-center" style={{ background: "var(--surface)" }}>
            <p className="text-sm font-bold" style={{ color: "#ef4444" }}>❤️ {fmtNum(likes)}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Likes</p>
          </div>
        )}
        {views != null && (
          <div className="rounded-lg p-2.5 text-center" style={{ background: "var(--surface)" }}>
            <p className="text-sm font-bold" style={{ color: "#3b82f6" }}>👁 {fmtNum(views)}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Views</p>
          </div>
        )}
        {comments != null && (
          <div className="rounded-lg p-2.5 text-center" style={{ background: "var(--surface)" }}>
            <p className="text-sm font-bold" style={{ color: "#8b5cf6" }}>💬 {fmtNum(comments)}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Comments</p>
          </div>
        )}
        {reposts != null && (
          <div className="rounded-lg p-2.5 text-center" style={{ background: "var(--surface)" }}>
            <p className="text-sm font-bold" style={{ color: "#22c55e" }}>🔁 {fmtNum(reposts)}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>Reposts</p>
          </div>
        )}
      </div>

      {/* Caption */}
        <div className="mt-2 px-2 py-1 rounded" style={{ background: "var(--surface)", color: "var(--text-primary)" }}>
      <span className="font-medium" style={{ color: "var(--text-secondary)" }}>Caption:</span>
      {caption && <p className="mt-1 line-clamp-2" style={{ color: "var(--text-secondary)" }}>{caption}</p>}
      </div>



      {/* Hashtags */}
      {hashtags && (
        <p className="text-xs line-clamp-2" style={{ color: "var(--accent)", opacity: 0.8 }}>
          {hashtags}
        </p>
      )}
    </div>
  );
}

export default function CreatorDetailPage() {
  const router = useRouter();
  const params = useParams();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllPosts, setShowAllPosts] = useState(false);

  useEffect(() => {
    fetch(`/api/creators/${params.id}`)
      .then(r => { if (r.status === 401) { router.push("/login"); return null; } return r.json(); })
      .then(d => { if (d) setCreator(d.creator); setLoading(false); });
  }, [params.id, router]);

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
      <span style={{ color: "var(--text-secondary)" }}>Loading…</span>
    </div>
  );
  if (!creator) return (
    <div className="min-h-screen flex flex-col items-center justify-center" style={{ background: "var(--background)" }}>
      <p className="mb-4">Creator not found</p>
      <button onClick={() => router.back()} style={{ color: "var(--accent)" }}>← Go back</button>
    </div>
  );

  const fullName = creator.fullName || [creator.firstName, creator.lastName].filter(Boolean).join(" ") || creator.username || "Unknown";
  const location = [creator.addressCity, creator.addressState, creator.addressCountry].filter(Boolean).join(", ");

  const postMetrics = Array.from({ length: 25 }, (_, i) => i + 1).map(n => ({
    likes:    parseInt(creator[`post${n}LikesCount`]) || 0,
    views:    parseInt(creator[`post${n}ViewsCount`]) || 0,
    comments: parseInt(creator[`post${n}CommentsCount`]) || 0,
  })).filter(p => p.likes > 0 || p.views > 0);

  const avgLikes    = postMetrics.length ? Math.round(postMetrics.reduce((s, p) => s + p.likes, 0) / postMetrics.length) : null;
  const avgViews    = postMetrics.length ? Math.round(postMetrics.reduce((s, p) => s + p.views, 0) / postMetrics.length) : null;
  const avgComments = postMetrics.length ? Math.round(postMetrics.reduce((s, p) => s + p.comments, 0) / postMetrics.length) : null;

  const postsToShow = showAllPosts ? 25 : 6;

  return (
    <div className="min-h-screen pb-16" style={{ background: "var(--background)" }}>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm mb-6" style={{ color: "var(--text-secondary)" }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4"><polyline points="15 18 9 12 15 6"/></svg>
          Back to search
        </button>

        {/* Profile header */}
        <div className="rounded-xl p-6 mb-6 flex items-start gap-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          {creator.profilePicture ? (
            <img src={creator.profilePicture} alt="" className="w-16 h-16 rounded-2xl object-cover flex-shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-2xl flex-shrink-0 flex items-center justify-center text-2xl font-bold" style={{ background: "var(--accent)", color: "white" }}>
              {(creator.username || "?").charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold">{creator.username || "—"}</h1>
              {creator.creatorSize && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
                  {creator.creatorSize}
                </span>
              )}
              {creator.collaborationStatus && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium capitalize"
                  style={{
                    background: ["open","active"].includes(creator.collaborationStatus.toLowerCase()) ? "rgba(34,197,94,0.15)" : "var(--surface-2)",
                    color: ["open","active"].includes(creator.collaborationStatus.toLowerCase()) ? "#22c55e" : "var(--text-secondary)"
                  }}>
                  {creator.collaborationStatus}
                </span>
              )}
            </div>
            {fullName !== creator.username && <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>{fullName}</p>}
            {creator.bioData && <p className="text-sm mt-3 leading-relaxed" style={{ color: "var(--text-secondary)" }}>{creator.bioData}</p>}
            <div className="flex flex-wrap gap-2 mt-3">
              {creator.nichePrimary && (
                <span className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(99,102,241,0.15)", color: "var(--accent)" }}>
                  Niche: {creator.nichePrimary}
                </span>
              )}
              {creator.nicheSecondary && (
                <span className="px-2.5 py-1 rounded-full text-xs" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                  Niche 2: {creator.nicheSecondary}
                </span>
              )}
              {creator.businessCategory && (
                <span className="px-2.5 py-1 rounded-full text-xs" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                  Category: {creator.businessCategory}
                </span>
              )}
              {creator.creatorType && (
                <span className="px-2.5 py-1 rounded-full text-xs" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                  Type: {creator.creatorType}
                </span>
              )}
              {location && (
                <span className="px-2.5 py-1 rounded-full text-xs" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                  📍 {location}
                </span>
              )}
              {creator.gender && (
                <span className="px-2.5 py-1 rounded-full text-xs capitalize" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                  Gender: {creator.gender}
                </span>
              )}
              {creator.ageGroup && (
                <span className="px-2.5 py-1 rounded-full text-xs" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                  Age Group: {creator.ageGroup}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats — removed Eng Rate */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Followers", value: fmtNum(creator.followerCount), color: "var(--accent)" },
            { label: "Avg Likes", value: fmtNum(avgLikes), color: "#ef4444" },
            { label: "Avg Views", value: fmtNum(avgViews), color: "#3b82f6" },
            { label: "Avg Comments", value: fmtNum(avgComments), color: "#8b5cf6" },
          ].map(s => (
            <div key={s.label} className="rounded-xl p-4 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
              <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Info sections — removed Video Watch Time */}
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <Section title="Contact">
            <Row label="Email" value={creator.email} />
            <Row label="Phone" value={creator.phoneNumber} />
            <Row label="Price (USD)" value={creator.priceUsd} />
          </Section>

          <Section title="Social Profiles">
            {creator.primarySocialLink && <Row label="Instagram" value={<a href={creator.primarySocialLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{creator.primarySocialLink}</a>} />}
            {creator.tiktokLink && <Row label="TikTok" value={<a href={creator.tiktokLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{creator.tiktokLink}</a>} />}
            {creator.youtubeLink && <Row label="YouTube" value={<a href={creator.youtubeLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{creator.youtubeLink}</a>} />}
            {creator.xLink && <Row label="X / Twitter" value={<a href={creator.xLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{creator.xLink}</a>} />}
            {creator.linktreeLink && <Row label="Linktree" value={<a href={creator.linktreeLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{creator.linktreeLink}</a>} />}
            {creator.otherSocialMedia && <Row label="Other" value={creator.otherSocialMedia} />}
          </Section>

          <Section title="Collaboration">
            <Row label="Status" value={creator.collaborationStatus} />
            <Row label="Top Brand" value={creator.topCollaboration} />
            <Row label="Collabs (last 25 posts)" value={creator.totalCollaborationsInRecent25} />
            <Row label="Creator Type" value={creator.creatorType} />
            <Row label="UGC Examples" value={creator.ugcExamples ? <a href={creator.ugcExamples} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>View</a> : null} />
            <Row label="Latest Post" value={creator.latestPostDate ? new Date(creator.latestPostDate).toLocaleDateString() : null} />
          </Section>

          <Section title="Profile Details">
            <Row label="Age Group" value={creator.ageGroup} />
            <Row label="Gender" value={creator.gender} />
            <Row label="Creator Size" value={creator.creatorSize} />
            <Row label="Primary Niche" value={creator.nichePrimary} />
            <Row label="Secondary Niche" value={creator.nicheSecondary} />
            <Row label="Business Category" value={creator.businessCategory} />
            <Row label="Creator Type" value={creator.creatorType} />
          </Section>
        </div>

        {(creator.combinedHashtags || creator.hashtagsLast90Days) && (
          <div className="mb-4">
            <Section title="Hashtags & Mentions">
              {creator.combinedHashtags && <Row label="All hashtags" value={<span className="text-xs break-all">{creator.combinedHashtags}</span>} />}
              {creator.hashtagsLast90Days && <Row label="Last 90 days" value={<span className="text-xs break-all">{creator.hashtagsLast90Days}</span>} />}
              {creator.combinedMentions && <Row label="Mentions" value={<span className="text-xs break-all">{creator.combinedMentions}</span>} />}
              <Row label="Hashtag count" value={creator.combinedHashtagsCount} />
              <Row label="Mention count" value={creator.combinedMentionsCount} />
            </Section>
          </div>
        )}

        {/* Posts — bigger cards, 2 col grid */}
        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
              Recent Posts ({postMetrics.length} with data)
            </h3>
            {postMetrics.length > 6 && (
              <button onClick={() => setShowAllPosts(!showAllPosts)} className="text-xs font-medium" style={{ color: "var(--accent)" }}>
                {showAllPosts ? "Show less" : "Show all 25"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: postsToShow }, (_, i) => i + 1).map(n => (
              <PostCard key={n} n={n} c={creator} />
            ))}
          </div>
          {postMetrics.length === 0 && <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No post data available</p>}
        </div>
      </div>
    </div>
  );
}