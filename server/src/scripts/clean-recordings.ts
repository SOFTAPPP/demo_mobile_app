import { config } from 'dotenv';
import path from 'path';
config({ path: path.resolve(__dirname, '../../.env') });

import { s3Client, s3Bucket } from '../services/s3.service';
import { ListMultipartUploadsCommand, AbortMultipartUploadCommand } from '@aws-sdk/client-s3';
import db from '../models/db';

async function clearR2AndDB() {
  console.log('Starting cleanup of R2 Multipart Uploads and DB...');
  
  try {
    // 1. List and Abort Multipart Uploads
    const listCommand = new ListMultipartUploadsCommand({ Bucket: s3Bucket });
    const { Uploads } = await s3Client.send(listCommand);
    
    if (Uploads && Uploads.length > 0) {
      console.log(`Found ${Uploads.length} dangling multipart uploads. Aborting...`);
      for (const upload of Uploads) {
        if (upload.Key && upload.UploadId) {
          console.log(`Aborting: ${upload.Key} (UploadId: ${upload.UploadId})`);
          await s3Client.send(new AbortMultipartUploadCommand({
            Bucket: s3Bucket,
            Key: upload.Key,
            UploadId: upload.UploadId
          }));
        }
      }
      console.log('Successfully aborted all multipart uploads.');
    } else {
      console.log('No active multipart uploads found in R2.');
    }

    // 2. Clear recordings table
    console.log('Truncating recordings table...');
    await db.execute('DELETE FROM recordings');
    console.log('Cleared recordings table successfully.');
    
    console.log('Cleanup complete!');
    process.exit(0);
  } catch (err) {
    console.error('Failed to clean up:', err);
    process.exit(1);
  }
}

clearR2AndDB();
