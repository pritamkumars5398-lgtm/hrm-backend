import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
    super(
      mongoUri
        ? {
            datasources: {
              db: {
                url: mongoUri,
              },
            },
          }
        : undefined,
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Connected to MongoDB');
    } catch (err) {
      this.logger.warn(
        'Could not connect to MongoDB at startup — server will start anyway. ' +
          'Check MONGO_URI. Error: ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Wraps any Prisma DB call. Converts a connection / timeout error into a
   * clean 503 ServiceUnavailableException so callers never see a raw 500.
   */
  static rethrowDbError(err: unknown): never {
    const msg = err instanceof Error ? err.message : String(err);
    // Prisma raw-query errors (code P2010) and network timeouts all contain
    // 'Server selection timeout' or 'No connection could be made'.
    const isConnErr =
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2010') ||
      msg.includes('Server selection timeout') ||
      msg.includes('No connection could be made') ||
      msg.includes('ECONNREFUSED');

    if (isConnErr) {
      throw new ServiceUnavailableException(
        'The database is temporarily unavailable. Please try again in a moment.',
      );
    }
    throw err;
  }
}
