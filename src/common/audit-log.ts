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

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'passwordHash',
  'jwt',
  'token',
  'refreshtoken',
  'refreshToken',
  'secret',
  'secretkey',
  'secretKey',
  'credentials',
  'apikey',
  'apiKey',
];

function sanitizeDetails(details: any): any {
  if (!details || typeof details !== 'object') {
    return details;
  }

  if (Array.isArray(details)) {
    return details.map(sanitizeDetails);
  }

  const sanitized: any = {};
  for (const key of Object.keys(details)) {
    const lowerKey = key.toLowerCase();
    const normalizedKey = lowerKey.replace(/[^a-z0-9]/g, '');
    const isSensitive = SENSITIVE_KEYS.some((sensitive) => {
      const lowerSensitive = sensitive.toLowerCase();
      const normalizedSensitive = lowerSensitive.replace(/[^a-z0-9]/g, '');
      return lowerKey.includes(lowerSensitive) || normalizedKey.includes(normalizedSensitive);
    });
    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof details[key] === 'object') {
      sanitized[key] = sanitizeDetails(details[key]);
    } else {
      sanitized[key] = details[key];
    }
  }
  return sanitized;
}

export async function writeAuditLog(
  prisma: PrismaService,
  params: AuditLogParams,
): Promise<void> {
  try {
    const user = await prisma.user.findUnique({ where: { id: params.userId } });
    const userEmail = user?.email || 'unknown';

    const sanitizedDetails = params.details ? sanitizeDetails(params.details) : null;

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
        details: sanitizedDetails ? JSON.stringify(sanitizedDetails) : null,
      },
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}
