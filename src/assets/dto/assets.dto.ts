import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

const CATEGORIES = ['Laptop', 'Desktop', 'Mobile', 'SIM', 'Accessory', 'License'] as const;
const STATUSES = ['AVAILABLE', 'ASSIGNED', 'REPAIR', 'RETIRED'] as const;

export class CreateAssetDto {
  @IsString()
  @IsNotEmpty({ message: 'Asset name is required.' })
  name!: string;

  @IsIn(CATEGORIES, { message: 'Invalid asset category.' })
  category!: 'Laptop' | 'Desktop' | 'Mobile' | 'SIM' | 'Accessory' | 'License';

  @IsString()
  @IsOptional()
  serialNumber?: string;

  @IsString()
  @IsOptional()
  assetTag?: string;
}

export class UpdateAssetStatusDto {
  @IsIn(STATUSES, { message: 'Invalid asset status.' })
  status!: 'AVAILABLE' | 'ASSIGNED' | 'REPAIR' | 'RETIRED';

  @IsString()
  @IsOptional()
  assignedToId?: string;
}
