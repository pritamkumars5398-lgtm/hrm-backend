import { IsArray, IsString } from 'class-validator';

/**
 * No enum restriction on which keys can be sent — the Owner can grant anyone
 * any of the granular permission keys, in any combination (§10: not tied to
 * the three role presets). The one thing this can never do is touch a
 * membership that already holds `*` — enforced in the controller, mirroring
 * the same guard `DELETE /members/:id` already uses.
 */
export class UpdateMembershipPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}
