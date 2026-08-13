export type PublicOnboardingTask = {
  id: string;
  title: string;
  description: string | null;
  category: 'HR' | 'IT' | 'MANAGER' | 'EMPLOYEE';
  status: 'PENDING' | 'COMPLETED';
  dueDate: string | null;
};

export type PublicOnboarding = {
  id: string;
  organizationId: string;
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  department: string;
  joiningDate: string;
  status: 'IN_PROGRESS' | 'COMPLETED';
  buddy: string | null;
  checklistProgress: number; // calculated percentage
  tasks: PublicOnboardingTask[];
};

export type PublicOnboardingData = {
  scope: 'company' | 'team' | 'me';
  records: PublicOnboarding[];
  summary: {
    total: number;
    pending: number;
    completed: number;
    avgProgress: number;
  };
};
