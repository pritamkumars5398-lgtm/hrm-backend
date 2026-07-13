import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { toPublicUser, type PublicUser, type User } from '../users/user.entity';
import type { JwtPayload } from '../common/jwt-payload';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(params: {
    fullName: string;
    email: string;
    password: string;
  }): Promise<{ user: PublicUser; token: string }> {
    if (this.usersService.findByEmail(params.email)) {
      throw new ConflictException('An account with this email already exists.');
    }

    const user = await this.usersService.create({
      email: params.email,
      password: params.password,
      name: params.fullName,
    });

    return this.issue(user);
  }

  async login(params: { email: string; password: string }): Promise<{
    user: PublicUser;
    token: string;
  }> {
    const user = this.usersService.findByEmail(params.email);

    // Identical response for an unknown email and a wrong password — telling them
    // apart is an account-enumeration leak.
    const ok = user ? await this.usersService.verifyPassword(user, params.password) : false;
    if (!user || !ok) {
      throw new UnauthorizedException(
        'That email and password combination does not match an account.',
      );
    }

    return this.issue(user);
  }

  /**
   * Placeholder for the real exchange: the client will send a Google id_token,
   * this verifies it against Google's certs, and only then trusts the email.
   * Trusting a client-supplied email would let anyone sign in as anyone.
   */
  async signInWithGoogle(params: {
    email: string;
    name: string;
  }): Promise<{ user: PublicUser; token: string }> {
    const existing = this.usersService.findByEmail(params.email);
    if (existing) return this.issue(existing);

    const user = await this.usersService.create({
      email: params.email,
      password: null,
      name: params.name,
    });

    return this.issue(user);
  }

  me(userId: string): PublicUser {
    const user = this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Your account no longer exists.');
    }
    return toPublicUser(user);
  }

  /** Re-issues the token after the org is created, so the JWT carries the new organizationId. */
  async issueFor(user: User): Promise<{ user: PublicUser; token: string }> {
    return this.issue(user);
  }

  private async issue(user: User): Promise<{ user: PublicUser; token: string }> {
    const payload: JwtPayload = {
      sub: user.id,
      organizationId: user.organizationId,
      role: user.role,
    };

    return {
      user: toPublicUser(user),
      token: await this.jwtService.signAsync(payload),
    };
  }
}
