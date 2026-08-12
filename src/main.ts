import { ValidationPipe, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

const logger = new Logger('Bootstrap');

/**
 * If MONGO_URI points to localhost (the dev default), automatically spin up an
 * embedded MongoDB via mongodb-memory-server so the app works out-of-the-box
 * with no external MongoDB installation required.
 *
 * The URI env-var is overwritten BEFORE NestFactory.create so Prisma reads the
 * correct connection string at initialisation time.
 *
 * Atlas / production URIs (mongodb+srv://) are passed through unchanged.
 */
async function ensureMongoDB(): Promise<void> {
  if (process.env.EMBEDDED_MONGO_RUNNING === 'true') {
    logger.log('Embedded MongoDB is already running (started by runner).');
    return;
  }

  const uri = process.env.MONGO_URI ?? '';
  const isLocalhost =
    uri.includes('localhost') || uri.includes('127.0.0.1') || uri === '';
  const isAtlas = uri.startsWith('mongodb+srv://');

  if (isLocalhost && !isAtlas) {
    logger.log(
      'MONGO_URI points to localhost — starting embedded MongoDB (mongodb-memory-server)…',
    );
    try {
      // Dynamic import so production bundles never include the dev package.
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      const mongod = await MongoMemoryServer.create({
        instance: { dbName: 'keystone', launchTimeout: 60000 },
      });
      const baseUri = mongod.getUri();
      const embeddedUri = baseUri.endsWith('/')
        ? `${baseUri}keystone?directConnection=true`
        : `${baseUri}/keystone?directConnection=true`;
      process.env.MONGO_URI = embeddedUri;
      process.env.DATABASE_URL = embeddedUri;
      logger.log(`Embedded MongoDB ready at ${embeddedUri}`);

      // Seed initial demo data into the embedded instance natively
      try {
        const { MongoClient } = await import('mongodb');
        const client = await MongoClient.connect(embeddedUri);
        const db = client.db('keystone');
        const DEMO_HASH = '$2b$10$S/JdXTN6BjYEEZaW0FBE5OXgZZ/LGyayrkC6fTZN28BhqIXAXAriC';

        await (db.collection('User') as any).deleteMany({});
        await (db.collection('User') as any).insertMany([
          {
            _id: 'usr-1',
            id: 'usr-1',
            email: 'hr@demo.com',
            passwordHash: DEMO_HASH,
            requiresPasswordReset: false,
            name: 'HR Manager',
            avatarInitials: 'HR',
            fcmTokens: [],
            createdAt: new Date()
          },
          {
            _id: 'usr-2',
            id: 'usr-2',
            email: 'owner@demo.com',
            passwordHash: DEMO_HASH,
            requiresPasswordReset: false,
            name: 'Owner User',
            avatarInitials: 'OU',
            fcmTokens: [],
            createdAt: new Date()
          },
          {
            _id: 'usr-3',
            id: 'usr-3',
            email: 'manager@demo.com',
            passwordHash: DEMO_HASH,
            requiresPasswordReset: false,
            name: 'Line Manager',
            avatarInitials: 'LM',
            fcmTokens: [],
            createdAt: new Date()
          }
        ]);

        await (db.collection('Organization') as any).updateOne(
          { _id: 'org-alderway' },
          {
            $set: {
              id: 'org-alderway',
              name: 'Alderway Technologies',
              address: '123 Tech Park',
              industry: 'Software',
              ownerId: 'usr-2',
              createdAt: new Date()
            }
          },
          { upsert: true }
        );

        await (db.collection('Membership') as any).deleteMany({});
        await (db.collection('Membership') as any).insertMany([
          {
            _id: 'mem-1',
            id: 'mem-1',
            userId: 'usr-1',
            organizationId: 'org-alderway',
            jobTitle: 'HR Manager',
            permissions: [
              'employees.*',
              'attendance.*',
              'leave.*',
              'documents.*',
              'reports.view',
              'team.invite',
              'team.view'
            ],
            createdAt: new Date()
          },
          {
            _id: 'mem-2',
            id: 'mem-2',
            userId: 'usr-2',
            organizationId: 'org-alderway',
            jobTitle: 'Founder & CEO',
            permissions: ['*'],
            createdAt: new Date()
          },
          {
            _id: 'mem-3',
            id: 'mem-3',
            userId: 'usr-3',
            organizationId: 'org-alderway',
            jobTitle: 'Engineering Lead',
            permissions: [
              'attendance.view',
              'leave.approve',
              'performance.view',
              'documents.view'
            ],
            createdAt: new Date()
          }
        ]);
        logger.log('Embedded MongoDB pre-seeded with demo accounts successfully.');
        await client.close();
      } catch (seedErr) {
        logger.warn('Failed to pre-seed embedded MongoDB: ' + (seedErr instanceof Error ? seedErr.message : String(seedErr)));
      }
    } catch (err) {
      logger.warn(
        'Could not start embedded MongoDB: ' +
          (err instanceof Error ? err.message : String(err)) +
          '. Falling back to original MONGO_URI.',
      );
    }
  }
}

async function bootstrap() {
  // Must happen before NestFactory.create / Prisma client initialisation.
  await ensureMongoDB();

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn'], // suppress ERROR logs during port probes
  });

  app.use(cookieParser());

  // The auth cookie is httpOnly, so the browser only sends it when the frontend
  // asks with credentials — which requires an explicit origin, never a wildcard.
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({ origin: origins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  try {
    await app.listen(port);
  } catch (err: any) {
    if (err?.code === 'EADDRINUSE') {
      console.log(`\n================================================================`);
      console.log(` SUCCESS: Backend server is ALREADY active on http://localhost:${port}`);
      console.log(` (No second terminal needed. You can close this terminal window).`);
      console.log(`================================================================\n`);
      process.exit(0);
    }
    throw err;
  }
}

void bootstrap();

