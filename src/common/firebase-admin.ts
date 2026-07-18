import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const logger = new Logger('FirebaseAdmin');
let app: App | null | undefined; // undefined = not yet attempted, null = attempted and unavailable

/**
 * Lazily initializes the Admin SDK from the three service-account values in
 * .env. Returns null (never throws) when they're missing or malformed — a
 * misconfigured/absent Firebase project must not take the whole API down;
 * every caller in this file treats "no app" as "skip the push, keep going."
 */
function getApp(configService: ConfigService): App | null {
  if (app !== undefined) return app;

  const projectId = configService.get<string>('FIREBASE_PROJECT_ID');
  const clientEmail = configService.get<string>('FIREBASE_CLIENT_EMAIL');
  // .env stores literal `\n` escapes inside the quoted PEM block — real
  // newlines would break the .env file format, so they're unescaped here.
  const privateKey = configService.get<string>('FIREBASE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    logger.warn('Firebase Admin credentials are not configured — push notifications are disabled (in-app notifications still work).');
    app = null;
    return app;
  }

  try {
    app = getApps()[0] ?? initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  } catch (error) {
    logger.error('Failed to initialize Firebase Admin — push notifications are disabled.', error instanceof Error ? error.message : String(error));
    app = null;
  }

  return app;
}

/**
 * Best-effort push to every token a user has registered. Never throws —
 * a dead/expired token or a missing Firebase config must not block the
 * in-app notification (already persisted by the time this runs) from
 * having been created successfully.
 */
export async function sendPushToTokens(
  configService: ConfigService,
  tokens: string[],
  notification: { title: string; body: string },
  data?: Record<string, string>,
): Promise<void> {
  if (tokens.length === 0) return;
  const firebaseApp = getApp(configService);
  if (!firebaseApp) return;

  try {
    const messaging = getMessaging(firebaseApp);
    const result = await messaging.sendEachForMulticast({
      tokens,
      notification,
      data,
    });
    if (result.failureCount > 0) {
      logger.warn(`${result.failureCount} of ${tokens.length} push token(s) failed to deliver.`);
    }
  } catch (error) {
    logger.error('Push send failed.', error instanceof Error ? error.message : String(error));
  }
}
