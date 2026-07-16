import { IsEmail, IsIn, IsString, IsOptional, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class FinancialDetailsDto {
  @IsString()
  accName!: string;

  @IsString()
  accNumber!: string;

  @IsString()
  bankName!: string;

  @IsString()
  ifscCode!: string;
}

export class EducationDetailDto {
  @IsString()
  degree!: string;

  @IsString()
  institution!: string;

  @IsString()
  year!: string;
}

export class FamilyDetailDto {
  @IsString()
  name!: string;

  @IsString()
  relationship!: string;

  @IsString()
  @IsOptional()
  contactNumber?: string;
}

export class CreateInviteDto {
  @IsEmail({}, { message: 'That does not look like an email.' })
  email!: string;

  @IsString({ each: true })
  permissions!: string[];

  // Which entry point triggered this. Only 'employee-management' creates an
  // Employee HR record; a Team Members invite creates User + Membership only (§9).
  @IsIn(['employee-management', 'team-members'])
  @IsOptional()
  source?: 'employee-management' | 'team-members';

  // Optional HR data, populated when invited via "Add Employee" flow
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  jobTitle?: string;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  employmentType?: string;

  @IsString()
  @IsOptional()
  workLocation?: string;

  @IsString()
  @IsOptional()
  employeeId?: string;

  @IsString()
  @IsOptional()
  contactNumber?: string;

  @IsString()
  @IsOptional()
  homeAddress?: string;

  // Cloudinary secure_url, obtained by the client from the signed direct-upload
  // flow (GET /invites/photo-signature) before submitting the invite.
  @IsString()
  @IsOptional()
  photoUrl?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => FinancialDetailsDto)
  financialDetails?: FinancialDetailsDto;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => EducationDetailDto)
  educationDetails?: EducationDetailDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => FamilyDetailDto)
  familyDetails?: FamilyDetailDto[];
}
