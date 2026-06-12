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
  sortBy:       z.enum(["followerCount", "username", "lastUpdated", "latestPostDate"]).default("latestPostDate"),
  sortOrder:    z.enum(["asc", "desc"]).default("desc"),
});

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

  // Build WHERE conditions and parameter values for raw SQL
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (q) {
    conditions.push(`(
      username ILIKE $${i} OR full_name ILIKE $${i} OR first_name ILIKE $${i} OR
      last_name ILIKE $${i} OR niche_primary ILIKE $${i} OR niche_secondary ILIKE $${i} OR
      bio_data ILIKE $${i} OR address_country ILIKE $${i} OR
      combined_hashtags ILIKE $${i} OR business_category ILIKE $${i}
    )`);
    values.push(`%${q}%`); i++;
  }
  if (username) { conditions.push(`username ILIKE $${i}`); values.push(`%${username}%`); i++; }
  if (fullName) { conditions.push(`full_name ILIKE $${i}`); values.push(`%${fullName}%`); i++; }
  if (niche)    { conditions.push(`(niche_primary ILIKE $${i} OR niche_secondary ILIKE $${i})`); values.push(`%${niche}%`); i++; }
  if (gender)   { conditions.push(`gender ILIKE $${i}`); values.push(gender); i++; }
  if (ageGroup) { conditions.push(`age_group = $${i}`); values.push(ageGroup); i++; }
  if (country)  { conditions.push(`address_country ILIKE $${i}`); values.push(`%${country}%`); i++; }
  if (state)    { conditions.push(`address_state ILIKE $${i}`); values.push(`%${state}%`); i++; }
  if (city)     { conditions.push(`address_city ILIKE $${i}`); values.push(`%${city}%`); i++; }
  if (creatorSize)  { conditions.push(`creator_size ILIKE $${i}`); values.push(creatorSize); i++; }
  if (creatorType)  { conditions.push(`creator_type ILIKE $${i}`); values.push(`%${creatorType}%`); i++; }
  if (collabStatus) { conditions.push(`collaboration_status ILIKE $${i}`); values.push(`%${collabStatus}%`); i++; }
  if (followersMin !== undefined) { conditions.push(`follower_count >= $${i}`); values.push(followersMin); i++; }
  if (followersMax !== undefined) { conditions.push(`follower_count <= $${i}`); values.push(followersMax); i++; }
  if (hasEmail  === "true")  conditions.push(`email IS NOT NULL`);
  if (hasEmail  === "false") conditions.push(`email IS NULL`);
  if (hasTiktok === "true")  conditions.push(`tiktok_link IS NOT NULL`);
  if (hasYoutube === "true") conditions.push(`youtube_link IS NOT NULL`);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Map sortBy camelCase to actual DB column names
  const sortColMap: Record<string, string> = {
    followerCount: "follower_count",
    username:      "username",
    lastUpdated:   "last_updated",
    latestPostDate: "latest_post_date",
  };
  const orderCol = sortColMap[sortBy] ?? "latest_post_date";
  const orderDir = sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";

  const skip = (page - 1) * pageSize;

  // Deduplicate by username, keeping the row with the most recent analyzed_date
  // (falls back to latest_post_date if analyzed_date is null)
  const dedupeQuery = `
    WITH deduped AS (
      SELECT DISTINCT ON (LOWER(username))
        pk, username, full_name, first_name, last_name,
        niche_primary, niche_secondary, follower_count,
        address_country, address_city, gender, age_group,
        creator_size, profile_picture, primary_social_link,
        tiktok_link, youtube_link, email, collaboration_status,
        latest_post_date, total_collaborations_in_recent_25_posts
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

  const dataValues = [...values, pageSize, skip];
  const countValues = [...values];

  const [creatorsRaw, countRaw] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(dedupeQuery, ...dataValues),
    prisma.$queryRawUnsafe<{ count: bigint }[]>(countQuery, ...countValues),
  ]);

  const total = Number(countRaw[0]?.count ?? 0);

  const serialized = creatorsRaw.map((c: any) => ({
    pk:                           c.pk,
    username:                     c.username,
    fullName:                     c.full_name,
    firstName:                    c.first_name,
    lastName:                     c.last_name,
    nichePrimary:                 c.niche_primary,
    nicheSecondary:               c.niche_secondary,
    followerCount:                c.follower_count?.toString() ?? null,
    addressCountry:               c.address_country,
    addressCity:                  c.address_city,
    gender:                       c.gender,
    ageGroup:                     c.age_group,
    creatorSize:                  c.creator_size,
    profilePicture:               c.profile_picture,
    primarySocialLink:            c.primary_social_link,
    tiktokLink:                   c.tiktok_link,
    youtubeLink:                  c.youtube_link,
    email:                        c.email,
    collaborationStatus:          c.collaboration_status,
    latestPostDate:               c.latest_post_date,
    totalCollaborationsInRecent25: c.total_collaborations_in_recent_25_posts,
  }));

  await logAudit(session.userId, "SEARCH", {
    query: q,
    filters: { niche, country, gender, followersMin, followersMax },
    resultsCount: total,
  });

  return NextResponse.json({
    creators: serialized,
    pagination: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    },
  });
}