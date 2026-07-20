import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { memoryStorage } from 'multer';
import { DocumentsService, type DocumentsData } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import type { DocumentCategory, PublicDocument } from './document.entity';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/permissions.guard';
import { CurrentMembership } from '../common/current-membership.decorator';
import type { Membership } from '../users/user.entity';

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMETYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/**
 * Company-wide document library — everyone with `documents.view` sees the
 * same set (no per-employee scoping today, see the frontend's own note in
 * DocumentsPage). `documents.manage` gates upload and delete.
 */
@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @RequirePermission('documents.view')
  get(
    @CurrentMembership() membership: Membership,
    @Query('search') search?: string,
    @Query('category') category?: DocumentCategory | 'ALL',
  ): Promise<DocumentsData> {
    return this.documentsService.get(membership.organizationId, { search, category });
  }

  @Post()
  @RequirePermission('documents.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DOCUMENT_BYTES },
      fileFilter: (_req, file, cb) => {
        cb(null, ALLOWED_MIMETYPES.has(file.mimetype));
      },
    }),
  )
  async upload(
    @CurrentMembership() membership: Membership,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
  ): Promise<PublicDocument> {
    if (!file) {
      throw new BadRequestException('Choose a PDF, DOCX or XLSX file under 10MB.');
    }

    return this.documentsService.upload(this.configService, membership.organizationId, membership.userId, file, dto);
  }

  @Delete(':id')
  @RequirePermission('documents.manage')
  @HttpCode(200)
  async remove(
    @CurrentMembership() membership: Membership,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.documentsService.remove(this.configService, id, membership.organizationId);
    return { ok: true };
  }
}
