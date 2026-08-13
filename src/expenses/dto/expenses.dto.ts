import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

const CATEGORIES = [
  'Travel',
  'Food',
  'Fuel',
  'Hotel',
  'Client Dinner',
  'Conference',
  'Office Supplies',
  'Internet',
  'Communication',
  'Medical',
  'Training',
  'Equipment',
  'Miscellaneous',
] as const;

export class CreateExpenseClaimDto {
  @IsString()
  @IsNotEmpty({ message: 'Title is required.' })
  title!: string;

  @IsIn(CATEGORIES, { message: 'Invalid expense category.' })
  category!: (typeof CATEGORIES)[number];

  @IsNumber({}, { message: 'Amount must be a number.' })
  @Min(0.01, { message: 'Amount must be greater than 0.' })
  amount!: number;

  @IsString()
  @IsOptional()
  receiptUrl?: string;

  @IsString()
  @IsNotEmpty({ message: 'Claim date is required.' })
  claimDate!: string;
}
