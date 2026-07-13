import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * This is an API, not a website — there was no route at `/`, so hitting it in a
 * browser returned a bare 404 and looked like the server was broken. It wasn't.
 * These two routes make "is the backend alive, and is the DB reachable?"
 * answerable from the address bar.
 */
@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) { }

  @Get()
  root() {
    return {
      name: 'Keystone API',
      status: 'ok',
      hint: 'This is the API.',
      endpoints: [
        'POST /auth/signup',
        'POST /auth/login',
        'POST /auth/logout',
        'GET  /auth/me',
        'POST /organizations',
        'GET  /organizations/me',
        'GET  /members',
        'GET  /invites',
        'GET  /health',
      ],
    };
  }

  @Get('health')
  async health() {
    let database = 'up';

    try {
      // Cheapest possible round-trip that proves Mongo is actually reachable.
      await this.prisma.user.findFirst({ select: { id: true } });
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
