import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class CreateTravelRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'Destination is required.' })
  destination!: string;

  @IsString()
  @IsNotEmpty({ message: 'Start date is required.' })
  startDate!: string;

  @IsString()
  @IsNotEmpty({ message: 'End date is required.' })
  endDate!: string;

  @IsString()
  @IsNotEmpty({ message: 'Purpose of travel is required.' })
  purpose!: string;

  @IsNumber({}, { message: 'Estimated cost must be a number.' })
  estimatedCost!: number;
}

export class UpdateTravelBookingDto {
  @IsString()
  @IsNotEmpty({ message: 'Booking details are required.' })
  bookingDetails!: string;
}

export class CancelTravelDto {
  @IsString()
  @IsNotEmpty({ message: 'Cancellation reason is required.' })
  cancellationReason!: string;
}
