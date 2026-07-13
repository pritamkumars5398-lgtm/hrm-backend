import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { INDUSTRIES } from '../organization.entity';

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
