import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

const logger = new Logger('CloudinaryUpload');
const FOLDER = 'keystone-hrm/employee-photos';
const DOCUMENTS_FOLDER = 'keystone-hrm/documents';

function configureCloudinary(configService: ConfigService): void {
  const cloud_name = configService.get<string>('CLOUDINARY_CLOUD_NAME');
  const api_key = configService.get<string>('CLOUDINARY_API_KEY');
  const api_secret = configService.get<string>('CLOUDINARY_API_SECRET');

  if (!cloud_name || !api_key || !api_secret) {
    throw new InternalServerErrorException('File upload is not configured on the server.');
  }

  cloudinary.config({ cloud_name, api_key, api_secret });
}

/**
 * Uploads a buffer to Cloudinary from the server. The browser only ever talks
 * to this backend — never to Cloudinary directly — so every upload passes the
 * JWT guard, permission check, and the multer size/type limits in front of it
 * (decision recorded in .env.example, not the "signed direct upload" pattern).
 */
export function uploadEmployeePhoto(configService: ConfigService, buffer: Buffer): Promise<string> {
  const cloud_name = configService.get<string>('CLOUDINARY_CLOUD_NAME');
  const api_key = configService.get<string>('CLOUDINARY_API_KEY');
  const api_secret = configService.get<string>('CLOUDINARY_API_SECRET');

  if (!cloud_name || !api_key || !api_secret) {
    throw new InternalServerErrorException('Photo upload is not configured on the server.');
  }

  cloudinary.config({ cloud_name, api_key, api_secret });

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: FOLDER, resource_type: 'image' },
      (error, result) => {
        if (error || !result) {
          reject(new InternalServerErrorException(error?.message ?? 'Photo upload failed.'));
          return;
        }
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

export type UploadedDocument = {
  publicId: string;
  secureUrl: string;
  /** Needed again at delete time — Cloudinary requires the matching resource_type. */
  resourceType: 'image' | 'raw';
};

/**
 * Uploads a company document (PDF/DOCX/XLSX) to Cloudinary. PDFs upload as
 * `image` (Cloudinary's PDF-as-image convention, needed for inline preview);
 * everything else uploads as `raw`, since Cloudinary can't interpret arbitrary
 * office formats. Same server-proxy rule as employee photos — never a direct
 * browser→Cloudinary upload.
 */
export function uploadCompanyDocument(
  configService: ConfigService,
  buffer: Buffer,
  fileType: 'PDF' | 'DOCX' | 'XLSX',
): Promise<UploadedDocument> {
  configureCloudinary(configService);
  const resourceType: 'image' | 'raw' = 'raw';

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { 
        folder: DOCUMENTS_FOLDER, 
        resource_type: resourceType
      },
      (error, result) => {
        if (error || !result) {
          reject(new InternalServerErrorException(error?.message ?? 'Document upload failed.'));
          return;
        }
        resolve({ publicId: result.public_id, secureUrl: result.secure_url, resourceType });
      },
    );
    stream.end(buffer);
  });
}

/** Deletes the Cloudinary asset behind a document — called on delete, and
 *  before overwriting on replace, so nothing orphans (§6). A missing asset
 *  (already gone) is not an error — the DB row is what we're actually cleaning up. */
export async function deleteCompanyDocument(
  configService: ConfigService,
  publicId: string,
  resourceType: 'image' | 'raw',
): Promise<void> {
  configureCloudinary(configService);
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    // Best-effort cleanup — a delete that fails here must not block removing
    // the DB row, or the document would be un-deletable from the UI. It must
    // NOT be silent, though: an unlogged failure here is exactly how an asset
    // orphans forever at its still-public secure_url with no operator ever
    // finding out (§6 "no orphaned Cloudinary assets" only holds if failures
    // are at least visible).
    logger.error(
      `Failed to delete Cloudinary asset ${publicId} (${resourceType}) — it is now orphaned and must be cleaned up manually.`,
      error instanceof Error ? error.message : String(error),
    );
  }
}
