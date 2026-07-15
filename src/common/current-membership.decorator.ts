import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Membership } from '../users/user.entity';

/** Pulls the verified Membership that PermissionsGuard put on the request. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Membership => {
    return context.switchToHttp().getRequest().membership;
  },
);
