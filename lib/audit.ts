import { prisma } from "./prisma";

export type AuditAction =
  | "LOGIN"
  | "LOGOUT"
  | "SEARCH"
  | "VIEW_CREATOR"
  | "CREATE_LIST"
  | "ADD_TO_LIST"
  | "REMOVE_FROM_LIST"
  | "EXPORT"
  | "FAILED_LOGIN"
  | "NOTE"
  | "EDIT_CREATOR";

export async function logAudit(
  userId: string,
  action: AuditAction,
  details?: Record<string, unknown>,
  ipAddress?: string,
  userAgent?: string
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        details,
        ipAddress,
        userAgent,
      },
    });
  } catch (e) {
    console.error("Audit log error:", e);
  }
}
