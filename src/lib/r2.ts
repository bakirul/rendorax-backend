import { randomUUID } from "crypto";
import path from "path";
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGNED_URL_EXPIRY_SECONDS = 2 * 60 * 60;

function getR2Endpoint(): string {
  if (process.env.R2_ENDPOINT) {
    return process.env.R2_ENDPOINT;
  }

  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("R2_ACCOUNT_ID or R2_ENDPOINT must be configured");
  }

  return `https://${accountId}.r2.cloudflarestorage.com`;
}

export const r2BucketName = process.env.R2_BUCKET_NAME ?? "";

export const r2Client = new S3Client({
  region: "auto",
  endpoint: getR2Endpoint(),
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
  },
});

export function buildPublicUrl(objectKey: string): string {
  const publicBaseUrl =
    process.env.R2_PUBLIC_URL ?? process.env.R2_PUBLIC_DOMAIN;
  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, "")}/${objectKey}`;
  }

  throw new Error("Configure R2_PUBLIC_URL for public file URLs");
}

export function createR2ObjectKey(fileName: string): string {
  const sanitizedName = path
    .basename(fileName)
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return `uploads/${randomUUID()}-${sanitizedName}`;
}

export interface PresignedUploadResult {
  uploadUrl: string;
  publicUrl: string;
  objectKey: string;
}

export async function createPresignedUpload(
  fileName: string,
  contentType: string,
): Promise<PresignedUploadResult> {
  if (!r2BucketName) {
    throw new Error("R2_BUCKET_NAME is not configured");
  }

  const objectKey = createR2ObjectKey(fileName);
  const uploadUrl = await generatePresignedUploadUrl(objectKey, contentType);
  const publicUrl = buildPublicUrl(objectKey);

  return { uploadUrl, publicUrl, objectKey };
}

export async function generatePresignedUploadUrl(
  objectKey: string,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: r2BucketName,
    Key: objectKey,
    ContentType: contentType,
  });

  return getSignedUrl(r2Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  });
}

function buildContentDisposition(fileName: string): string {
  const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_") || "download";
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encoded}`;
}

export async function generatePresignedDownloadUrl(
  objectKey: string,
  fileName: string,
): Promise<string> {
  if (!r2BucketName) {
    throw new Error("R2_BUCKET_NAME is not configured");
  }

  const command = new GetObjectCommand({
    Bucket: r2BucketName,
    Key: objectKey,
    ResponseContentDisposition: buildContentDisposition(fileName),
  });

  return getSignedUrl(r2Client, command, {
    expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
  });
}

export interface R2ListedObject {
  key: string;
  fileName: string;
  publicUrl: string;
  mimeType: string;
  fileSize: number | null;
  lastModified: string;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function inferMimeType(objectKey: string): string {
  const ext = objectKey.slice(objectKey.lastIndexOf(".")).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
}

function displayFileName(objectKey: string): string {
  const base = objectKey.split("/").pop() ?? objectKey;
  return base.replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    "",
  );
}

export async function listR2Objects(prefix = "uploads/"): Promise<R2ListedObject[]> {
  if (!r2BucketName) {
    throw new Error("R2_BUCKET_NAME is not configured");
  }

  const objects: R2ListedObject[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await r2Client.send(
      new ListObjectsV2Command({
        Bucket: r2BucketName,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const item of response.Contents ?? []) {
      if (!item.Key || item.Key.endsWith("/")) continue;

      objects.push({
        key: item.Key,
        fileName: displayFileName(item.Key),
        publicUrl: buildPublicUrl(item.Key),
        mimeType: inferMimeType(item.Key),
        fileSize: item.Size ?? null,
        lastModified: item.LastModified?.toISOString() ?? new Date().toISOString(),
      });
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  objects.sort(
    (a, b) =>
      new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );

  return objects;
}

export interface MultipartInitResult {
  uploadId: string;
  objectKey: string;
  publicUrl: string;
}

export async function initMultipartUpload(
  fileName: string,
  contentType: string,
): Promise<MultipartInitResult> {
  if (!r2BucketName) {
    throw new Error("R2_BUCKET_NAME is not configured");
  }

  const objectKey = createR2ObjectKey(fileName);
  const response = await r2Client.send(
    new CreateMultipartUploadCommand({
      Bucket: r2BucketName,
      Key: objectKey,
      ContentType: contentType,
    }),
  );

  if (!response.UploadId) {
    throw new Error("R2 did not return an uploadId");
  }

  return {
    uploadId: response.UploadId,
    objectKey,
    publicUrl: buildPublicUrl(objectKey),
  };
}

export interface PresignedUploadPart {
  partNumber: number;
  uploadUrl: string;
}

export async function presignMultipartParts(
  uploadId: string,
  objectKey: string,
  partNumbers: number[],
): Promise<PresignedUploadPart[]> {
  if (!r2BucketName) {
    throw new Error("R2_BUCKET_NAME is not configured");
  }

  return Promise.all(
    partNumbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: r2BucketName,
        Key: objectKey,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      const uploadUrl = await getSignedUrl(r2Client, command, {
        expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
      });

      return { partNumber, uploadUrl };
    }),
  );
}

export interface CompletedUploadPart {
  ETag: string;
  PartNumber: number;
}

export async function completeMultipartUpload(
  uploadId: string,
  objectKey: string,
  parts: CompletedUploadPart[],
): Promise<string> {
  if (!r2BucketName) {
    throw new Error("R2_BUCKET_NAME is not configured");
  }

  await r2Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: r2BucketName,
      Key: objectKey,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts
          .slice()
          .sort((a, b) => a.PartNumber - b.PartNumber)
          .map((part) => ({
            ETag: part.ETag,
            PartNumber: part.PartNumber,
          })),
      },
    }),
  );

  return buildPublicUrl(objectKey);
}
