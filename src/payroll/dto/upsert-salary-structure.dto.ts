import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

/**
 * Creates a new salary revision for an employee. There is no PATCH — a change
 * to Basic/HRA/Other Allowance is a new revision effective from a given month,
 * not an edit of history (§ salary structure versioning).
 */
export class UpsertSalaryStructureDto {
  @IsInt()
  @Min(0)
  basic!: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  hra?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  otherAllowance?: number;

  // YYYY-MM-01 — always the 1st of a month. Month is constrained to 01-12,
  // not just "two digits" — a client sending "2026-13-01" should 400, not
  // silently sort ahead of every real December revision.
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])-01$/, { message: 'effectiveFrom must be the 1st of a month (YYYY-MM-01).' })
  effectiveFrom!: string;
}
