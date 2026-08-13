import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const CATEGORIES = [
  'Laptop',
  'Desktop',
  'Monitor',
  'Mobile',
  'Tablet',
  'ID Card',
  'Access Card',
  'Furniture',
  'Vehicle',
  'SIM',
  'Accessory',
  'License',
] as const;

const STATUSES = ['AVAILABLE', 'ASSIGNED', 'REPAIR', 'RETIRED'] as const;

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty({ message: 'Asset name is required.' })
  name!: string;

  @IsIn(CATEGORIES, { message: 'Invalid asset category.' })
  category!: (typeof CATEGORIES)[number];

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  assetTag?: string;
}

export class UpdateAssetStatusDto {
  @IsIn(STATUSES, { message: 'Invalid asset status.' })
  status!: (typeof STATUSES)[number];

  @IsString()
  @IsOptional()
  assignedToId?: string;
}
