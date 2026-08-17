import { Injectable, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ApprovalsService } from '../approvals/approvals.service';
import {
  CreateFrameworkDto,
  CreateRequirementDto,
  CreateExceptionDto,
  UpdateViolationDto,
  CreateRiskDto,
  AcknowledgePolicyDto,
  UpdateCourseProgressDto,
  CreateComplianceTaskDto,
  UpdateComplianceTaskStatusDto,
} from './dto/compliance.dto';

@Injectable()
export class ComplianceService {
  constructor(
    public readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => ApprovalsService))
    private readonly approvals: ApprovalsService,
  ) {}

  // ==========================================
  // 1. FRAMEWORKS CRUD
  // ==========================================

  async createFramework(organizationId: string, dto: CreateFrameworkDto) {
    const existing = await this.prisma.complianceFramework.findFirst({
      where: { organizationId, code: dto.code },
    });
    if (existing) {
      throw new BadRequestException(`Framework with code "${dto.code}" already exists in this organization.`);
    }

    return this.prisma.complianceFramework.create({
      data: {
        id: `frm-${randomUUID().slice(0, 8)}`,
        organizationId,
        name: dto.name,
        code: dto.code,
        description: dto.description ?? null,
        jurisdiction: dto.jurisdiction,
        version: dto.version,
        effectiveFrom: dto.effectiveFrom,
        effectiveUntil: dto.effectiveUntil ?? null,
        status: 'ACTIVE',
      },
    });
  }

  async listFrameworks(organizationId: string) {
    return this.prisma.complianceFramework.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================
  // 2. REQUIREMENTS CRUD
  // ==========================================

  async createRequirement(organizationId: string, dto: CreateRequirementDto) {
    const existing = await this.prisma.complianceRequirement.findFirst({
      where: { organizationId, code: dto.code },
    });
    if (existing) {
      throw new BadRequestException(`Requirement with code "${dto.code}" already exists in this organization.`);
    }

    const requirement = await this.prisma.complianceRequirement.create({
      data: {
        id: `req-${randomUUID().slice(0, 8)}`,
        organizationId,
        frameworkId: dto.frameworkId ?? null,
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        category: dto.category,
        mandatory: dto.mandatory ?? true,
        frequency: dto.frequency,
        riskLevel: dto.riskLevel,
        evidenceRequired: dto.evidenceRequired ?? false,
        verificationRequired: dto.verificationRequired ?? false,
        approvalRequired: dto.approvalRequired ?? false,
        responsibleOwnerId: dto.responsibleOwnerId ?? null,
        applicabilityRules: dto.applicabilityRules ?? '{}',
        status: 'ACTIVE',
      },
    });

    // Automatically trigger applicability scan for all active employees
    await this.runApplicabilityScan(organizationId);

    return requirement;
  }

  async listRequirements(organizationId: string) {
    return this.prisma.complianceRequirement.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================
  // 3. APPLICABILITY & STATUS CALCULATIONS
  // ==========================================

  async runApplicabilityScan(organizationId: string) {
    const [allEmployees, requirements] = await Promise.all([
      this.prisma.employee.findMany({ where: { organizationId } }),
      this.prisma.complianceRequirement.findMany({ where: { organizationId, status: 'ACTIVE' } }),
    ]);

    const employees = allEmployees.filter(e => !e.deletedAt);

    for (const employee of employees) {
      await this.evalApplicability(employee.id, organizationId, requirements);
    }
  }

  async evalApplicability(employeeId: string, organizationId: string, preloadedRequirements?: any[]) {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || employee.deletedAt) return;

    const requirements = preloadedRequirements ?? await this.prisma.complianceRequirement.findMany({
      where: { organizationId, status: 'ACTIVE' },
    });

    for (const req of requirements) {
      let applies = true;
      try {
        const rules = JSON.parse(req.applicabilityRules || '{}');
        
        // Simple criteria matching: location, department, employmentType, status
        if (rules.location && employee.workLocation !== rules.location) applies = false;
        if (rules.department && employee.department !== rules.department) applies = false;
        if (rules.employmentType && employee.employmentType !== rules.employmentType) applies = false;
      } catch {
        // Fallback: If JSON is invalid, assume requirement applies to all
      }

      if (applies) {
        // Ensure obligation exists
        let obligation = await this.prisma.complianceObligation.findFirst({
          where: { targetId: employeeId, requirementId: req.id },
        });

        if (!obligation) {
          obligation = await this.prisma.complianceObligation.create({
            data: {
              id: `obl-${randomUUID().slice(0, 8)}`,
              organizationId,
              requirementId: req.id,
              targetType: 'EMPLOYEE',
              targetId: employeeId,
              status: 'PENDING',
              dueDate: this.calculateDueDate(req.frequency),
            },
          });
        }
        await this.recalculateStatus(obligation.id, organizationId);
      } else {
        // Remove obligation if it no longer applies
        await this.prisma.complianceObligation.deleteMany({
          where: { targetId: employeeId, requirementId: req.id },
        });
      }
    }
  }

  async recalculateStatus(obligationId: string, organizationId: string) {
    const obligation = await this.prisma.complianceObligation.findUnique({ where: { id: obligationId } });
    if (!obligation) return;

    const requirement = await this.prisma.complianceRequirement.findUnique({ where: { id: obligation.requirementId } });
    if (!requirement) return;

    // 1. Check Approved Exceptions (Waivers)
    const activeException = await this.prisma.complianceException.findFirst({
      where: {
        obligationId,
        status: 'APPROVED',
      },
    });

    const currentDateStr = new Date().toISOString().split('T')[0];
    if (activeException && currentDateStr >= activeException.startDate && currentDateStr <= activeException.endDate) {
      await this.prisma.complianceObligation.update({
        where: { id: obligationId },
        data: { status: 'WAIVED', complianceScore: 100, lastEvaluatedAt: new Date() },
      });
      return;
    }

    let calculatedStatus: string = 'PENDING';
    let score = 0;

    // 2. Evaluate status by category
    const employee = await this.prisma.employee.findUnique({ where: { id: obligation.targetId } });
    if (!employee) return;

    switch (requirement.category) {
      case 'DOCUMENT': {
        const doc = await this.prisma.document.findFirst({
          where: {
            organizationId,
            employeeId: employee.id,
            deletedAt: null,
            OR: [
              { name: { contains: requirement.code, mode: 'insensitive' } },
              { name: { contains: requirement.name, mode: 'insensitive' } },
              { description: { contains: requirement.code, mode: 'insensitive' } },
              { category: 'Compliance' },
            ],
          },
        });

        if (doc) {
          if (requirement.verificationRequired && doc.status !== 'VERIFIED') {
            if (doc.status === 'REJECTED') {
              calculatedStatus = 'NON_COMPLIANT';
              score = 0;
            } else {
              calculatedStatus = 'UNDER_REVIEW';
              score = 50;
            }
          } else {
            // Verify expiry
            if (doc.expiryDate) {
              if (currentDateStr > doc.expiryDate) {
                calculatedStatus = 'EXPIRED';
                score = 0;
                await this.triggerViolation(organizationId, obligationId, 'EXPIRED_DOCUMENT', `Required document "${requirement.name}" has expired (expired on ${doc.expiryDate}).`);
              } else if (this.isExpiringSoon(doc.expiryDate, 30)) {
                calculatedStatus = 'EXPIRING_SOON';
                score = 80;
              } else {
                calculatedStatus = 'COMPLIANT';
                score = 100;
              }
            } else {
              calculatedStatus = 'COMPLIANT';
              score = 100;
            }
          }
        } else {
          // No document found
          if (obligation.dueDate && currentDateStr > obligation.dueDate) {
            calculatedStatus = 'OVERDUE';
            score = 0;
            await this.triggerViolation(organizationId, obligationId, 'MISSING_DOCUMENT', `Required document "${requirement.name}" is overdue.`);
          } else {
            calculatedStatus = 'PENDING';
            score = 0;
          }
        }
        break;
      }

      case 'POLICY': {
        const ack = await this.prisma.policyAcknowledgement.findFirst({
          where: {
            organizationId,
            employeeId: employee.id,
            policyId: requirement.code, // requirement code stores policy document id
          },
        });

        if (ack) {
          calculatedStatus = 'COMPLIANT';
          score = 100;
        } else {
          if (obligation.dueDate && currentDateStr > obligation.dueDate) {
            calculatedStatus = 'OVERDUE';
            score = 0;
            await this.triggerViolation(organizationId, obligationId, 'POLICY_UNACKNOWLEDGED', `Policy acknowledgement for "${requirement.name}" is overdue.`);
          } else {
            calculatedStatus = 'PENDING';
            score = 0;
          }
        }
        break;
      }

      case 'TRAINING': {
        const assignment = await this.prisma.courseAssignment.findFirst({
          where: {
            organizationId,
            employeeId: employee.id,
            courseId: requirement.code, // requirement code stores Course.id
          },
        });

        if (assignment && (assignment.status === 'COMPLETED' || assignment.progress === 100)) {
          calculatedStatus = 'COMPLIANT';
          score = 100;
        } else {
          if (obligation.dueDate && currentDateStr > obligation.dueDate) {
            calculatedStatus = 'OVERDUE';
            score = 0;
            await this.triggerViolation(organizationId, obligationId, 'TRAINING_OVERDUE', `Mandatory training course "${requirement.name}" is overdue.`);
          } else {
            calculatedStatus = assignment ? 'IN_PROGRESS' : 'PENDING';
            score = assignment ? assignment.progress : 0;
          }
        }
        break;
      }

      case 'ONBOARDING': {
        const onboarding = await this.prisma.onboarding.findUnique({
          where: { employeeId: employee.id },
        });

        if (onboarding) {
          if (onboarding.status === 'COMPLETED') {
            calculatedStatus = 'COMPLIANT';
            score = 100;
          } else {
            calculatedStatus = 'IN_PROGRESS';
            const tasks = await this.prisma.onboardingTask.findMany({ where: { onboardingId: onboarding.id } });
            const completedCount = tasks.filter(t => t.status === 'COMPLETED').length;
            score = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;
          }
        } else {
          calculatedStatus = 'PENDING';
          score = 0;
        }
        break;
      }

      case 'ATTENDANCE': {
        // Evaluate late count in the last 30 days
        const last30Days = new Date();
        last30Days.setDate(last30Days.getDate() - 30);
        const orgSettings = await this.prisma.organization.findUnique({ where: { id: organizationId } });
        const lateThreshold = orgSettings?.attendanceLateThreshold || '09:30';

        const punches = await this.prisma.attendanceRecord.findMany({
          where: {
            organizationId,
            employeeId: employee.id,
            checkIn: { gte: last30Days },
          },
        });

        let lateCount = 0;
        punches.forEach(p => {
          if (p.checkIn) {
            const checkInTime = p.checkIn.toISOString().split('T')[1].substring(0, 5); // HH:MM
            if (checkInTime > lateThreshold) {
              lateCount++;
            }
          }
        });

        if (lateCount > 5) {
          calculatedStatus = 'NON_COMPLIANT';
          score = 50;
          await this.triggerViolation(organizationId, obligationId, 'EXCESSIVE_LATENESS', `Employee has breached late punch threshold ${lateCount} times in the last 30 days.`);
        } else {
          calculatedStatus = 'COMPLIANT';
          score = 100;
        }
        break;
      }

      default: {
        calculatedStatus = 'COMPLIANT';
        score = 100;
        break;
      }
    }

    await this.prisma.complianceObligation.update({
      where: { id: obligationId },
      data: { status: calculatedStatus, complianceScore: score, lastEvaluatedAt: new Date() },
    });
  }

  // ==========================================
  // 4. VIOLATIONS & EXCEPTIONS
  // ==========================================

  async triggerViolation(organizationId: string, obligationId: string, type: string, description: string) {
    const existing = await this.prisma.complianceViolation.findFirst({
      where: { organizationId, obligationId, type, status: { in: ['OPEN', 'INVESTIGATING', 'ACTION_REQUIRED'] } },
    });
    if (existing) return; // Already flagged

    const obligation = await this.prisma.complianceObligation.findUnique({ where: { id: obligationId } });
    if (!obligation) return;

    await this.prisma.complianceViolation.create({
      data: {
        id: `vio-${randomUUID().slice(0, 8)}`,
        organizationId,
        obligationId,
        type,
        severity: 'HIGH',
        targetType: obligation.targetType,
        targetId: obligation.targetId,
        description,
        detectedDate: new Date().toISOString().split('T')[0],
        status: 'OPEN',
        historyJson: JSON.stringify([{ action: 'DETECTED', timestamp: new Date().toISOString(), details: description }]),
      },
    });

    // Notify Compliance Admins
    const admins = await this.prisma.membership.findMany({ where: { organizationId } });
    const adminUserIds = admins
      .filter(m => m.permissions.includes('*') || m.permissions.includes('compliance.manage'))
      .map(m => m.userId);

    if (adminUserIds.length) {
      await this.notifications.createForMany(adminUserIds, {
        organizationId,
        title: 'New Compliance Violation Detected',
        body: description,
        kind: 'compliance',
        link: '/dashboard/compliance',
      });
    }
  }

  async listViolations(organizationId: string) {
    return this.prisma.complianceViolation.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateViolation(id: string, organizationId: string, userId: string, dto: UpdateViolationDto) {
    const violation = await this.prisma.complianceViolation.findUnique({ where: { id } });
    if (!violation || violation.organizationId !== organizationId) {
      throw new NotFoundException('Violation not found.');
    }

    const history = JSON.parse(violation.historyJson || '[]');
    history.push({
      action: dto.status || 'UPDATE',
      userId,
      reason: dto.correctiveAction,
      timestamp: new Date().toISOString(),
    });

    const updated = await this.prisma.complianceViolation.update({
      where: { id },
      data: {
        status: dto.status ?? violation.status,
        correctiveAction: dto.correctiveAction ?? violation.correctiveAction,
        dueDate: dto.dueDate ?? violation.dueDate,
        evidenceUrl: dto.evidenceUrl ?? violation.evidenceUrl,
        ownerId: dto.ownerId ?? violation.ownerId,
        historyJson: JSON.stringify(history),
      },
    });

    if (updated.obligationId && updated.status === 'RESOLVED') {
      await this.recalculateStatus(updated.obligationId, organizationId);
    }

    return updated;
  }

  async requestException(organizationId: string, requesterUserId: string, dto: CreateExceptionDto) {
    const obligation = await this.prisma.complianceObligation.findUnique({ where: { id: dto.obligationId } });
    if (!obligation || obligation.organizationId !== organizationId) {
      throw new NotFoundException('Obligation not found.');
    }

    const exception = await this.prisma.complianceException.create({
      data: {
        id: `exc-${randomUUID().slice(0, 8)}`,
        organizationId,
        obligationId: dto.obligationId,
        requestedById: dto.requestedById,
        reason: dto.reason,
        scope: dto.scope,
        startDate: dto.startDate,
        endDate: dto.endDate,
        status: 'PENDING',
      },
    });

    // Create central approval request
    await this.approvals.createApproval(
      organizationId,
      dto.requestedById,
      'ComplianceException',
      exception.id,
      `Compliance Waiver: ${obligation.requirementId}`,
      `Exception requested for obligation ${dto.obligationId} by Employee ${dto.requestedById}. Reason: ${dto.reason}`,
    );

    return exception;
  }

  async listExceptions(organizationId: string) {
    return this.prisma.complianceException.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ==========================================
  // 5. COMPLIANCE TASKS
  // ==========================================

  async createTask(organizationId: string, obligationId: string | null, assignedToId: string, title: string, description: string, priority: string, dueDate: string) {
    return this.prisma.complianceTask.create({
      data: {
        id: `tsk-${randomUUID().slice(0, 8)}`,
        organizationId,
        obligationId,
        assignedToId,
        title,
        description,
        priority,
        dueDate,
        status: 'OPEN',
      },
    });
  }

  async listTasks(organizationId: string) {
    return this.prisma.complianceTask.findMany({
      where: { organizationId },
      orderBy: { dueDate: 'asc' },
    });
  }

  async updateTaskStatus(id: string, organizationId: string, status: string, evidenceUrl?: string) {
    const task = await this.prisma.complianceTask.findUnique({ where: { id } });
    if (!task || task.organizationId !== organizationId) {
      throw new NotFoundException('Task not found.');
    }

    const updated = await this.prisma.complianceTask.update({
      where: { id },
      data: {
        status,
        evidenceUrl: evidenceUrl ?? task.evidenceUrl,
      },
    });

    if (updated.obligationId) {
      await this.recalculateStatus(updated.obligationId, organizationId);
    }

    return updated;
  }

  // ==========================================
  // 6. RISKS REGISTRY
  // ==========================================

  async createRisk(organizationId: string, dto: CreateRiskDto) {
    const score = dto.likelihood * dto.impact;
    let severity = 'LOW';
    if (score >= 15) severity = 'CRITICAL';
    else if (score >= 10) severity = 'HIGH';
    else if (score >= 5) severity = 'MEDIUM';

    return this.prisma.complianceRisk.create({
      data: {
        id: `rsk-${randomUUID().slice(0, 8)}`,
        organizationId,
        category: dto.category,
        likelihood: dto.likelihood,
        impact: dto.impact,
        riskScore: score,
        severity,
        ownerId: dto.ownerId ?? null,
        mitigation: dto.mitigation ?? null,
        status: 'IDENTIFIED',
      },
    });
  }

  async listRisks(organizationId: string) {
    return this.prisma.complianceRisk.findMany({
      where: { organizationId },
      orderBy: { riskScore: 'desc' },
    });
  }

  // ==========================================
  // 7. DASHBOARD METRICS
  // ==========================================

  async getDashboard(organizationId: string) {
    const [obligations, violations, risks] = await Promise.all([
      this.prisma.complianceObligation.findMany({ where: { organizationId } }),
      this.prisma.complianceViolation.findMany({ where: { organizationId } }),
      this.prisma.complianceRisk.findMany({ where: { organizationId } }),
    ]);

    const total = obligations.length;
    const compliant = obligations.filter(o => o.status === 'COMPLIANT' || o.status === 'WAIVED').length;
    const nonCompliant = obligations.filter(o => o.status === 'NON_COMPLIANT' || o.status === 'EXPIRED').length;
    const pending = obligations.filter(o => o.status === 'PENDING' || o.status === 'IN_PROGRESS' || o.status === 'UNDER_REVIEW').length;
    const overdue = obligations.filter(o => o.status === 'OVERDUE').length;

    const healthScore = total > 0 ? Math.round((compliant / total) * 100) : 100;

    return {
      healthScore,
      totalCount: total,
      compliantCount: compliant,
      nonCompliantCount: nonCompliant,
      pendingCount: pending,
      overdueCount: overdue,
      activeViolations: violations.filter(v => v.status !== 'RESOLVED' && v.status !== 'CLOSED').length,
      riskLevel: risks.length > 0 ? risks[0].severity : 'LOW',
      obligations: obligations.map(o => ({
        id: o.id,
        status: o.status,
        dueDate: o.dueDate,
        score: o.complianceScore,
      })),
    };
  }

  // ==========================================
  // HELPERS
  // ==========================================

  private calculateDueDate(frequency: string): string {
    const date = new Date();
    if (frequency === 'MONTHLY') date.setMonth(date.getMonth() + 1);
    else if (frequency === 'QUARTERLY') date.setMonth(date.getMonth() + 3);
    else if (frequency === 'ANNUALLY') date.setFullYear(date.getFullYear() + 1);
    else date.setDate(date.getDate() + 30); // Default 30 days
    return date.toISOString().split('T')[0];
  }

  private isExpiringSoon(expiryDateStr: string, limitDays: number): boolean {
    const expiry = new Date(expiryDateStr);
    const today = new Date();
    const diffTime = expiry.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 && diffDays <= limitDays;
  }

  async acknowledgePolicy(organizationId: string, employeeId: string, dto: AcknowledgePolicyDto) {
    const existing = await this.prisma.policyAcknowledgement.findFirst({
      where: { employeeId, policyId: dto.policyId, version: dto.version },
    });
    if (existing) {
      return existing;
    }

    const created = await this.prisma.policyAcknowledgement.create({
      data: {
        id: `ack-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId,
        policyId: dto.policyId,
        version: dto.version,
      },
    });

    // Re-evaluate matching obligations
    const obligations = await this.prisma.complianceObligation.findMany({
      where: { organizationId, targetId: employeeId },
    });
    for (const obl of obligations) {
      const req = await this.prisma.complianceRequirement.findUnique({ where: { id: obl.requirementId } });
      if (req && req.category === 'POLICY' && req.code === dto.policyId) {
        await this.recalculateStatus(obl.id, organizationId);
      }
    }

    return created;
  }

  async updateCourseProgress(organizationId: string, employeeId: string, courseId: string, dto: UpdateCourseProgressDto) {
    const existing = await this.prisma.courseAssignment.findFirst({
      where: { employeeId, courseId },
    });

    const status = dto.progress === 100 ? 'COMPLETED' : 'STARTED';
    let assignment;

    if (existing) {
      assignment = await this.prisma.courseAssignment.update({
        where: { id: existing.id },
        data: {
          progress: dto.progress,
          status,
          completedAt: dto.progress === 100 ? new Date() : existing.completedAt,
        },
      });
    } else {
      assignment = await this.prisma.courseAssignment.create({
        data: {
          id: `asg-${randomUUID().slice(0, 8)}`,
          organizationId,
          employeeId,
          courseId,
          progress: dto.progress,
          status,
          completedAt: dto.progress === 100 ? new Date() : null,
        },
      });
    }

    // Re-evaluate matching obligations
    const obligations = await this.prisma.complianceObligation.findMany({
      where: { organizationId, targetId: employeeId },
    });
    for (const obl of obligations) {
      const req = await this.prisma.complianceRequirement.findUnique({ where: { id: obl.requirementId } });
      if (req && req.category === 'TRAINING' && req.code === courseId) {
        await this.recalculateStatus(obl.id, organizationId);
      }
    }

    return assignment;
  }

  async listMyCourses(organizationId: string, employeeId: string) {
    const assignments = await this.prisma.courseAssignment.findMany({
      where: { organizationId, employeeId },
    });

    const courses = await this.prisma.course.findMany({
      where: { organizationId },
    });

    const courseMap = new Map(courses.map(c => [c.id, c]));

    return assignments.map(a => {
      const course = courseMap.get(a.courseId);
      return {
        id: a.id,
        courseId: a.courseId,
        progress: a.progress,
        status: a.status,
        assignedAt: a.assignedAt,
        completedAt: a.completedAt,
        title: course?.title || 'Unknown Course',
        category: course?.category || 'General',
        durationMins: course?.durationMins || 0,
        description: course?.description || '',
      };
    });
  }
}
