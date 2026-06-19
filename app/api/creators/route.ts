// app/api/creators/route.ts
// GET — searches creators with full keyword sentence splitting + all structured filters
//
// LOCATION RANKING:
// When a `city` filter is provided, results are ordered so that creators in the
// exact requested city appear first, followed by other creators in the same
// state, followed by everything else that still matches all other filters.
// This only activates when `city` is set — without it, sorting is unaffected.

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";
import { z } from "zod";

const searchSchema = z.object({
  q:            z.string().optional(),
  username:     z.string().optional(),
  fullName:     z.string().optional(),
  niche:        z.string().optional(),
  gender:       z.string().optional(),
  ageGroup:     z.string().optional(),
  country:      z.string().optional(),
  state:        z.string().optional(),
  city:         z.string().optional(),
  creatorSize:  z.string().optional(),
  creatorType:  z.string().optional(),
  collabStatus: z.string().optional(),
  followersMin: z.coerce.number().optional(),
  followersMax: z.coerce.number().optional(),
  hasEmail:     z.enum(["true", "false"]).optional(),
  hasTiktok:    z.enum(["true", "false"]).optional(),
  hasYoutube:   z.enum(["true", "false"]).optional(),
  page:         z.coerce.number().min(1).default(1),
  pageSize:     z.coerce.number().min(1).max(100).default(50),
  sortBy:       z.enum(["followerCount", "lastUpdated"]).default("followerCount"),
  sortOrder:    z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Server-side cache for search results.
 * Keyed by the full query string so every unique filter combo is cached separately.
 */
const SEARCH_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes server-side
const searchCache = new Map<string, { data: unknown; expires: number }>();

function getCacheKey(params: URLSearchParams): string {
  const sorted = new URLSearchParams([...params.entries()].sort());
  return sorted.toString();
}

/**
 * Splits a free-text sentence into individual keywords (min 2 chars, deduped).
 * ALL keywords must match (AND), each across ALL searchable columns (OR within).
 * This is what makes full natural-language sentences work — every meaningful
 * word in the sentence narrows the result set, while structured filters
 * extracted by the client (niche, location, follower range, etc.) are sent
 * as separate params and applied as precise, indexed-friendly conditions
 * rather than fuzzy text matches.
 */
function buildKeywordConditions(
  q: string,
  startIndex: number,
): { sql: string; values: unknown[]; nextIndex: number } {
  const keywords = [
    ...new Set(
      q
        .toLowerCase()
        .split(/[\s,]+/)
        .map((w) => w.replace(/[^a-z0-9@._#-]/g, ""))
        .filter((w) => w.length >= 2),
    ),
  ];

  if (keywords.length === 0) return { sql: "", values: [], nextIndex: startIndex };

  const values: unknown[] = [];
  let i = startIndex;
  const blocks: string[] = [];

  for (const kw of keywords) {
    blocks.push(`(
      username              ILIKE $${i} OR
      full_name             ILIKE $${i} OR
      first_name            ILIKE $${i} OR
      last_name             ILIKE $${i} OR
      niche_primary         ILIKE $${i} OR
      niche_secondary       ILIKE $${i} OR
      bio_data              ILIKE $${i} OR
      address_country       ILIKE $${i} OR
      address_state         ILIKE $${i} OR
      address_city          ILIKE $${i} OR
      combined_hashtags     ILIKE $${i} OR
      combined_mentions     ILIKE $${i} OR
      hashtags_last_90_days ILIKE $${i} OR
      mentions_last_90_days ILIKE $${i} OR
      business_category     ILIKE $${i} OR
      creator_type          ILIKE $${i} OR
      collaboration_status  ILIKE $${i} OR
      gender                ILIKE $${i} OR
      age_group             ILIKE $${i} OR
      creator_size          ILIKE $${i} OR
      top_collaboration     ILIKE $${i} OR
      email                 ILIKE $${i}
    )`);
    values.push(`%${kw}%`);
    i++;
  }

  return { sql: blocks.join(" AND "), values, nextIndex: i };
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);

  // ── Server-side cache check ────────────────────────────────────────────────
  const cacheKey = getCacheKey(searchParams);
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data);
  }

  const parsed = searchSchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });

  const {
    q, username, fullName, niche, gender, ageGroup,
    country, state, city, creatorSize, creatorType, collabStatus,
    followersMin, followersMax, hasEmail, hasTiktok, hasYoutube,
    page, pageSize, sortBy, sortOrder,
  } = parsed.data;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  let stateParamIndex: number | null = null;

  // ── Free-text keyword search (full sentence support)
  if (q && q.trim()) {
    const kw = buildKeywordConditions(q, i);
    if (kw.sql) {
      conditions.push(kw.sql);
      values.push(...kw.values);
      i = kw.nextIndex;
    }
  }

  // ── Structured filters
  if (username)     { conditions.push(`username ILIKE $${i}`);                                        values.push(`%${username}%`);    i++; }
  if (fullName)     { conditions.push(`full_name ILIKE $${i}`);                                       values.push(`%${fullName}%`);    i++; }
  if (niche)        { conditions.push(`(niche_primary ILIKE $${i} OR niche_secondary ILIKE $${i})`); values.push(`%${niche}%`);       i++; }
  if (gender)       { conditions.push(`gender ILIKE $${i}`);                                          values.push(gender);             i++; }
  if (ageGroup)     { conditions.push(`age_group = $${i}`);                                           values.push(ageGroup);           i++; }
  if (country)      { conditions.push(`address_country ILIKE $${i}`);                                 values.push(`%${country}%`);     i++; }
  if (state)        { conditions.push(`address_state ILIKE $${i}`);                                   values.push(`%${state}%`);       stateParamIndex = i; i++; }
  // NOTE: city is intentionally NOT added as a hard WHERE filter on its own.
  // It's handled below in the Location ranking block — either it rides along
  // with the `state` condition above (city only affects ORDER BY), or, if no
  // state was given, it widens the WHERE clause to "same state as city" OR
  // "exact city match" so the fallback tier is geographically correct.
  if (creatorSize)  { conditions.push(`creator_size ILIKE $${i}`);                                    values.push(creatorSize);        i++; }
  if (creatorType)  { conditions.push(`creator_type ILIKE $${i}`);                                    values.push(`%${creatorType}%`); i++; }
  if (collabStatus) { conditions.push(`collaboration_status ILIKE $${i}`);                            values.push(`%${collabStatus}%`); i++; }
  if (followersMin !== undefined) { conditions.push(`follower_count >= $${i}`); values.push(followersMin); i++; }
  if (followersMax !== undefined) { conditions.push(`follower_count <= $${i}`); values.push(followersMax); i++; }

  // ── Boolean presence filters (both true AND false handled for all three)
  if (hasEmail   === "true")  conditions.push(`email IS NOT NULL`);
  if (hasEmail   === "false") conditions.push(`email IS NULL`);
  if (hasTiktok  === "true")  conditions.push(`tiktok_link IS NOT NULL`);
  if (hasTiktok  === "false") conditions.push(`tiktok_link IS NULL`);
  if (hasYoutube === "true")  conditions.push(`youtube_link IS NOT NULL`);
  if (hasYoutube === "false") conditions.push(`youtube_link IS NULL`);

  // ── Location ranking
  // If a city was requested, exact-city matches should rank first, with
  // other creators from the same state following as a fallback tier.
  //
  // - If `state` is already a filter, the WHERE clause already constrains to
  //   that state, so city only needs to affect ORDER BY (no extra condition).
  // - If `state` is NOT given, we resolve it via a correlated subquery so the
  //   "same state" fallback still works without the client knowing the state name.
  let cityParamIndex: number | null = null;

  if (city) {
    cityParamIndex = i;
    values.push(`%${city}%`);
    i++;

    if (!stateParamIndex) {
      // No state filter given — widen WHERE to "same state as the requested
      // city" OR exact city match, so fallback tier is geographically correct.
      conditions.push(`
        (
          address_state = (
            SELECT address_state FROM bronze.creators
            WHERE address_city ILIKE $${cityParamIndex}
            LIMIT 1
          )
          OR address_city ILIKE $${cityParamIndex}
        )
      `);
    }
    // If stateParamIndex IS set, the existing `address_state ILIKE $stateParamIndex`
    // condition already constrains results to that state — city is ranking-only.
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sortColMap: Record<string, string> = {
    followerCount: "follower_count",
    lastUpdated:   "last_updated",
  };
  const orderCol = sortColMap[sortBy] ?? "follower_count";
  const orderDir = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const skip = (page - 1) * pageSize;

  // location_rank: 0 = exact city match, 1 = everything else returned by the
  // WHERE clause (same state / same country fallback), used as the PRIMARY
  // sort key only when a city was requested. Falls back to the user's chosen
  // sort (followers/last-updated) within each rank tier.
  const locationRankExpr = cityParamIndex
    ? `CASE WHEN address_city ILIKE $${cityParamIndex} THEN 0 ELSE 1 END`
    : `0`;

  const orderByClause = cityParamIndex
    ? `location_rank ASC, ${orderCol} ${orderDir} NULLS LAST`
    : `${orderCol} ${orderDir} NULLS LAST`;

  // Single CTE — data + count in one round-trip
  const combinedQuery = `
    WITH deduped AS (
      SELECT DISTINCT ON (LOWER(username))
        pk, username, full_name, first_name, last_name,
        niche_primary, niche_secondary, follower_count,
        address_country, address_state, address_city, gender, age_group,
        creator_size, profile_picture, primary_social_link,
        tiktok_link, youtube_link, email, collaboration_status,
        latest_post_date, last_updated, total_collaborations_in_recent_25_posts,
        ${locationRankExpr} AS location_rank
      FROM bronze.creators
      ${whereClause}
      ORDER BY
        LOWER(username),
        COALESCE(analyzed_date, latest_post_date, scraped_date) DESC NULLS LAST
    ),
    total_count AS (
      SELECT COUNT(*) AS count FROM deduped
    ),
    paged AS (
      SELECT * FROM deduped
      ORDER BY ${orderByClause}
      LIMIT $${i} OFFSET $${i + 1}
    )
    SELECT
      paged.*,
      total_count.count AS total_count
    FROM paged
    CROSS JOIN total_count
  `;

  const rows = await prisma.$queryRawUnsafe<any[]>(combinedQuery, ...values, pageSize, skip);

  const total = Number(rows[0]?.total_count ?? 0);

  const creators = rows.map((c: any) => ({
    pk:                            c.pk,
    username:                      c.username,
    fullName:                      c.full_name,
    firstName:                     c.first_name,
    lastName:                      c.last_name,
    nichePrimary:                  c.niche_primary,
    nicheSecondary:                c.niche_secondary,
    followerCount:                 c.follower_count?.toString() ?? null,
    addressCountry:                c.address_country,
    addressState:                  c.address_state,
    addressCity:                   c.address_city,
    gender:                        c.gender,
    ageGroup:                      c.age_group,
    creatorSize:                   c.creator_size,
    profilePicture:                c.profile_picture,
    primarySocialLink:             c.primary_social_link,
    tiktokLink:                    c.tiktok_link,
    youtubeLink:                   c.youtube_link,
    email:                         c.email,
    collaborationStatus:           c.collaboration_status,
    latestPostDate:                c.latest_post_date,
    lastUpdated:                   c.last_updated ? new Date(c.last_updated).toISOString() : null,
    totalCollaborationsInRecent25: c.total_collaborations_in_recent_25_posts,
  }));

  const responseData = {
    creators,
    pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  };

  searchCache.set(cacheKey, { data: responseData, expires: Date.now() + SEARCH_CACHE_TTL_MS });

  if (searchCache.size > 200) {
    const oldest = searchCache.keys().next().value;
    if (oldest) searchCache.delete(oldest);
  }

  await logAudit(session.userId, "SEARCH", {
    query: q,
    filters: { niche, country, state, city, gender, followersMin, followersMax },
    resultsCount: total,
  });

  return NextResponse.json(responseData);
}