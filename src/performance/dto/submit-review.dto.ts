import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class SubmitReviewDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @MinLength(1, { message: 'Please enter a review summary.' })
  summary!: string;
}
