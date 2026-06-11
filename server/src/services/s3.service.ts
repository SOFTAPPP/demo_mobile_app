import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '../lib/logger';

const s3Endpoint = process.env.S3_ENDPOINT || '';
const s3AccessKey = process.env.S3_ACCESS_KEY || '';
const s3SecretKey = process.env.S3_SECRET_KEY || '';
export const s3Bucket = process.env.S3_BUCKET || 'sangeet-arghya-recordings';
export const s3PublicUrl = process.env.S3_PUBLIC_URL || '';

export const s3Client = new S3Client({
  region: 'auto',
  endpoint: s3Endpoint,
  credentials: {
    accessKeyId: s3AccessKey,
    secretAccessKey: s3SecretKey,
  },
});

export const s3Service = {
  async startMultipartUpload(key: string, mimeType: string): Promise<string> {
    logger.debug(`Starting multipart upload for key: ${key}`);
    const command = new CreateMultipartUploadCommand({
      Bucket: s3Bucket,
      Key: key,
      ContentType: mimeType,
    });
    
    const response = await s3Client.send(command);
    if (!response.UploadId) throw new Error('Failed to start multipart upload');
    return response.UploadId;
  },

  async getPresignedUploadPartUrl(key: string, uploadId: string, partNumber: number): Promise<string> {
    logger.debug(`Generating presigned URL for part ${partNumber} of ${key}`);
    const command = new UploadPartCommand({
      Bucket: s3Bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    
    // URL expires in 15 minutes
    return getSignedUrl(s3Client, command, { expiresIn: 900 });
  },

  async completeMultipartUpload(key: string, uploadId: string, parts: { ETag: string; PartNumber: number }[]): Promise<void> {
    logger.info(`Completing multipart upload for ${key} with ${parts.length} parts`);
    const command = new CompleteMultipartUploadCommand({
      Bucket: s3Bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    });
    
    await s3Client.send(command);
  },

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    logger.warn(`Aborting multipart upload for ${key}`);
    const command = new AbortMultipartUploadCommand({
      Bucket: s3Bucket,
      Key: key,
      UploadId: uploadId,
    });
    
    await s3Client.send(command);
  },

  async getPresignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: s3Bucket,
      Key: key,
    });
    return getSignedUrl(s3Client, command, { expiresIn });
  },
};
