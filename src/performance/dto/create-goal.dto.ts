import { IsString, MinLength } from 'class-validator';

export class CreateGoalDto {
  @IsString()
  @MinLength(1, { message: 'Please enter a goal title.' })
  title!: string;

  @IsString()
  dueOn!: string;
}
