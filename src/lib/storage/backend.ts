/**
 * Backend de archivos portable — reemplaza Supabase Storage.
 *
 * Drivers:
 *   STORAGE_DRIVER=local (default) → disco en STORAGE_LOCAL_PATH
 *   STORAGE_DRIVER=s3              → S3/MinIO/R2 (S3_* en el env)
 *
 * Las URLs públicas son siempre /api/storage/<bucket>/<path> — la ruta
 * GET las sirve desde el driver activo, así el navegador no necesita
 * conocer el backend.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const BUCKETS = {
  avatars: { maxBytes: 5 * 1024 * 1024 },
  'flow-media': { maxBytes: 16 * 1024 * 1024 },
  'chat-media': { maxBytes: 16 * 1024 * 1024 },
} as const;

export type BucketName = keyof typeof BUCKETS;

export function isBucket(name: string): name is BucketName {
  return name in BUCKETS;
}

/** Rechaza traversal y caracteres raros; conserva subcarpetas simples. */
export function isSafeObjectPath(objectPath: string): boolean {
  return (
    objectPath.length > 0 &&
    objectPath.length < 512 &&
    /^[a-zA-Z0-9_\-./]+$/.test(objectPath) &&
    !objectPath.includes('..') &&
    !objectPath.startsWith('/') &&
    !objectPath.endsWith('/')
  );
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  amr: 'audio/amr',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
  webm: 'video/webm',
};

export function contentTypeFor(objectPath: string): string {
  const ext = objectPath.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

interface StorageDriver {
  put(
    bucket: string,
    objectPath: string,
    body: Buffer,
    contentType: string
  ): Promise<void>;
  get(bucket: string, objectPath: string): Promise<Buffer | null>;
  delete(bucket: string, objectPath: string): Promise<void>;
}

// ------------------------------------------------------------------

function localRoot(): string {
  return (
    process.env.STORAGE_LOCAL_PATH ??
    // turbopackIgnore: sin esto el trazado NFT de la build standalone
    // interpreta el cwd dinámico como "todo el proyecto es dependencia".
    path.join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'storage')
  );
}

const localDriver: StorageDriver = {
  async put(bucket, objectPath, body) {
    const filePath = path.join(localRoot(), bucket, objectPath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  },
  async get(bucket, objectPath) {
    try {
      return await readFile(path.join(localRoot(), bucket, objectPath));
    } catch {
      return null;
    }
  },
  async delete(bucket, objectPath) {
    await rm(path.join(localRoot(), bucket, objectPath), { force: true });
  },
};

// ------------------------------------------------------------------

type S3Module = typeof import('@aws-sdk/client-s3');

let s3Client: import('@aws-sdk/client-s3').S3Client | null = null;
let s3Module: S3Module | null = null;

async function getS3(): Promise<{
  client: import('@aws-sdk/client-s3').S3Client;
  mod: S3Module;
}> {
  if (!s3Client || !s3Module) {
    s3Module = await import('@aws-sdk/client-s3');
    s3Client = new s3Module.S3Client({
      region: process.env.S3_REGION ?? 'us-east-1',
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
      credentials: process.env.S3_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
          }
        : undefined,
    });
  }
  return { client: s3Client, mod: s3Module };
}

function s3Bucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET no está definido');
  return bucket;
}

const s3Driver: StorageDriver = {
  async put(bucket, objectPath, body, contentType) {
    const { client, mod } = await getS3();
    await client.send(
      new mod.PutObjectCommand({
        Bucket: s3Bucket(),
        Key: `${bucket}/${objectPath}`,
        Body: body,
        ContentType: contentType,
      })
    );
  },
  async get(bucket, objectPath) {
    const { client, mod } = await getS3();
    try {
      const result = await client.send(
        new mod.GetObjectCommand({
          Bucket: s3Bucket(),
          Key: `${bucket}/${objectPath}`,
        })
      );
      const bytes = await result.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      return null;
    }
  },
  async delete(bucket, objectPath) {
    const { client, mod } = await getS3();
    await client.send(
      new mod.DeleteObjectCommand({
        Bucket: s3Bucket(),
        Key: `${bucket}/${objectPath}`,
      })
    );
  },
};

// ------------------------------------------------------------------

export function getStorage(): StorageDriver {
  return process.env.STORAGE_DRIVER === 's3' ? s3Driver : localDriver;
}

/** ETag débil para respuestas GET cacheables. */
export function etagFor(body: Buffer): string {
  return `"${createHash('sha1').update(body).digest('hex')}"`;
}
