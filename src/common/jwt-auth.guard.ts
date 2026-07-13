import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AUTH_COOKIE, type JwtPayload } from './jwt-payload';

export interface AuthedRequest extends Request {
  user: JwtPayload;
}

/**
 * Reads the JWT from the httpOnly cookie and verifies it. This — not the
 * frontend's RequireAuth — is what actually protects a route.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[AUTH_COOKIE];

    if (!token) {
      throw new UnauthorizedException('Not signed in.');
    }

    try {
      request.user = await this.jwtService.verifyAsync<JwtPayload>(token);
      return true;
    } catch {
      // Expired or tampered-with — same answer either way.
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }
  }
}
