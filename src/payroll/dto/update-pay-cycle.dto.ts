import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdatePayCycleDto {
  @IsIn(['FIXED', 'RANGE'])
  type!: 'FIXED' | 'RANGE';

  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  fixedDay?: number;

  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  rangeStart?: number;

  @IsInt()
  @Min(1)
  @Max(31)
  @IsOptional()
  rangeEnd?: number;
}
