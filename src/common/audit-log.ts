import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export interface AuditLogParams {
  organizationId: string | null;
  userId: string;
  action: string;
  resource: string;
  resourceId: string | null;
  result: 'ALLOW' | 'DENY';
  details?: any;
}

export async function writeAuditLog(
  prisma: PrismaService,
  params: AuditLogParams,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: params.userId } });
    const userEmail = user?.email || 'unknown';

    await prisma.auditLog.create({
      data: {
        id: `aud-${randomUUID().slice(0, 8)}`,
        organizationId: params.organizationId,
        userId: params.userId,
        userEmail,
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        result: params.result,
        details: params.details ? JSON.stringify(params.details) : null,
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
