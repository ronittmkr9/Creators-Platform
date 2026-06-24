import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const querySchema = z.object({
  niche:     z.string().optional(),
  country:   z.string().optional(),
  state:     z.string().optional(),
  city:      z.string().optional(),
  ageGroup:  z.string().optional(),
  gender:    z.string().optional(),
  onboarded: z.enum(["true", "false"]).optional(),
  page:      z.coerce.number().min(1).default(1),
  pageSize:  z.coerce.number().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsed.success) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  const { niche, country, state, city, ageGroup, gender, onboarded, page, pageSize } = parsed.data;
  const skip = (page - 1) * pageSize;

  const conditions: string[] = [`n.user_id = $1`];
  const values: unknown[] = [session.userId];
  let i = 2;

  // Exact (case-insensitive) matches — values now come from the meta-populated
  // dropdowns on the Notes page, not free text, so no more "%...%" wildcards.
  if (niche) { conditions.push(`$${i} = ANY(n.campaign_niches)`); values.push(niche); i++; }
  if (country) { conditions.push(`c.address_country ILIKE $${i}`); values.push(country); i++; }
  if (state) { conditions.push(`c.address_state ILIKE $${i}`); values.push(state); i++; }
  if (city) { conditions.push(`c.address_city ILIKE $${i}`); values.push(city); i++; }
  if (ageGroup) { conditions.push(`c.age_group ILIKE $${i}`); values.push(ageGroup); i++; }
  if (gender) { conditions.push(`c.gender ILIKE $${i}`); values.push(gender); i++; }
  if (onboarded) { conditions.push(`n.is_onboarded = $${i}`); values.push(onboarded === "true"); i++; }

  const where = conditions.join(" AND ");

  const rows = await prisma.$queryRawUnsafe<any[]>(`
    WITH deduped AS (
      SELECT DISTINCT ON (LOWER(c.username))
        c.pk, c.username, c.full_name, c.niche_primary, c.niche_secondary,
        c.address_country, c.address_state, c.address_city,
        c.gender, c.age_group, c.profile_picture, c.primary_social_link,
        c.follower_count, c.creator_size,
        n.is_onboarded, n.campaign_niches, n.note, n.updated_at AS note_updated_at
      FROM app.creator_notes n
      JOIN bronze.creators c ON LOWER(n.creator_id) = LOWER(c.username)
      WHERE ${where}
      ORDER BY LOWER(c.username), c.last_updated DESC NULLS LAST
    ),
    counted AS (SELECT COUNT(*)::int AS total FROM deduped)
    SELECT deduped.*, counted.total AS total_count
    FROM deduped
    CROSS JOIN counted
    ORDER BY note_updated_at DESC NULLS LAST
    LIMIT $${i} OFFSET $${i + 1}
  `, ...values, pageSize, skip);

  const total = Number(rows[0]?.total_count ?? 0);

  const creators = rows.map((r: any) => ({
    pk: r.pk,
    username: r.username,
    fullName: r.full_name,
    nichePrimary: r.niche_primary,
    nicheSecondary: r.niche_secondary,
    addressCountry: r.address_country,
    addressState: r.address_state,
    addressCity: r.address_city,
    gender: r.gender,
    ageGroup: r.age_group,
    profilePicture: r.profile_picture,
    primarySocialLink: r.primary_social_link,
    followerCount: r.follower_count?.toString() ?? null,
    creatorSize: r.creator_size,
    isOnboarded: r.is_onboarded,
    campaignNiches: r.campaign_niches ?? [],
    note: r.note,
    noteUpdatedAt: r.note_updated_at,
  }));

  const allNiches = await prisma.$queryRaw<{ niche: string }[]>`
    SELECT DISTINCT unnest(campaign_niches) AS niche
    FROM app.creator_notes
    WHERE user_id = ${session.userId}
    ORDER BY niche
  `;

  return NextResponse.json({
    creators,
    pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
    niches: allNiches.map(r => r.niche),
  });
}

// ── PATCH /api/notes?username=… — update note text + campaign niches ──────────
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const username = new URL(req.url).searchParams.get("username");
  if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const note: string | undefined = typeof body.note === "string" ? body.note : undefined;
  const campaignNiches: string[] | undefined = Array.isArray(body.campaignNiches) ? body.campaignNiches : undefined;

  if (note === undefined && campaignNiches === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = { updated_at: new Date() };
  if (note !== undefined) updateData.note = note || null;
  if (campaignNiches !== undefined) updateData.campaign_niches = campaignNiches;

  const updated = await prisma.$executeRawUnsafe(
    `UPDATE app.creator_notes
     SET note = COALESCE($1, note),
         campaign_niches = COALESCE($2::text[], campaign_niches),
         updated_at = NOW()
     WHERE user_id = $3 AND LOWER(creator_id) = LOWER($4)`,
    note ?? null,
    campaignNiches ?? null,
    session.userId,
    username,
  );

  if (updated === 0) return NextResponse.json({ error: "Note not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// ── DELETE /api/notes?username=… — remove a creator note entirely ─────────────
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const username = new URL(req.url).searchParams.get("username");
  if (!username) return NextResponse.json({ error: "username required" }, { status: 400 });

  const deleted = await prisma.$executeRawUnsafe(
    `DELETE FROM app.creator_notes WHERE user_id = $1 AND LOWER(creator_id) = LOWER($2)`,
    session.userId,
    username,
  );

  if (deleted === 0) return NextResponse.json({ error: "Note not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}