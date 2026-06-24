import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

type CreatorRow = {
  username: string | null; fullName: string | null; firstName: string | null; lastName: string | null;
  email: string | null; phoneNumber: string | null; nichePrimary: string | null; nicheSecondary: string | null;
  followerCount: bigint | null; creatorSize: string | null; gender: string | null; ageGroup: string | null;
  addressCountry: string | null; addressCity: string | null; addressState: string | null;
  primarySocialLink: string | null; tiktokLink: string | null; youtubeLink: string | null;
  collaborationStatus: string | null; businessCategory: string | null; priceUsd: string | null;
};

const ALL_COLUMNS: { key: string; label: string; get: (c: CreatorRow) => string | null | undefined }[] = [
  { key: "username",            label: "Username",          get: c => c.username },
  { key: "fullName",            label: "Full Name",         get: c => c.fullName || [c.firstName, c.lastName].filter(Boolean).join(" ") || null },
  { key: "email",               label: "Email",             get: c => c.email },
  { key: "phone",               label: "Phone",             get: c => c.phoneNumber },
  { key: "nichePrimary",        label: "Niche",             get: c => c.nichePrimary },
  { key: "nicheSecondary",      label: "Secondary Niche",   get: c => c.nicheSecondary },
  { key: "followerCount",       label: "Followers",         get: c => c.followerCount?.toString() ?? null },
  { key: "creatorSize",         label: "Creator Size",      get: c => c.creatorSize },
  { key: "gender",              label: "Gender",            get: c => c.gender },
  { key: "ageGroup",            label: "Age Group",         get: c => c.ageGroup },
  { key: "addressCountry",      label: "Country",           get: c => c.addressCountry },
  { key: "addressCity",         label: "City",              get: c => c.addressCity },
  { key: "addressState",        label: "State",             get: c => c.addressState },
  { key: "primarySocialLink",   label: "Instagram",         get: c => c.primarySocialLink },
  { key: "tiktokLink",          label: "TikTok",            get: c => c.tiktokLink },
  { key: "youtubeLink",         label: "YouTube",           get: c => c.youtubeLink },
  { key: "collaborationStatus", label: "Collab Status",     get: c => c.collaborationStatus },
  { key: "businessCategory",    label: "Business Category", get: c => c.businessCategory },
  { key: "priceUsd",            label: "Price (USD)",       get: c => c.priceUsd },
];

function csvCell(v: string | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const columnsParam = searchParams.get("columns");

  // Determine which columns to include (all by default)
  const selectedKeys = columnsParam
    ? columnsParam.split(",").map(k => k.trim()).filter(Boolean)
    : ALL_COLUMNS.map(c => c.key);
  const columns = ALL_COLUMNS.filter(c => selectedKeys.includes(c.key));
  if (columns.length === 0) return NextResponse.json({ error: "No valid columns selected" }, { status: 400 });

  const list = await prisma.savedList.findFirst({
    where: { id, userId: session.userId },
    include: { items: true },
  });
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  const usernames = list.items.map(item => item.creatorId);
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

  const byUsername = new Map(creators.map(c => [c.username, c]));

  const header = columns.map(c => c.label).join(",");
  const rows = list.items
    .map(item => byUsername.get(item.creatorId))
    .filter((c): c is NonNullable<typeof c> => c != null)
    .map(c => columns.map(col => csvCell(col.get(c as CreatorRow))).join(","));

  const csv = [header, ...rows].join("\n");

  await logAudit(session.userId, "EXPORT", {
    listId: id, listName: list.name, count: list.items.length,
    columns: columns.map(c => c.key),
  });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${list.name.replace(/[^a-z0-9]/gi, "_")}.csv"`,
    },
  });
}

// Export column metadata so the UI can build the picker
export async function OPTIONS() {
  return NextResponse.json({ columns: ALL_COLUMNS.map(c => ({ key: c.key, label: c.label })) });
}
