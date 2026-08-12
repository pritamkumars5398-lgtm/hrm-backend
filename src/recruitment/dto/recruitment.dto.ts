import { IsEmail, IsInt, IsIn, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateJobDto {
  @IsString()
  @MinLength(1, { message: 'Job title is required.' })
  title!: string;

  @IsString()
  @MinLength(1, { message: 'Department is required.' })
  department!: string;

  @IsString()
  @MinLength(1, { message: 'Location is required.' })
  location!: string;

  @IsInt()
  @Min(1, { message: 'Headcount must be at least 1.' })
  headcount!: number;

  @IsString()
  @IsOptional()
  description?: string;
}

export class CreateCandidateDto {
  @IsString()
  @MinLength(1, { message: 'Candidate name is required.' })
  name!: string;

  @IsEmail({}, { message: 'Invalid email address.' })
  email!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  resumeUrl?: string;

  @IsString()
  @MinLength(1, { message: 'Job requisition ID is required.' })
  requisitionId!: string;
}

const STAGES = ['APPLIED', 'SCREENED', 'INTERVIEW', 'OFFERED', 'HIRED', 'REJECTED'] as const;

export class UpdateCandidateStageDto {
  @IsIn(STAGES, { message: 'Invalid candidate stage.' })
  stage!: 'APPLIED' | 'SCREENED' | 'INTERVIEW' | 'OFFERED' | 'HIRED' | 'REJECTED';
}
