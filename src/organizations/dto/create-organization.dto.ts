import { IsEmail, IsIn, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { INDUSTRIES } from '../organization.entity';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'That name looks too short.' })
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'Enter your company address.' })
  address?: string;

  @IsOptional()
  @IsIn(INDUSTRIES as unknown as string[], { message: 'Choose an industry.' })
  industry?: string;

  // '' clears it (no notification email configured). Validated as a real email
  // only when non-empty.
  @IsOptional()
  @ValidateIf((o) => o.leaveNotificationEmail !== '')
  @IsEmail({}, { message: 'That does not look like an email.' })
  leaveNotificationEmail?: string;
}

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2, { message: 'That name looks too short.' })
  name!: string;

  @IsString()
  @MinLength(3, { message: 'Enter your company address.' })
  address!: string;

  @IsIn(INDUSTRIES as unknown as string[], { message: 'Choose an industry.' })
  industry!: string;

  /** Carried over from the wizard's Personal Details step. */
  @IsOptional()
  @IsString()
  jobTitle?: string;
}
