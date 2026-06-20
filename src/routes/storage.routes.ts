import { Router } from "express";
import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import {
  completeMultipartUpload,
  createPresignedUpload,
  generatePresignedDownloadUrl,
  initMultipartUpload,
  listR2Objects,
  presignMultipartParts,
} from "../lib/r2";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.use(requireAuth);

function normalizeFolder(folderParam: string | undefined): string | null | undefined {
  if (folderParam === undefined) return undefined;
  const normalized = folderParam.trim().replace(/^\/+|\/+$/g, "");
  return normalized || null;
}

router.post("/r2/presign-upload", async (req: Request, res: Response) => {
  try {
    const { fileName, contentType } = req.body as {
      fileName?: string;
      contentType?: string;
    };

    if (!fileName || !contentType) {
      return res.status(400).json({
        error: "fileName and contentType are required",
      });
    }

    const result = await createPresignedUpload(fileName, contentType);
    return res.json(result);
  } catch (error) {
    console.error("Failed to create presigned upload URL:", error);
    return res.status(500).json({ error: "Failed to create presigned upload URL" });
  }
});

router.post("/r2/multipart/init", async (req: Request, res: Response) => {
  try {
    const { fileName, contentType } = req.body as {
      fileName?: string;
      contentType?: string;
    };

    if (!fileName || !contentType) {
      return res.status(400).json({
        error: "fileName and contentType are required",
      });
    }

    const result = await initMultipartUpload(fileName, contentType);
    return res.json(result);
  } catch (error) {
    console.error("Failed to initiate multipart upload:", error);
    return res.status(500).json({ error: "Failed to initiate multipart upload" });
  }
});

router.post("/r2/multipart/presign-parts", async (req: Request, res: Response) => {
  try {
    const { uploadId, objectKey, partNumbers } = req.body as {
      uploadId?: string;
      objectKey?: string;
      partNumbers?: number[];
    };

    if (!uploadId || !objectKey || !Array.isArray(partNumbers) || partNumbers.length === 0) {
      return res.status(400).json({
        error: "uploadId, objectKey, and a non-empty partNumbers array are required",
      });
    }

    const parts = await presignMultipartParts(uploadId, objectKey, partNumbers);
    return res.json({ parts });
  } catch (error) {
    console.error("Failed to presign multipart parts:", error);
    return res.status(500).json({ error: "Failed to presign multipart parts" });
  }
});

router.post("/r2/multipart/complete", async (req: Request, res: Response) => {
  try {
    const { uploadId, objectKey, parts } = req.body as {
      uploadId?: string;
      objectKey?: string;
      parts?: { ETag: string; PartNumber: number }[];
    };

    if (!uploadId || !objectKey || !Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({
        error: "uploadId, objectKey, and a non-empty parts array are required",
      });
    }

    const publicUrl = await completeMultipartUpload(uploadId, objectKey, parts);
    return res.json({ publicUrl, objectKey, uploadId });
  } catch (error) {
    console.error("Failed to complete multipart upload:", error);
    return res.status(500).json({ error: "Failed to complete multipart upload" });
  }
});

router.get("/r2/download", async (req: Request, res: Response) => {
  try {
    const objectKey = req.query.key as string | undefined;
    const fileName = req.query.fileName as string | undefined;

    if (!objectKey || !fileName) {
      return res.status(400).json({
        error: "key and fileName query parameters are required",
      });
    }

    const downloadUrl = await generatePresignedDownloadUrl(objectKey, fileName);
    return res.json({ downloadUrl, fileName, objectKey });
  } catch (error) {
    console.error("Failed to create presigned download URL:", error);
    return res.status(500).json({ error: "Failed to create download URL" });
  }
});

router.get("/r2/list", async (req: Request, res: Response) => {
  try {
    const prefix =
      typeof req.query.prefix === "string" && req.query.prefix.length > 0
        ? req.query.prefix
        : "uploads/";
    const folder = normalizeFolder(req.query.folder as string | undefined);

    let objects = await listR2Objects(prefix);

    if (folder !== undefined) {
      const prisma = req.app.locals.prisma as PrismaClient;
      const assets = await prisma.mediaAsset.findMany({
        where: { folder },
        select: { publicUrl: true },
      });
      const allowedUrls = new Set(assets.map((asset) => asset.publicUrl));
      objects = objects.filter((object) => allowedUrls.has(object.publicUrl));
    }

    return res.json({ objects });
  } catch (error) {
    console.error("Failed to list R2 objects:", error);
    return res.status(500).json({ error: "Failed to list R2 objects" });
  }
});

export default router;
