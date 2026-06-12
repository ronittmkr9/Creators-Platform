import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const updateSchema = z.object({ name: z.string().min(1).max(100) });

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
      items: {
        orderBy: { addedAt: "desc" },
      },
    },
  });

  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  // NOTE: SavedListItem.creatorId currently stores the creator's `username`
  // (see app/dashboard/page.tsx addToList), not Creator.pk. The Prisma
  // relation is defined against Creator.pk, so `include: { creator: true }`
  // would always return null. Look creators up by username instead.
  const usernames = list.items.map((item) => item.creatorId);

  const creators = usernames.length
    ? await prisma.creator.findMany({
        where: { username: { in: usernames } },
        select: {
          pk: true, username: true, fullName: true, firstName: true, lastName: true,
          nichePrimary: true, followerCount: true, addressCountry: true, addressCity: true,
          gender: true, ageGroup: true, creatorSize: true, profilePicture: true,
          primarySocialLink: true, tiktokLink: true, youtubeLink: true, email: true,
          collaborationStatus: true, phoneNumber: true, businessCategory: true,
        },
      })
    : [];

  const creatorByUsername = new Map(creators.map((c) => [c.username, c]));

  const itemsWithCreator = list.items.map((item) => ({
    ...item,
    creator: creatorByUsername.get(item.creatorId) ?? null,
  }));

  const result = { ...list, items: itemsWithCreator };

  // serialize BigInt
  const safe = JSON.parse(JSON.stringify(result, (_, v) => typeof v === "bigint" ? v.toString() : v));
  return NextResponse.json({ list: safe });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid name" }, { status: 400 });

  const updated = await prisma.savedList.updateMany({
    where: { id, userId: session.userId },
    data: { name: parsed.data.name },
  });

  if (updated.count === 0) return NextResponse.json({ error: "List not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  await prisma.savedList.deleteMany({ where: { id, userId: session.userId } });
  return NextResponse.json({ success: true });
}