import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

/** Every field optional and defaults to 0/blank server-side — this is "only fill what changed". */
export class SavePayslipDraftDto {
  @IsNumber()
  @Min(0)
  @IsOptional()
  bonus?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  incentive?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  reimbursement?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  otherEarnings?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  incomeTax?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  otherDeduction?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
