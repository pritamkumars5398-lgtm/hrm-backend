import type { Employee } from '@prisma/client';

/**
 * The employee directory as the frontend consumes it. Shape matches the client's
 * `Employee` type so the UI reads real records exactly as it read the mock ones.
 *
 * Note the boundary: this exposes the *identity* record created on invite
 * (§11.4) — name, role, contact. It does NOT expose attendance, payroll or
 * performance, which remain mock-only until Phase 2 (§11.6).
 */
export type PublicEmployee = {
  id: string;
  organizationId: string;
  name: string;
  avatarInitials: string;
  email: string;
  phone: string;
  department: string;
  designation: string;
  status: 'ACTIVE' | 'ON_LEAVE' | 'PROBATION' | 'NOTICE' | 'INACTIVE';
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACT';
  location: string;
  joinedAt: string;
  managerName: string | null;
  employmentHistory: Array<{ id: string; date: string; title: string; detail: string }>;
  documents: Array<{ id: string; name: string; category: string; uploadedAt: string; sizeKb: number }>;
  // Raw stored fields, so the edit form can populate real values (name is display-only).
  firstName: string;
  lastName: string;
  employeeId: string;
  homeAddress: string;
  managerId: string | null;
};

function initialsOf(first: string, last: string): string {
  const value = ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
  return value || '?';
}

/** The stored free-text type (e.g. "Full-time", "Intern") folded into the three the UI knows. */
function mapEmploymentType(raw: string): PublicEmployee['employmentType'] {
  const value = raw.toLowerCase();
  if (value.includes('part')) return 'PART_TIME';
  if (value.includes('contract') || value.includes('intern')) return 'CONTRACT';
  return 'FULL_TIME';
}

export function toPublicEmployee(
  employee: Employee,
  email: string,
  managerName: string | null = null,
): PublicEmployee {
  const name = `${employee.firstName} ${employee.lastName}`.trim();
  const joinedAt = employee.startDate.toISOString();

  return {
    id: employee.id,
    organizationId: employee.organizationId,
    name,
    avatarInitials: initialsOf(employee.firstName, employee.lastName),
    email,
    phone: employee.contactNumber ?? '',
    department: employee.department,
    designation: employee.jobTitle,
    // No lifecycle tracking yet — everyone added through the invite flow is active.
    status: 'ACTIVE',
    employmentType: mapEmploymentType(employee.employmentType),
    location: employee.workLocation,
    joinedAt,
    managerName,
    // One synthesised event so the profile drawer's timeline isn't blank.
    employmentHistory: [
      {
        id: `${employee.id}-joined`,
        date: joinedAt,
        title: 'Joined the company',
        detail: employee.jobTitle ? `Started as ${employee.jobTitle}.` : 'Joined the company.',
      },
    ],
    documents: [],
    firstName: employee.firstName,
    lastName: employee.lastName,
    employeeId: employee.employeeId ?? '',
    homeAddress: employee.homeAddress ?? '',
    managerId: employee.managerId ?? null,
  };
}
