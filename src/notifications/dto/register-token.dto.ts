import { IsString, MinLength } from 'class-validator';

export class RegisterTokenDto {
  @IsString()
  @MinLength(1)
  token!: string;
}
