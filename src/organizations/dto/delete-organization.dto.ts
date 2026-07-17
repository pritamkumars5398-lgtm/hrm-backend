import { IsString, MinLength } from 'class-validator';

export class DeleteOrganizationDto {
  /** Must exactly match the company's current name — the server-side half of
   *  the type-to-confirm UI, so this destructive endpoint isn't triggerable
   *  by knowing the id alone. */
  @IsString()
  @MinLength(1)
  confirmName!: string;
}
