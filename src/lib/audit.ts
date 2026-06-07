import { prisma } from "./db";

/** Record who changed what and when (FR-46). Never throws into the caller. */
export async function logAudit(args: {
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: args.userId ?? null,
        action: args.action,
        entity: args.entity,
        entityId: args.entityId ?? null,
        before: args.before ? JSON.stringify(args.before) : null,
        after: args.after ? JSON.stringify(args.after) : null,
      },
    });
  } catch (e) {
    console.error("audit log failed", e);
  }
}
