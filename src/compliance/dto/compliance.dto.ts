import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateFrameworkDto {
  @IsString()
  @MinLength(1, { message: 'Framework name is required.' })
  name!: string;

  @IsString()
  @MinLength(1, { message: 'Framework code is required.' })
  code!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @MinLength(1, { message: 'Jurisdiction is required.' })
  jurisdiction!: string;

  @IsString()
  @MinLength(1, { message: 'Version is required.' })
  version!: string;

  @IsString()
  effectiveFrom!: string; // YYYY-MM-DD

  @IsString()
  @IsOptional()
  effectiveUntil?: string; // YYYY-MM-DD
}

export class CreateRequirementDto {
  @IsString()
  @IsOptional()
  frameworkId?: string;

  @IsString()
  @MinLength(1, { message: 'Requirement code is required.' })
  code!: string;

  @IsString()
  @MinLength(1, { message: 'Requirement name is required.' })
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsIn(['DOCUMENT', 'POLICY', 'TRAINING', 'ATTENDANCE', 'LEAVE', 'PAYROLL', 'ONBOARDING'])
  category!: 'DOCUMENT' | 'POLICY' | 'TRAINING' | 'ATTENDANCE' | 'LEAVE' | 'PAYROLL' | 'ONBOARDING';

  @IsBoolean()
  @IsOptional()
  mandatory?: boolean;

  @IsString()
  @IsIn(['ONCE', 'MONTHLY', 'QUARTERLY', 'ANNUALLY'])
  frequency!: 'ONCE' | 'MONTHLY' | 'QUARTERLY' | 'ANNUALLY';

  @IsString()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  riskLevel!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsBoolean()
  @IsOptional()
  evidenceRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  verificationRequired?: boolean;

  @IsBoolean()
  @IsOptional()
  approvalRequired?: boolean;

  @IsString()
  @IsOptional()
  responsibleOwnerId?: string;

  @IsString()
  @IsOptional()
  applicabilityRules?: string; // JSON string
}

export class CreateExceptionDto {
  @IsString()
  obligationId!: string;

  @IsString()
  requestedById!: string; // Employee.id

  @IsString()
  @MinLength(1, { message: 'Reason for exception is required.' })
  reason!: string;

  @IsString()
  @IsIn(['FULL', 'PARTIAL'])
  scope!: 'FULL' | 'PARTIAL';

  @IsString()
  startDate!: string; // YYYY-MM-DD

  @IsString()
  endDate!: string; // YYYY-MM-DD
}

export class UpdateViolationDto {
  @IsString()
  @IsOptional()
  correctiveAction?: string;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  evidenceUrl?: string;

  @IsString()
  @IsOptional()
  @IsIn(['OPEN', 'INVESTIGATING', 'ACTION_REQUIRED', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED'])
  status?: 'OPEN' | 'INVESTIGATING' | 'ACTION_REQUIRED' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';

  @IsString()
  @IsOptional()
  ownerId?: string;
}

export class CreateRiskDto {
  @IsString()
  category!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  likelihood!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  impact!: number;

  @IsString()
  @IsOptional()
  ownerId?: string;

  @IsString()
  @IsOptional()
  mitigation?: string;
}

export class AcknowledgePolicyDto {
  @IsString()
  policyId!: string;

  @IsString()
  version!: string;
}

export class UpdateCourseProgressDto {
  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;
}

export class CreateComplianceTaskDto {
  @IsString()
  @IsOptional()
  obligationId?: string;

  @IsString()
  assignedToId!: string; // Employee.id

  @IsString()
  @MinLength(1, { message: 'Task title is required.' })
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

  @IsString()
  dueDate!: string; // YYYY-MM-DD
}

export class UpdateComplianceTaskStatusDto {
  @IsString()
  @IsIn(['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'COMPLETED', 'OVERDUE', 'BLOCKED', 'REJECTED', 'CANCELLED'])
  status!: 'OPEN' | 'IN_PROGRESS' | 'PENDING_REVIEW' | 'COMPLETED' | 'OVERDUE' | 'BLOCKED' | 'REJECTED' | 'CANCELLED';

  @IsString()
  @IsOptional()
  evidenceUrl?: string;
}
