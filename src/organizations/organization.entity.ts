export interface Organization {
  id: string;
  name: string;
  address: string;
  industry: string;
  /** The user who created it — its Owner (§11.2). */
  ownerId: string;
  createdAt: string;
}

export const INDUSTRIES = [
  'Software & Technology',
  'Financial Services',
  'Healthcare',
  'Manufacturing',
  'Retail & E-commerce',
  'Professional Services',
  'Education',
  'Hospitality',
  'Construction',
  'Logistics & Transport',
  'Non-profit',
  'Other',
] as const;
