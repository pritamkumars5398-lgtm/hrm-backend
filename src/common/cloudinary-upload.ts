import { InternalServerErrorException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

const FOLDER = 'keystone-hrm/employee-photos';

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
