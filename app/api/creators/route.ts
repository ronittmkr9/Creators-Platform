// app/api/creators/route.ts
// GET — searches creators with full keyword sentence splitting + all structured filters

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
 * Splits a free-text sentence into individual keywords (min 2 chars, deduped).
 * "fitness girl NYC open collab" → ["fitness", "girl", "nyc", "open", "collab"]
 * ALL keywords must match (AND), each across ALL searchable columns (OR within).
 * This means you can type a natural sentence and every word is searched everywhere.
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
    // Every keyword must appear in at least one of these columns
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

  // ── Free-text: split sentence into keywords, each matched across all fields (AND logic)
  if (q && q.trim()) {
    const kw = buildKeywordConditions(q, i);
    if (kw.sql) {
      conditions.push(kw.sql);
      values.push(...kw.values);
      i = kw.nextIndex;
    }
  }

  // ── Structured filters
  if (username)     { conditions.push(`username ILIKE $${i}`);                                              values.push(`%${username}%`);    i++; }
  if (fullName)     { conditions.push(`full_name ILIKE $${i}`);                                             values.push(`%${fullName}%`);    i++; }
  if (niche)        { conditions.push(`(niche_primary ILIKE $${i} OR niche_secondary ILIKE $${i})`);       values.push(`%${niche}%`);       i++; }
  if (gender)       { conditions.push(`gender ILIKE $${i}`);                                                values.push(gender);             i++; }
  if (ageGroup)     { conditions.push(`age_group = $${i}`);                                                 values.push(ageGroup);           i++; }
  if (country)      { conditions.push(`address_country ILIKE $${i}`);                                       values.push(`%${country}%`);     i++; }
  if (state)        { conditions.push(`address_state ILIKE $${i}`);                                         values.push(`%${state}%`);       i++; }
  if (city)         { conditions.push(`address_city ILIKE $${i}`);                                          values.push(`%${city}%`);        i++; }
  if (creatorSize)  { conditions.push(`creator_size ILIKE $${i}`);                                          values.push(creatorSize);        i++; }
  if (creatorType)  { conditions.push(`creator_type ILIKE $${i}`);                                          values.push(`%${creatorType}%`); i++; }
  if (collabStatus) { conditions.push(`collaboration_status ILIKE $${i}`);                                  values.push(`%${collabStatus}%`); i++; }
  if (followersMin !== undefined) { conditions.push(`follower_count >= $${i}`);                             values.push(followersMin);       i++; }
  if (followersMax !== undefined) { conditions.push(`follower_count <= $${i}`);                             values.push(followersMax);       i++; }
  if (hasEmail   === "true")  conditions.push(`email IS NOT NULL`);
  if (hasEmail   === "false") conditions.push(`email IS NULL`);
  if (hasTiktok  === "true")  conditions.push(`tiktok_link IS NOT NULL`);
  if (hasYoutube === "true")  conditions.push(`youtube_link IS NOT NULL`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const sortColMap: Record<string, string> = {
    followerCount: "follower_count",
    lastUpdated:   "last_updated",
  };
  const orderCol = sortColMap[sortBy] ?? "follower_count";
  const orderDir = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
  const skip = (page - 1) * pageSize;

  // Deduplicate by username, keeping the most-recently-analyzed row
  const dedupeQuery = `
    WITH deduped AS (
      SELECT DISTINCT ON (LOWER(username))
        pk, username, full_name, first_name, last_name,
        niche_primary, niche_secondary, follower_count,
        address_country, address_state, address_city, gender, age_group,
        creator_size, profile_picture, primary_social_link,
        tiktok_link, youtube_link, email, collaboration_status,
        latest_post_date, last_updated, total_collaborations_in_recent_25_posts
      FROM bronze.creators
      ${whereClause}
      ORDER BY
        LOWER(username),
        COALESCE(analyzed_date, latest_post_date, scraped_date) DESC NULLS LAST
    )
    SELECT * FROM deduped
    ORDER BY ${orderCol} ${orderDir} NULLS LAST
    LIMIT $${i} OFFSET $${i + 1}
  `;

  const countQuery = `
    SELECT COUNT(*) AS count FROM (
      SELECT DISTINCT ON (LOWER(username)) pk
      FROM bronze.creators
      ${whereClause}
      ORDER BY
        LOWER(username),
        COALESCE(analyzed_date, latest_post_date, scraped_date) DESC NULLS LAST
    ) sub
  `;

  const [creatorsRaw, countRaw] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(dedupeQuery, ...values, pageSize, skip),
    prisma.$queryRawUnsafe<{ count: bigint }[]>(countQuery, ...values),
  ]);

  const total = Number(countRaw[0]?.count ?? 0);

  const serialized = creatorsRaw.map((c: any) => ({
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

  await logAudit(session.userId, "SEARCH", {
    query: q,
    filters: { niche, country, gender, followersMin, followersMax },
    resultsCount: total,
  });

  return NextResponse.json({
    creators: serialized,
    pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
  });
}