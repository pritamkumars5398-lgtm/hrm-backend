import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { deleteCompanyDocument, uploadCompanyDocument } from '../common/cloudinary-upload';
import { DOCUMENT_CATEGORIES, toPublicDocument, type DocumentCategory, type PublicDocument } from './document.entity';
import type { UploadDocumentDto } from './dto/upload-document.dto';

/**
 * The multipart Content-Type header is entirely client-supplied — a spoofed
 * value would otherwise sail past the controller's fileFilter, and Cloudinary
 * itself does zero content validation for `resource_type: raw` (confirmed:
 * garbage bytes labelled DOCX upload and serve without complaint). Checking
 * the real binary signature is the only thing standing between "documents
 * upload" and "arbitrary file host" for anyone holding documents.manage.
 */
function matchesSignature(buffer: Buffer, fileType: 'PDF' | 'DOCX' | 'XLSX'): boolean {
  if (fileType === 'PDF') {
    return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  }
  // DOCX and XLSX are both OOXML — zip containers, same magic bytes (PK\x03\x04).
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

export type DocumentsQuery = {
  search?: string;
  category?: DocumentCategory | 'ALL';
};

export type DocumentsData = {
  documents: PublicDocument[];
  counts: Record<string, number>;
};

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Same `deletedAt: null` caveat as Employees — filtered in code, not the query. */
  private async activeDocuments(organizationId: string) {
    const all = await this.prisma.document.findMany({ where: { organizationId } });
    return all.filter((d) => !d.deletedAt);
  }

  async get(organizationId: string, query: DocumentsQuery = {}): Promise<DocumentsData> {
    const { search = '', category = 'ALL' } = query;
    const term = search.trim().toLowerCase();

    const all = await this.activeDocuments(organizationId);
    const uploaderIds = [...new Set(all.map((d) => d.uploadedByUserId))];
    const uploaders = uploaderIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true } })
      : [];
    const nameByUploaderId = new Map(uploaders.map((u) => [u.id, u.name]));

    const filtered = all
      .filter((doc) => {
        const matchesTerm =
          !term || doc.name.toLowerCase().includes(term) || doc.description.toLowerCase().includes(term);
        const matchesCategory = category === 'ALL' || doc.category === category;
        return matchesTerm && matchesCategory;
      })
      .sort((a, b) => (b.updatedAt ?? b.createdAt).getTime() - (a.updatedAt ?? a.createdAt).getTime());

    const counts: Record<string, number> = { ALL: all.length };
    for (const c of DOCUMENT_CATEGORIES) {
      counts[c] = all.filter((d) => d.category === c).length;
    }

    return {
      documents: filtered.map((d) => toPublicDocument(d, nameByUploaderId.get(d.uploadedByUserId) ?? 'Unknown')),
      counts,
    };
  }

  async upload(
    configService: ConfigService,
    organizationId: string,
    uploadedByUserId: string,
    file: Express.Multer.File,
    dto: UploadDocumentDto,
  ): Promise<PublicDocument> {
    const fileType = this.resolveFileType(file.mimetype);
    if (!matchesSignature(file.buffer, fileType)) {
      throw new BadRequestException('That file does not look like a real PDF, DOCX or XLSX — its content does not match its declared type.');
    }
    const uploaded = await uploadCompanyDocument(configService, file.buffer, fileType);

    const created = await this.prisma.document.create({
      data: {
        id: `doc-${randomUUID().slice(0, 8)}`,
        organizationId,
        name: dto.name.trim(),
        description: dto.description.trim(),
        category: dto.category,
        fileType,
        sizeKb: Math.round(file.size / 1024),
        cloudinaryPublicId: uploaded.publicId,
        cloudinaryResourceType: uploaded.resourceType,
        cloudinaryUrl: uploaded.secureUrl,
        uploadedByUserId,
      },
    });

    const uploader = await this.prisma.user.findUnique({ where: { id: uploadedByUserId }, select: { name: true } });
    return toPublicDocument(created, uploader?.name ?? 'Unknown');
  }

  async remove(configService: ConfigService, id: string, organizationId: string): Promise<void> {
    const existing = await this.prisma.document.findUnique({ where: { id } });
    if (!existing || existing.organizationId !== organizationId || existing.deletedAt) {
      throw new NotFoundException('That document no longer exists.');
    }

    await deleteCompanyDocument(configService, existing.cloudinaryPublicId, existing.cloudinaryResourceType as 'image' | 'raw');
    await this.prisma.document.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  private resolveFileType(mimetype: string): 'PDF' | 'DOCX' | 'XLSX' {
    if (mimetype === 'application/pdf') return 'PDF';
    if (mimetype.includes('wordprocessingml') || mimetype === 'application/msword') return 'DOCX';
    if (mimetype.includes('spreadsheetml') || mimetype === 'application/vnd.ms-excel') return 'XLSX';
    // Fallback for octet-stream uploads from browsers that don't set a
    // specific mimetype — still a real limitation, not a mock: unrecognised
    // types are rejected in the controller's fileFilter before reaching here.
    return 'PDF';
  }
}
