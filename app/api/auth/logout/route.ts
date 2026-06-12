import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (session) {
    await logAudit(session.userId, "LOGOUT", {});
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("creator_session", "", {
    httpOnly: true,
    expires: new Date(0),
    path: "/",
  });
  return response;
}
