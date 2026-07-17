import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { quarterFor, type PublicPerformanceData, type PublicPerformanceRecord, type PublicReview } from './performance.entity';
import type { CreateGoalDto } from './dto/create-goal.dto';
import type { SubmitReviewDto } from './dto/submit-review.dto';

/** Mirrors PermissionsGuard's own matching (§ same pattern as Leave's canApprove). */
function canManage(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('performance.manage') || permissions.includes('performance.*');
}

@Injectable()
export class PerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** See Employees' own note: `deletedAt: null` does not match documents where
   *  the field was never written, so soft-deletes are filtered in code. */
  private async activeEmployees(organizationId: string) {
    const all = await this.prisma.employee.findMany({ where: { organizationId } });
    return all.filter((e) => !e.deletedAt);
  }

  private async myEmployee(userId: string, organizationId: string) {
    const employees = await this.activeEmployees(organizationId);
    return employees.find((e) => e.userId === userId) ?? null;
  }

  /**
   * Finds the org's current-quarter OPEN cycle, closing a stale one and
   * opening a fresh one if the quarter has rolled over. There is no
   * cycle-management UI — this is the only place cycles get created.
   */
  private async currentCycle(organizationId: string) {
    const { name, startDate, endDate } = quarterFor(new Date());

    const open = await this.prisma.appraisalCycle.findFirst({
      where: { organizationId, status: 'OPEN' },
    });

    if (open && open.name === name) return open;

    if (open) {
      await this.prisma.appraisalCycle.update({
        where: { id: open.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
    }

    // A cycle with this name may already exist (e.g. re-opened after a restart
    // race) — reuse it rather than violating no real uniqueness constraint.
    const existing = await this.prisma.appraisalCycle.findFirst({ where: { organizationId, name } });
    if (existing) {
      return this.prisma.appraisalCycle.update({ where: { id: existing.id }, data: { status: 'OPEN', closedAt: null } });
    }

    return this.prisma.appraisalCycle.create({
      data: { id: `cyc-${randomUUID().slice(0, 8)}`, organizationId, name, status: 'OPEN', startDate, endDate },
    });
  }

  async get(params: { userId: string; organizationId: string; permissions: string[] }): Promise<PublicPerformanceData> {
    const { userId, organizationId, permissions } = params;
    const manage = canManage(permissions);
    const cycle = await this.currentCycle(organizationId);

    const allEmployees = await this.activeEmployees(organizationId);
    const me = allEmployees.find((e) => e.userId === userId) ?? null;

    let scope: PublicPerformanceData['scope'];
    let visible: typeof allEmployees;

    if (manage) {
      scope = 'company';
      visible = allEmployees;
    } else {
      const reports = me ? allEmployees.filter((e) => e.managerId === me.id) : [];
      if (reports.length > 0) {
        scope = 'team';
        visible = reports;
      } else {
        scope = 'me';
        visible = me ? [me] : [];
      }
    }

    if (visible.length === 0) {
      return { scope, cycle: cycle.name, records: [], summary: { reviewed: 0, pending: 0, avgRating: 0, avgGoalProgress: 0 }, distribution: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: 0 })) };
    }

    const visibleIds = visible.map((e) => e.id);
    const [goals, allReviews, cycles] = await Promise.all([
      this.prisma.goal.findMany({ where: { organizationId, employeeId: { in: visibleIds }, cycleId: cycle.id } }),
      this.prisma.review.findMany({ where: { organizationId, employeeId: { in: visibleIds } } }),
      this.prisma.appraisalCycle.findMany({ where: { organizationId } }),
    ]);

    const cycleById = new Map(cycles.map((c) => [c.id, c]));
    const reviewerIds = [...new Set(allReviews.map((r) => r.reviewerUserId))];
    const reviewers = reviewerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: reviewerIds } }, select: { id: true, name: true } })
      : [];
    const reviewerNameById = new Map(reviewers.map((r) => [r.id, r.name]));

    const managerNameById = await this.managerNamesFor(visible, allEmployees);

    const records: PublicPerformanceRecord[] = visible.map((employee) => {
      const employeeGoals = goals
        .filter((g) => g.employeeId === employee.id)
        .map((g) => ({ id: g.id, title: g.title, progress: g.progress, dueOn: g.dueOn }));

      const employeeReviews = allReviews
        .filter((r) => r.employeeId === employee.id)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      const reviews: PublicReview[] = employeeReviews.map((r) => ({
        id: r.id,
        cycle: cycleById.get(r.cycleId)?.name ?? r.cycleId,
        rating: r.rating,
        reviewer: reviewerNameById.get(r.reviewerUserId) ?? 'Unknown',
        summary: r.summary,
        reviewedOn: r.createdAt.toISOString().slice(0, 10),
      }));

      const currentReview = employeeReviews.find((r) => r.cycleId === cycle.id) ?? null;
      const previousReview = employeeReviews.find((r) => r.cycleId !== cycle.id) ?? null;

      // Reviewing yourself is never allowed — mirrors Leave's own-request rule.
      const isSelf = me !== null && employee.id === me.id;
      const canReview = !isSelf && (manage || (me !== null && employee.managerId === me.id));

      return {
        id: `perf-${employee.id}`,
        organizationId,
        employeeId: employee.id,
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        avatarInitials: ((employee.firstName[0] ?? '') + (employee.lastName[0] ?? '')).toUpperCase() || '?',
        department: employee.department,
        designation: employee.jobTitle,
        managerName: managerNameById.get(employee.id) ?? null,
        rating: currentReview?.rating ?? null,
        previousRating: previousReview?.rating ?? null,
        goals: employeeGoals,
        reviews,
        canReview,
      };
    });

    const rated = records.filter((r) => r.rating !== null);
    const allGoalsFlat = records.flatMap((r) => r.goals);

    return {
      scope,
      cycle: cycle.name,
      records: [...records].sort((a, b) => a.employeeName.localeCompare(b.employeeName)),
      summary: {
        reviewed: rated.length,
        pending: records.length - rated.length,
        avgRating: rated.length === 0 ? 0 : Math.round((rated.reduce((s, r) => s + r.rating!, 0) / rated.length) * 10) / 10,
        avgGoalProgress:
          allGoalsFlat.length === 0 ? 0 : Math.round(allGoalsFlat.reduce((s, g) => s + g.progress, 0) / allGoalsFlat.length),
      },
      distribution: [1, 2, 3, 4, 5].map((rating) => ({ rating, count: rated.filter((r) => r.rating === rating).length })),
    };
  }

  async submitReview(
    userId: string,
    organizationId: string,
    permissions: string[],
    employeeId: string,
    dto: SubmitReviewDto,
  ): Promise<void> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || employee.organizationId !== organizationId || employee.deletedAt) {
      throw new NotFoundException('That person no longer exists.');
    }

    const me = await this.myEmployee(userId, organizationId);
    if (me && employee.id === me.id) {
      throw new ForbiddenException('You cannot review your own performance.');
    }

    const manage = canManage(permissions);
    if (!manage && (!me || employee.managerId !== me.id)) {
      throw new ForbiddenException('You do not have permission to review this person.');
    }

    const cycle = await this.currentCycle(organizationId);

    const existing = await this.prisma.review.findUnique({
      where: { employeeId_cycleId: { employeeId, cycleId: cycle.id } },
    });
    if (existing) {
      throw new ConflictException('This person has already been reviewed for this cycle.');
    }

    await this.prisma.review.create({
      data: {
        id: `rev-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId,
        cycleId: cycle.id,
        rating: dto.rating,
        summary: dto.summary.trim(),
        reviewerUserId: userId,
      },
    });
  }

  async addGoal(
    userId: string,
    organizationId: string,
    permissions: string[],
    employeeId: string,
    dto: CreateGoalDto,
  ): Promise<void> {
    const employee = await this.prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee || employee.organizationId !== organizationId || employee.deletedAt) {
      throw new NotFoundException('That person no longer exists.');
    }

    const me = await this.myEmployee(userId, organizationId);
    const manage = canManage(permissions);
    if (!manage && (!me || employee.managerId !== me.id)) {
      throw new ForbiddenException('You do not have permission to set goals for this person.');
    }

    const cycle = await this.currentCycle(organizationId);

    await this.prisma.goal.create({
      data: {
        id: `goal-${randomUUID().slice(0, 8)}`,
        organizationId,
        employeeId,
        cycleId: cycle.id,
        title: dto.title.trim(),
        dueOn: dto.dueOn,
        progress: 0,
      },
    });
  }

  async updateGoalProgress(
    userId: string,
    organizationId: string,
    permissions: string[],
    goalId: string,
    progress: number,
  ): Promise<void> {
    const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal || goal.organizationId !== organizationId) {
      throw new NotFoundException('That goal no longer exists.');
    }

    const employee = await this.prisma.employee.findUnique({ where: { id: goal.employeeId } });
    if (!employee) {
      throw new NotFoundException('The employee this goal belongs to no longer exists.');
    }

    const me = await this.myEmployee(userId, organizationId);
    const manage = canManage(permissions);
    // Unlike reviews, updating your own goal progress is fine — it's just a
    // self-tracked progress bar, not an appraisal rating.
    const isOwnGoal = me !== null && goal.employeeId === me.id;
    if (!manage && !isOwnGoal && (!me || employee.managerId !== me.id)) {
      throw new ForbiddenException('You do not have permission to update this goal.');
    }

    if (progress < 0 || progress > 100) {
      throw new BadRequestException('Progress must be between 0 and 100.');
    }

    // Reviews are naturally locked once a cycle closes (create-only, always
    // against the current open cycle) — goals need the same check explicitly,
    // since this is a standalone update-by-id with no cycle in the URL.
    const cycle = await this.prisma.appraisalCycle.findUnique({ where: { id: goal.cycleId } });
    if (cycle && cycle.status !== 'OPEN') {
      throw new BadRequestException('This appraisal cycle has closed — its goals can no longer be edited.');
    }

    await this.prisma.goal.update({ where: { id: goalId }, data: { progress } });
  }

  private async managerNamesFor(
    employees: Array<{ id: string; managerId: string | null }>,
    allEmployees: Array<{ id: string; firstName: string; lastName: string }>,
  ): Promise<Map<string, string>> {
    const byId = new Map(allEmployees.map((e) => [e.id, e]));
    const result = new Map<string, string>();
    for (const e of employees) {
      if (e.managerId && byId.has(e.managerId)) {
        const manager = byId.get(e.managerId)!;
        result.set(e.id, `${manager.firstName} ${manager.lastName}`.trim());
      }
    }
    return result;
  }
}
