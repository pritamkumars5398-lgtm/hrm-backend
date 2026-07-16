import { IsInt, IsOptional, Min } from 'class-validator';

export class UpdateLeavePolicyDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  annual?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sick?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  personal?: number;
}
