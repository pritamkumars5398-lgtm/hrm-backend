import { IsIn, IsString, MinLength } from 'class-validator';
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
}
