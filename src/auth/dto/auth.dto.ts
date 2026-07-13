import { IsEmail, IsString, MinLength } from 'class-validator';

export class SignupDto {
  @IsString()
  @MinLength(2, { message: 'That name looks too short.' })
  fullName!: string;

  @IsEmail({}, { message: 'That does not look like an email.' })
  email!: string;

  @MinLength(8, { message: 'Use at least 8 characters.' })
  password!: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'That does not look like an email.' })
  email!: string;

  @IsString()
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  @MinLength(8, { message: 'Use at least 8 characters.' })
  newPassword!: string;
}

export class GoogleSignInDto {
  /**
   * The signed id_token JWT that Google's GIS SDK returns after a successful
   * sign-in. The backend verifies this against Google's public JWKS before
   * trusting the email or name inside it — accepting a plain email/name from
   * the client would let anyone sign in as any address without proof.
   */
  @IsString()
  credential!: string;
}
