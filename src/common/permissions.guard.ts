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
    
    // ==========================================
    // STEP 1: USER LOGIN / GOOGLE IDENTITY AUTH
    // ==========================================
    const jwtUser = request.user;
    if (!jwtUser) {
      throw new UnauthorizedException('User Login: Authentication failed.');
    }

    // ==========================================
    // STEP 2: VERIFY PASSWORD / SSO / MFA
    // ==========================================
    // JWT signature validation occurred in JwtAuthGuard. 
    // If google login was used, sub starts with 'goog' or the email is associated with OAuth.
    const isGoogleSSO = jwtUser.email?.endsWith('@gmail.com') || false; 

    // ==========================================
    // STEP 3: IDENTITY VERIFIED
    // ==========================================
    // The request identity is verified. Proceeding to load profiles.

    const organizationId = request.headers['x-workspace-id'] as string | undefined;

    // ==========================================
    // STEP 4: LOAD USER PROFILE METADATA
    // ==========================================
    let userProfileMetadata = {
      userId: jwtUser.sub,
      organization: organizationId || 'None',
      organizationalUnit: 'Default OU',
      groups: [] as string[],
      customAttributes: {} as Record<string, any>,
      licenses: 'STARTER',
      status: 'ACTIVE',
    };

    let userProfile: any = null;

    if (organizationId) {
      const [user, membership, employee, organization] = await Promise.all([
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
        this.prisma.organization.findUnique({
          where: { id: organizationId },
        }),
      ]);

      if (membership) {
        userProfile = { user, membership, employee, organization };

        // Determine License via Tenant plan if available, or fallback to STARTER
        let licenseTier = 'STARTER';
        try {
          const tenant = await this.prisma.tenant.findFirst({
            where: { id: organizationId },
          });
          if (tenant) {
            licenseTier = tenant.plan;
          }
        } catch {
          // Fallback to STARTER
        }

        userProfileMetadata = {
          userId: jwtUser.sub,
          organization: organizationId,
          organizationalUnit: employee?.department || 'General Administration',
          groups: [
            membership.jobTitle || 'Member',
            employee?.workLocation || 'Office-Default',
          ],
          customAttributes: {
            employmentType: employee?.employmentType || 'Full-time',
            startDate: employee?.startDate ? employee.startDate.toISOString() : null,
            googleSSO: isGoogleSSO,
          },
          licenses: licenseTier,
          status: employee?.deletedAt ? 'INACTIVE' : 'ACTIVE',
        };

        // Attach for downstream controllers
        request.membership = membership;
        request.userProfile = userProfile;
      }
    }

    if (organizationId && userProfileMetadata.status === 'INACTIVE') {
      throw new ForbiddenException('Your employee profile is inactive.');
    }

    // ==========================================
    // STEP 5: USER REQUESTS RESOURCE & LOAD METADATA
    // ==========================================
    const path = request.path;
    const params = request.params;
    let resourceMetadata = {
      resourceType: 'System',
      resourceOwner: 'System',
      sharingSettings: 'RESTRICTED',
      labels: [] as string[],
      status: 'ACTIVE',
    };

    let resourceId: string | null = null;
    let resourceData: any = null;

    try {
      if (path.includes('/employees') && params.id) {
        resourceMetadata.resourceType = 'Employee';
        resourceId = params.id;
        resourceData = await this.prisma.employee.findUnique({ where: { id: params.id } });
        if (resourceData) {
          resourceMetadata.resourceOwner = resourceData.userId;
          resourceMetadata.sharingSettings = 'DEPARTMENT_PRIVATE';
          resourceMetadata.labels = [resourceData.department, resourceData.jobTitle];
          resourceMetadata.status = resourceData.deletedAt ? 'INACTIVE' : 'ACTIVE';
        }
      } else if (path.includes('/employees') && params.employeeId) {
        resourceMetadata.resourceType = 'Employee';
        resourceId = params.employeeId;
        resourceData = await this.prisma.employee.findUnique({ where: { id: params.employeeId } });
        if (resourceData) {
          resourceMetadata.resourceOwner = resourceData.userId;
          resourceMetadata.sharingSettings = 'DEPARTMENT_PRIVATE';
          resourceMetadata.labels = [resourceData.department, resourceData.jobTitle];
          resourceMetadata.status = resourceData.deletedAt ? 'INACTIVE' : 'ACTIVE';
        }
      } else if (path.includes('/leave') && params.id) {
        resourceMetadata.resourceType = 'LeaveRequest';
        resourceId = params.id;
        resourceData = await this.prisma.leaveRequest.findUnique({ where: { id: params.id } });
        if (resourceData) {
          resourceMetadata.resourceOwner = resourceData.employeeId;
          resourceMetadata.sharingSettings = 'APPROVAL_LOCKED';
          resourceMetadata.labels = [resourceData.type];
          resourceMetadata.status = resourceData.status; // PENDING / APPROVED / REJECTED
        }
      } else if (path.includes('/payroll') && params.id) {
        resourceMetadata.resourceType = 'Payslip';
        resourceId = params.id;
        resourceData = await this.prisma.payslip.findUnique({ where: { id: params.id } });
        if (resourceData) {
          resourceMetadata.resourceOwner = resourceData.employeeId;
          resourceMetadata.sharingSettings = 'CONFIDENTIAL';
          resourceMetadata.labels = [resourceData.month];
          resourceMetadata.status = resourceData.status; // DRAFT / FINALIZED
        }
      } else if (path.includes('/forms') && params.id) {
        resourceMetadata.resourceType = 'FormDefinition';
        resourceId = params.id;
        resourceData = await this.prisma.formDefinition.findUnique({ where: { id: params.id } });
        if (resourceData) {
          resourceMetadata.resourceOwner = 'Organization';
          resourceMetadata.sharingSettings = 'ORGANIZATION_SHARED';
          resourceMetadata.labels = [resourceData.category];
          resourceMetadata.status = resourceData.status; // DRAFT / PUBLISHED
        }
      }
    } catch {
      // Graceful fallback for queries
    }

    // ==========================================
    // STEP 6: LOAD ORGANIZATION POLICIES
    // ==========================================
    const requiredPermission = this.reflector.get<string>(PERMISSIONS_KEY, handler);
    const method = request.method;
    let action = 'READ';
    if (method === 'POST') action = 'CREATE';
    if (method === 'PUT' || method === 'PATCH') action = 'UPDATE';
    if (method === 'DELETE') action = 'DELETE';
    if (path.includes('/decide') || path.includes('/approve') || path.includes('/reject')) {
      action = 'DECIDE';
    }

    const loadedPolicies = {
      requiredPermission: requiredPermission || 'PUBLIC_ACCESS',
      action,
      resourceType: resourceMetadata.resourceType,
    };

    // ==========================================
    // STEP 7: POLICY EVALUATION ENGINE
    // ==========================================
    let isAllowed = false;
    let policyDetails = '';

    if (!requiredPermission) {
      isAllowed = true;
      policyDetails = 'Public access policy allowed.';
    } else {
      if (!organizationId || !userProfile) {
        policyDetails = 'Missing workspace header or membership details.';
        isAllowed = false;
      } else if (userProfileMetadata.status === 'INACTIVE') {
        policyDetails = 'Access Denied: Your employee profile is inactive.';
        isAllowed = false;
      } else {
        const userPermissions = userProfileMetadata.groups; // derived roles / permissions
        const membershipPermissions = userProfile.membership.permissions || [];

        const hasDirectPermission =
          membershipPermissions.includes('*') ||
          membershipPermissions.includes(requiredPermission);

        const namespace = requiredPermission.split('.')[0];
        const hasNamespacePermission = membershipPermissions.includes(`${namespace}.*`);

        if (hasDirectPermission || hasNamespacePermission) {
          isAllowed = true;
          policyDetails = `RBAC Policy Evaluator: Permission "${requiredPermission}" matched.`;
        } else {
          // ABAC Contextual Policy Evaluator Fallback:
          const myEmployeeRecord = userProfile.employee;

          if (resourceMetadata.resourceType === 'Employee' && resourceData) {
            if (resourceData.userId === jwtUser.sub && (action === 'READ' || action === 'UPDATE')) {
              isAllowed = true;
              policyDetails = 'ABAC Policy Evaluator: User owns this employee profile.';
            }
          } else if (resourceMetadata.resourceType === 'LeaveRequest' && resourceData) {
            if (myEmployeeRecord && resourceData.employeeId === myEmployeeRecord.id && action === 'READ') {
              isAllowed = true;
              policyDetails = 'ABAC Policy Evaluator: User is the creator of this leave request.';
            }
          } else if (resourceMetadata.resourceType === 'Payslip' && resourceData) {
            if (myEmployeeRecord && resourceData.employeeId === myEmployeeRecord.id && action === 'READ') {
              isAllowed = true;
              policyDetails = 'ABAC Policy Evaluator: User is the owner of this payslip.';
            }
          }

          if (!isAllowed) {
            policyDetails = `RBAC/ABAC Evaluation: Denied. Required permission "${requiredPermission}" not satisfied.`;
          }
        }
      }
    }

    // ==========================================
    // STEP 8: AUDIT & ACTIVITY LOGS (ALLOW / DENY)
    // ==========================================
    const userEmail = jwtUser.email || '';
    const logDetails = {
      isGoogleSSO,
      userProfileMetadata,
      resourceMetadata,
      loadedPolicies,
      policyDetails,
    };

    void this.prisma.auditLog.create({
      data: {
        id: `aud-${randomUUID().slice(0, 8)}`,
        organizationId: organizationId || null,
        userId: jwtUser.sub,
        userEmail,
        action,
        resource: resourceMetadata.resourceType,
        resourceId,
        result: isAllowed ? 'ALLOW' : 'DENY',
        details: JSON.stringify(logDetails),
      },
    }).catch((err) => {
      this.logger.error(`Failed to write audit log: ${err.message}`);
    });

    // ==========================================
    // STEP 9: EXECUTE ACTION / DENY ACCESS
    // ==========================================
    if (isAllowed) {
      return true;
    } else {
      throw new ForbiddenException(policyDetails || 'Permission Denied');
    }
  }
}
