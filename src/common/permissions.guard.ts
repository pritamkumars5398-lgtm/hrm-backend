import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, BadRequestException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermission = (permission: string) => SetMetadata(PERMISSIONS_KEY, permission);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    if (!user) {
      throw new UnauthorizedException('You must be logged in.');
    }

    const organizationId = request.headers['x-workspace-id'];
    
    if (organizationId) {
      const membership = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.sub,
            organizationId: organizationId as string,
          },
        },
      });

      if (!membership) {
        throw new ForbiddenException('You do not belong to this company.');
      }

      // Attach membership to the request for the controller to use
      request.membership = membership;
    }

    const requiredPermission = this.reflector.get<string>(PERMISSIONS_KEY, context.getHandler());
    
    // If no permission is required, let it pass
    if (!requiredPermission) {
      return true;
    }

    if (!organizationId || !request.membership) {
      throw new BadRequestException('X-Workspace-Id header is required.');
    }

    const membership = request.membership;

    // Check if the membership has the required permission (or all permissions via '*')
    if (membership.permissions.includes('*') || membership.permissions.includes(requiredPermission)) {
      return true;
    }

    // Check wildcard namespace (e.g. required is 'employees.view', user has 'employees.*')
    const namespace = requiredPermission.split('.')[0];
    if (membership.permissions.includes(`${namespace}.*`)) {
      return true;
    }

    return false;
  }
}
