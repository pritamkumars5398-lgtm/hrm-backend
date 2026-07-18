import type { Notification } from '@prisma/client';

export type PublicNotification = {
  id: string;
  title: string;
  body: string;
  kind: string;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export function toPublicNotification(n: Notification): PublicNotification {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    kind: n.kind,
    link: n.link,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
  };
}
