import { EgressClient, EncodedFileOutput, S3Upload, EncodedFileType } from 'livekit-server-sdk';

const test = new EncodedFileOutput({
  filepath: 'test.mp4',
  fileType: EncodedFileType.MP4,
  output: {
    case: 's3',
    value: new S3Upload({
      accessKey: 'test',
      secret: 'test',
      bucket: 'test',
      endpoint: 'test',
      region: 'auto',
    })
  }
});
console.log('Types work');
