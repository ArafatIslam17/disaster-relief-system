import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, parseQuery, route } from "@/lib/api";
import { authenticate } from "@/lib/auth/guard";
import { uuid } from "@/lib/validation";

const query = z.object({
  unread: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const GET = route(async (req) => {
  const auth = await authenticate(req);
  const q = parseQuery(req, query);
  const where = { userId: auth.userId, ...(q.unread === "true" ? { isRead: false } : {}) };
  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: q.limit }),
    prisma.notification.count({ where: { userId: auth.userId, isRead: false } }),
  ]);
  return ok({ notifications, unreadCount });
});

const patchSchema = z.union([
  z.object({ ids: z.array(uuid).min(1).max(500) }),
  z.object({ all: z.literal(true) }),
]);

/** Mark notifications as read. Users can only touch their own notifications. */
export const PATCH = route(async (req) => {
  const auth = await authenticate(req);
  const body = await parseJson(req, patchSchema);
  const res = await prisma.notification.updateMany({
    where: { userId: auth.userId, isRead: false, ...("ids" in body ? { notificationId: { in: body.ids } } : {}) },
    data: { isRead: true },
  });
  return ok({ updated: res.count });
});
