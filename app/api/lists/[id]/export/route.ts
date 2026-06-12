import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const list = await prisma.savedList.findFirst({
    where: { id, userId: session.userId },
    include: {
      items: true,
    },
  });

  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  // NOTE: SavedListItem.creatorId stores the creator's `username`, not
  // Creator.pk, so the Prisma relation can't be used directly. Resolve
  // creators by username instead (see app/api/lists/[id]/route.ts).
  const usernames = list.items.map((item) => item.creatorId);

  const creators = usernames.length
    ? await prisma.creator.findMany({
        where: { username: { in: usernames } },
        select: {
          username: true, fullName: true, firstName: true, lastName: true,
          email: true, phoneNumber: true, nichePrimary: true, nicheSecondary: true,
          followerCount: true, creatorSize: true, gender: true, ageGroup: true,
          addressCountry: true, addressCity: true, addressState: true,
          primarySocialLink: true, tiktokLink: true, youtubeLink: true,
          collaborationStatus: true, businessCategory: true, priceUsd: true,
        },
      })
    : [];

  const creatorByUsername = new Map(creators.map((c) => [c.username, c]));

  const headers = [
    "Username", "Full Name", "Email", "Phone", "Niche", "Secondary Niche",
    "Followers", "Creator Size", "Gender", "Age Group",
    "Country", "City", "State",
    "Instagram", "TikTok", "YouTube",
    "Collab Status", "Business Category", "Price (USD)",
  ];

  const rows = list.items
    .map((item) => creatorByUsername.get(item.creatorId))
    .filter((c): c is NonNullable<typeof c> => c != null)
    .map((c) => {
    const fullName = c.fullName || [c.firstName, c.lastName].filter(Boolean).join(" ");
    return [
      c.username, fullName, c.email, c.phoneNumber,
      c.nichePrimary, c.nicheSecondary,
      c.followerCount?.toString(), c.creatorSize, c.gender, c.ageGroup,
      c.addressCountry, c.addressCity, c.addressState,
      c.primarySocialLink, c.tiktokLink, c.youtubeLink,
      c.collaborationStatus, c.businessCategory, c.priceUsd,
    ].map(v => {
      if (v === null || v === undefined) return "";
      const str = String(v);
      // escape quotes and wrap in quotes if contains comma/newline
      return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"` : str;
    });
  });

  const csv = [headers, ...rows].map(r => r.join(",")).join("\n");

  await logAudit(session.userId, "EXPORT", { listId: id, listName: list.name, count: list.items.length });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${list.name.replace(/[^a-z0-9]/gi, "_")}.csv"`,
    },
  });
}