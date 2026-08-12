import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;

export class TimeRowDto {
  @IsString()
  @IsNotEmpty()
  client!: string;

  @IsString()
  @IsNotEmpty()
  project!: string;

  @IsString()
  @IsNotEmpty()
  task!: string;

  @IsArray()
  @IsNumber({}, { each: true })
  hours!: number[];

  @IsBoolean()
  isBillable!: boolean;
}

export class SaveTimesheetDto {
  @IsString()
  @IsNotEmpty({ message: 'Week start date is required.' })
  weekStartDate!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TimeRowDto)
  rows!: TimeRowDto[];
}

export class UpdateTimesheetStatusDto {
  @IsIn(STATUSES, { message: 'Invalid timesheet status.' })
  status!: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';
}
