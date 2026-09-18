import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { loadConfig } from "@copyr/config";

/**
 * S3-compatible object storage. Points at MinIO locally, S3 in prod —
 * identical API, config-driven.
 */
export class ObjectStore {
  private client: S3Client;
  private bucket: string;

  constructor(opts?: { endpoint?: string; bucket?: string }) {
    const cfg = loadConfig();
    this.bucket = opts?.bucket ?? cfg.STORAGE_BUCKET;
    this.client = new S3Client({
      region: cfg.STORAGE_REGION,
      endpoint: opts?.endpoint ?? cfg.STORAGE_ENDPOINT,
      forcePathStyle: cfg.STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: cfg.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: cfg.STORAGE_SECRET_ACCESS_KEY,
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client
        .send(new CreateBucketCommand({ Bucket: this.bucket }))
        .catch(() => undefined);
    }
  }

  async put(key: string, body: Buffer | Uint8Array, contentType = "application/octet-stream"): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object not found: ${key}`);
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signedUrl(key: string, expiresInSeconds = 600): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}

let defaultStore: ObjectStore | undefined;
export function getObjectStore(): ObjectStore {
  if (!defaultStore) defaultStore = new ObjectStore();
  return defaultStore;
}
