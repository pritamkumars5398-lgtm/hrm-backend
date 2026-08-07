import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, BadRequestException, SetMetadata, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { randomUUID } from 'node:crypto';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermission = (permission: string) => SetMetadata(PERMISSIONS_KEY, permission);

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const handler = context.getHandler();
    
    // --- 1. User Login & Authentication (JWT) ---
    const jwtUser = request.user;
    if (!jwtUser) {
      throw new UnauthorizedException('You must be logged in.');
    }

    const organizationId = request.headers['x-workspace-id'] as string | undefined;

    // --- 2. Load User Profile & Attributes ---
    let userProfile: any = null;
    let userAttributes: any = {
      role: 'GUEST',
      permissions: [],
      branch: null,
      department: null,
      designation: null,
    };

    if (organizationId) {
      const [user, membership, employee] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: jwtUser.sub } }),
        this.prisma.membership.findUnique({
          where: {
            userId_organizationId: {
              userId: jwtUser.sub,
              organizationId,
            },
          },
        }),
        this.prisma.employee.findUnique({
          where: {
            userId_organizationId: {
              userId: jwtUser.sub,
              organizationId,
            },
          },
        }),
      ]);

      if (membership) {
        userProfile = {
          user,
          organizationId,
          membership,
          employee,
        };

        userAttributes = {
          role: membership.jobTitle || 'MEMBER',
          permissions: membership.permissions || [],
          branch: employee?.workLocation || null,
          department: employee?.department || null,
          designation: employee?.jobTitle || null,
        };

        // Attach userProfile and attributes to the request for reuse
        request.membership = membership;
        request.userProfile = userProfile;
        request.userAttributes = userAttributes;
      }
    }

    // --- 3. Load Resource ---
    const path = request.path;
    const params = request.params;
    let resourceType: string = 'System';
    let resourceId: string | null = null;
    let resourceData: any = null;

    try {
      if (path.includes('/employees') && params.id) {
        resourceType = 'Employee';
        resourceId = params.id;
        resourceData = await this.prisma.employee.findUnique({ where: { id: params.id } });
      } else if (path.includes('/employees') && params.employeeId) {
        resourceType = 'Employee';
        resourceId = params.employeeId;
        resourceData = await this.prisma.employee.findUnique({ where: { id: params.employeeId } });
      } else if (path.includes('/leave') && params.id) {
        resourceType = 'LeaveRequest';
        resourceId = params.id;
        resourceData = await this.prisma.leaveRequest.findUnique({ where: { id: params.id } });
      } else if (path.includes('/payroll') && params.id) {
        resourceType = 'Payslip';
        resourceId = params.id;
        resourceData = await this.prisma.payslip.findUnique({ where: { id: params.id } });
      } else if (path.includes('/payroll') && params.employeeId) {
        resourceType = 'Payslip';
        resourceId = params.employeeId;
        resourceData = await this.prisma.payslip.findFirst({ where: { employeeId: params.employeeId } });
      } else if (path.includes('/forms') && params.id) {
        resourceType = 'FormDefinition';
        resourceId = params.id;
        resourceData = await this.prisma.formDefinition.findUnique({ where: { id: params.id } });
      } else if (path.includes('/invites') && params.id) {
        resourceType = 'Invite';
        resourceId = params.id;
        resourceData = await this.prisma.invite.findUnique({ where: { id: params.id } });
      } else if (path.includes('/organizations') && params.id) {
        resourceType = 'Organization';
        resourceId = params.id;
        resourceData = await this.prisma.organization.findUnique({ where: { id: params.id } });
      }
    } catch {
      // Swallowed lookups so database query hiccups don't break system-wide auth
    }

    // --- 4. Load Policies & Action ---
    const requiredPermission = this.reflector.get<string>(PERMISSIONS_KEY, handler);
    const method = request.method;
    let action = 'READ';
    if (method === 'POST') action = 'CREATE';
    if (method === 'PUT' || method === 'PATCH') action = 'UPDATE';
    if (method === 'DELETE') action = 'DELETE';
    if (path.includes('/decide') || path.includes('/approve') || path.includes('/reject')) {
      action = 'DECIDE';
    }

    // --- 5. Policy Engine Evaluation ---
    let evaluationResult = false;
    let denyDetails = '';

    if (!requiredPermission) {
      evaluationResult = true;
    } else {
      if (!organizationId || !userProfile) {
        denyDetails = 'Missing workspace header or membership details.';
        evaluationResult = false;
      } else {
        const userPermissions = userAttributes.permissions;
        const hasDirectPermission =
          userPermissions.includes('*') ||
          userPermissions.includes(requiredPermission);

        const namespace = requiredPermission.split('.')[0];
        const hasNamespacePermission = userPermissions.includes(`${namespace}.*`);

        if (hasDirectPermission || hasNamespacePermission) {
          evaluationResult = true;
        } else {
          // ABAC Ownership Policy Evaluation Fallback
          const myEmployeeRecord = userProfile.employee;

          if (resourceType === 'Employee' && resourceData) {
            if (resourceData.userId === jwtUser.sub && (action === 'READ' || action === 'UPDATE')) {
              evaluationResult = true;
            }
          } else if (resourceType === 'LeaveRequest' && resourceData) {
            if (myEmployeeRecord && resourceData.employeeId === myEmployeeRecord.id && action === 'READ') {
              evaluationResult = true;
            }
          } else if (resourceType === 'Payslip' && resourceData) {
            if (myEmployeeRecord && resourceData.employeeId === myEmployeeRecord.id && action === 'READ') {
              evaluationResult = true;
            }
          }

          if (!evaluationResult) {
            denyDetails = `Required permission "${requiredPermission}" is missing.`;
          }
        }
      }
    }

    // --- 6. Execute Action & Audit Log ---
    const userEmail = jwtUser.email || '';
    const details = denyDetails || `Access granted to resource: ${resourceType} for action: ${action}`;

    void this.prisma.auditLog.create({
      data: {
        id: `aud-${randomUUID().slice(0, 8)}`,
        organizationId: organizationId || null,
        userId: jwtUser.sub,
        userEmail,
        action,
        resource: resourceType,
        resourceId,
        result: evaluationResult ? 'ALLOW' : 'DENY',
        details,
      },
    }).catch((err) => {
      this.logger.error(`Failed to write audit log: ${err.message}`);
    });

    if (evaluationResult) {
      return true;
    } else {
      throw new ForbiddenException(denyDetails || 'Permission Denied');
    }
  }
}
