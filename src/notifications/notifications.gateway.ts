import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AUTH_COOKIE, type JwtPayload } from '../common/jwt-payload';
import type { PublicNotification } from './notification.entity';

function parseCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

/**
 * One room per userId — every tab/device a person has open joins the same
 * room, so a notification reaches all of them at once. This is the actual
 * "real-time" channel for an already-open tab; FCM push (common/firebase-admin.ts)
 * is the separate channel for when the tab is backgrounded or closed.
 */
@WebSocketGateway({
  cors: {
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173').split(',').map((o) => o.trim()),
    credentials: true,
  },
})
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwtService: JwtService) {}

  /** Same auth as every HTTP route — the httpOnly JWT cookie — just read
   *  from the handshake instead of an Express request. socket.io only sends
   *  cookies on the handshake if the client connects with withCredentials. */
  async handleConnection(client: Socket): Promise<void> {
    const token = parseCookie(client.handshake.headers.cookie, AUTH_COOKIE);
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      await client.join(payload.sub);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(): void {
    // socket.io removes a disconnected client from its rooms automatically —
    // nothing to clean up here.
  }

  emitToUser(userId: string, notification: PublicNotification): void {
    try {
      this.server.to(userId).emit('notification', notification);
    } catch (error) {
      // A real-time emit failing must never take down the request that
      // triggered it — the notification is already persisted by this point.
      this.logger.warn(`Failed to emit real-time notification to ${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
