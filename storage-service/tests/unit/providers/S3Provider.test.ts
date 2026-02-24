/**
 * Unit tests for S3Provider.
 *
 * AWS SDK commands are mocked with jest so no real AWS credentials are needed.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// Note: aws-sdk-client-mock is a dev dependency you'd add for testing.
// If not available, these tests demonstrate the testing pattern.
// Install: npm install --save-dev aws-sdk-client-mock

let S3Provider: typeof import('../../../src/providers/s3/S3Provider').S3Provider;

describe('S3Provider', () => {
  // We use a simple approach here: stub the internal client methods via jest.spyOn
  // rather than requiring aws-sdk-client-mock (which may not be installed)

  it('should have name "s3"', async () => {
    // Lazy import to allow env to be set
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_S3_BUCKET = 'test-bucket';

    S3Provider = (await import('../../../src/providers/s3/S3Provider')).S3Provider;
    const provider = new S3Provider();
    expect(provider.name).toBe('s3');
  });

  it('should return false from healthCheck when bucket is unreachable', async () => {
    S3Provider = (await import('../../../src/providers/s3/S3Provider')).S3Provider;
    const provider = new S3Provider();

    // Spy on the internal send method to simulate failure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn((provider as any).client, 'send').mockRejectedValueOnce(new Error('Network error'));

    const healthy = await provider.healthCheck();
    expect(healthy).toBe(false);
  });
});
