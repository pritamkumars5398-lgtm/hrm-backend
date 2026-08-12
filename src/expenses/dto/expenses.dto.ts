import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

const CATEGORIES = ['Travel', 'Food', 'Fuel', 'Hotel', 'Miscellaneous'] as const;

export class CreateExpenseClaimDto {
  @IsString()
  @IsNotEmpty({ message: 'Title is required.' })
  title!: string;

  @IsIn(CATEGORIES, { message: 'Invalid expense category.' })
  category!: 'Travel' | 'Food' | 'Fuel' | 'Hotel' | 'Miscellaneous';

  @IsNumber({}, { message: 'Amount must be a number.' })
  amount!: number;

  @IsString()
  @IsOptional()
  receiptUrl?: string;

  @IsString()
  @IsNotEmpty({ message: 'Claim date is required.' })
  claimDate!: string;
}
