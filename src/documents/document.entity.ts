import type { Document as DocumentModel } from '@prisma/client';

export type DocumentCategory = 'Policies' | 'Templates' | 'Contracts' | 'Compliance' | 'Onboarding';
export const DOCUMENT_CATEGORIES: DocumentCategory[] = [
  'Policies',
  'Templates',
  'Contracts',
  'Compliance',
  'Onboarding',
];

export type PublicDocument = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  category: DocumentCategory;
  fileType: 'PDF' | 'DOCX' | 'XLSX';
  sizeKb: number;
  updatedAt: string;
  updatedBy: string;
  cloudinaryUrl: string;
};

export function toPublicDocument(doc: DocumentModel, uploadedByName: string): PublicDocument {
  return {
    id: doc.id,
    organizationId: doc.organizationId,
    name: doc.name,
    description: doc.description,
    category: doc.category as DocumentCategory,
    fileType: doc.fileType as PublicDocument['fileType'],
    sizeKb: doc.sizeKb,
    updatedAt: (doc.updatedAt ?? doc.createdAt).toISOString().slice(0, 10),
    updatedBy: uploadedByName,
    cloudinaryUrl: doc.cloudinaryUrl,
  };
}
