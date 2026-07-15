import { IsOptional, IsString } from 'class-validator';

/**
 * Editing an existing Employee HR record. Every field is optional — the client
 * sends only what changed. Access-control fields (permissions, membership) are
 * NOT here: those live in Team Members, not Employee Management (§9).
 */
export class UpdateEmployeeDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  employeeId?: string;

  @IsString()
  @IsOptional()
  contactNumber?: string;

  @IsString()
  @IsOptional()
  homeAddress?: string;

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
}
