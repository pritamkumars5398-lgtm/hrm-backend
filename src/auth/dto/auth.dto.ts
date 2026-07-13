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

export class GoogleSignInDto {
  @IsEmail()
  email!: string;

  @IsString()
  name!: string;
}
