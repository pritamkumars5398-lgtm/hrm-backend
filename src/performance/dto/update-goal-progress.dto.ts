import { IsInt, Max, Min } from 'class-validator';

export class UpdateGoalProgressDto {
  @IsInt()
  @Min(0)
  @Max(100)
  progress!: number;
}
