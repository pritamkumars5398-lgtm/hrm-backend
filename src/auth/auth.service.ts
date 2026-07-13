import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import { UsersService } from '../users/users.service';
import { toPublicUser, type PublicUser, type User } from '../users/user.entity';
import type { JwtPayload } from '../common/jwt-payload';

@Injectable()
export class AuthService {
  private readonly googleClient: OAuth2Client;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.googleClient = new OAuth2Client(
      this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
    );
  }

  async signup(params: {
    fullName: string;
    email: string;
    password: string;
  }): Promise<{ user: PublicUser; token: string }> {
    if (await this.usersService.findByEmail(params.email)) {
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
    const user = await this.usersService.findByEmail(params.email);

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
   * Verifies a signed Google id_token (from the GIS SDK) against Google's
   * public JWKS. Only after the signature is valid and the audience matches our
   * client ID do we trust the email and name inside it.
   *
   * Never accept a plain email/name from the client — anyone could claim any
   * address without this proof step.
   */
  async signInWithGoogle(params: { credential: string }): Promise<{
    user: PublicUser;
    token: string;
  }> {
    let email: string;
    let name: string;

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken: params.credential,
        audience: this.configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      });

      const payload = ticket.getPayload();
      if (!payload?.email) {
        throw new Error('Token payload missing email.');
      }

      email = payload.email;
      name = payload.name ?? payload.email.split('@')[0];
    } catch {
      throw new UnauthorizedException(
        'Google sign-in failed — the token could not be verified.',
      );
    }

    const existing = await this.usersService.findByEmail(email);
    if (existing) return this.issue(existing);

    const user = await this.usersService.create({
      email,
      // A Google-only account has no local password.
      password: null,
      name,
    });

    return this.issue(user);
  }

  /**
   * Requires the current password even though the caller is already signed in:
   * it stops someone who walked up to an unlocked laptop from silently taking
   * the account over.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) throw new UnauthorizedException('Your account no longer exists.');

    // A Google-only account has no local password to verify against.
    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account signs in with Google and has no password to change.',
      );
    }

    const ok = await this.usersService.verifyPassword(user, currentPassword);
    if (!ok) throw new UnauthorizedException('Your current password is not correct.');

    await this.usersService.updatePassword(userId, newPassword);
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.usersService.findById(userId);
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


