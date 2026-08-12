import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

const CATEGORIES = ['Appraisal', 'Survey', 'Feedback', 'Onboarding'] as const;
const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'RATING', 'SELECT', 'FILE', 'DATE', 'TOGGLE'] as const;

export class FormFieldDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  label!: string;

  @IsIn(FIELD_TYPES, { message: 'Invalid field type.' })
  type!: 'TEXT' | 'TEXTAREA' | 'RATING' | 'SELECT' | 'FILE' | 'DATE' | 'TOGGLE';

  @IsBoolean()
  required!: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  options?: string[];
}

export class CreateFormDto {
  @IsString()
  @IsNotEmpty({ message: 'Form title is required.' })
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsIn(CATEGORIES, { message: 'Invalid form category.' })
  category!: 'Appraisal' | 'Survey' | 'Feedback' | 'Onboarding';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FormFieldDto)
  fields!: FormFieldDto[];
}

export class SubmitResponseDto {
  @IsString()
  @IsNotEmpty({ message: 'Respondent name is required.' })
  respondentName!: string;

  @IsNotEmpty({ message: 'Answers are required.' })
  answers!: Record<string, string | number | boolean>;
}
