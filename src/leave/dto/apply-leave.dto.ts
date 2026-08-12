import { IsIn, IsString, MinLength, IsBoolean, IsOptional } from 'class-validator';
import { LEAVE_TYPES } from '../leave.entity';

export class ApplyLeaveDto {
  @IsIn(LEAVE_TYPES)
  type!: 'ANNUAL' | 'SICK' | 'PERSONAL' | 'UNPAID';

  @IsString()
  startDate!: string;

  @IsString()
  endDate!: string;

  @IsString()
  @MinLength(1, { message: 'Tell us why.' })
  reason!: string;

  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean;

  @IsOptional()
  @IsIn(['FIRST_HALF', 'SECOND_HALF'])
  halfDayPeriod?: 'FIRST_HALF' | 'SECOND_HALF';
}
