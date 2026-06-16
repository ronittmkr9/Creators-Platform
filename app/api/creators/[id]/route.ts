// app/api/creators/[id]/route.ts
//
// GET   — fetch single creator by username (anyone logged in)
// PATCH — update creator fields in the DB (ADMIN only)

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const username = decodeURIComponent(id);

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM bronze.creators
     WHERE LOWER(username) = LOWER($1)
     ORDER BY COALESCE(analyzed_date, latest_post_date, scraped_date) DESC NULLS LAST
     LIMIT 1`,
    username,
  );

  if (!rows.length) {
    return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  }

  const c = rows[0];

  // Convert all snake_case keys → camelCase and serialize BigInt
  const creator: Record<string, any> = {};
  for (const [key, val] of Object.entries(c)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    creator[camelKey] = typeof val === "bigint" ? val.toString() : val;
  }

  await logAudit(session.userId, "VIEW_CREATOR", { username });

  return NextResponse.json({ creator });
}

// ─── PATCH (admin only) ───────────────────────────────────────────────────────

/**
 * Whitelist of camelCase field names the admin may update,
 * mapped to their actual snake_case DB column names.
 * Any field NOT in this map is silently ignored — protects pk, scraped_date, etc.
 */
const EDITABLE_FIELDS: Record<string, string> = {
  email:               "email",
  fullName:            "full_name",
  firstName:           "first_name",
  lastName:            "last_name",
  username:            "username",
  phoneNumber:         "phone_number",
  primarySocialLink:   "primary_social_link",
  tiktokLink:          "tiktok_link",
  youtubeLink:         "youtube_link",
  xLink:               "x_link",
  linktreeLink:        "linktree_link",
  otherSocialMedia:    "other_social_media",
  bioData:             "bio_data",
  nichePrimary:        "niche_primary",
  nicheSecondary:      "niche_secondary",
  creatorType:         "creator_type",
  creatorSize:         "creator_size",
  gender:              "gender",
  ageGroup:            "age_group",
  age:                 "age",
  addressCity:         "address_city",
  addressState:        "address_state",
  addressCountry:      "address_country",
  addressZip:          "address_zip",
  collaborationStatus: "collaboration_status",
  topCollaboration:    "top_collaboration",
  businessCategory:    "business_category",
  priceUsd:            "price_usd",
  ugcExamples:         "ugc_examples",
  followerCount:       "follower_count",
  profilePicture:      "profile_picture",
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // Auth: session required
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Role: ADMIN only
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 });
  }

  const { id } = await params;
  const username = decodeURIComponent(id);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Build SET clause from whitelisted fields only
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  for (const [camelKey, value] of Object.entries(body)) {
    const dbCol = EDITABLE_FIELDS[camelKey];
    if (!dbCol) continue; // silently skip unknown / protected fields
    setClauses.push(`${dbCol} = $${i}`);
    values.push(value);
    i++;
  }

  if (setClauses.length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  // Always stamp last_updated on any admin edit
  setClauses.push(`last_updated = NOW()`);

  // pk is the final parameter
  values.push(username);
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE bronze.creators 
       SET ${setClauses.join(", ")} 
       WHERE LOWER(username) = LOWER($${i})`,
      ...values,
    );
  
  } catch (err: any) {
    console.error("Admin PATCH error:", err);
    return NextResponse.json({ error: "Database update failed" }, { status: 500 });
  }

  await logAudit(session.userId, "EDIT_CREATOR", {
    username,
    fields: Object.keys(body).filter((k) => EDITABLE_FIELDS[k]),
  });

  return NextResponse.json({ ok: true });
}