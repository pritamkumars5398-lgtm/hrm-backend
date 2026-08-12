import { IsString, Matches, MinLength } from 'class-validator';

export class AttendanceCorrectionDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be in YYYY-MM-DD format.' })
  date!: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Check-in must be in HH:MM format.' })
  checkIn!: string;

  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'Check-out must be in HH:MM format.' })
  checkOut!: string;

  @IsString()
  @MinLength(5, { message: 'Reason must be at least 5 characters long.' })
  reason!: string;
}
