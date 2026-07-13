import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';
import type { InvitableRole } from '../invite.entity';

export class CreateInviteDto {
  @IsEmail({}, { message: 'That does not look like an email.' })
  email!: string;

  // OWNER is deliberately absent: a company has one Owner, and an invite must
  // never be able to mint another (§11.3).
  @IsIn(['HR', 'MANAGER'], { message: 'Choose either HR or Manager.' })
  role!: InvitableRole;
}

export class AcceptInviteDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(2, { message: 'That name looks too short.' })
  fullName!: string;

  @IsString()
  @MinLength(1, { message: 'Enter your phone number.' })
  phone!: string;

  @IsString()
  @MinLength(1, { message: 'Enter your job title.' })
  jobTitle!: string;

  @MinLength(8, { message: 'Use at least 8 characters.' })
  password!: string;
}
