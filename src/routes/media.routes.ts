import { Router } from "express";
import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { transcribeMediaToSrt } from "../lib/transcription";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.use(requireAuth);

router.post("/assets", async (req: Request, res: Response) => {
  const prisma = req.app.locals.prisma as PrismaClient;

  try {
    const { fileName, publicUrl, mimeType, userId, folder, fileSize, objectKey } =
      req.body as {
        fileName?: string;
        publicUrl?: string;
        mimeType?: string;
        userId?: string;
        folder?: string | null;
        fileSize?: number;
        objectKey?: string;
      };

    if (!fileName || !publicUrl || !mimeType) {
      return res.status(400).json({
        error: "fileName, publicUrl, and mimeType are required",
      });
    }

    const normalizedFolder =
      folder === null || folder === undefined
        ? null
        : typeof folder === "string"
          ? folder.trim().replace(/^\/+|\/+$/g, "") || null
          : null;

    const MAX_INT32 = 2_147_483_647;
    const normalizedFileSize =
      typeof fileSize === "number" && Number.isFinite(fileSize)
        ? Math.min(Math.round(fileSize), MAX_INT32)
        : null;

    const asset = await prisma.mediaAsset.create({
      data: {
        fileName,
        publicUrl,
        objectKey: objectKey?.trim() || null,
        mimeType,
        userId: userId ?? null,
        folder: normalizedFolder,
        fileSize: normalizedFileSize,
      },
    });

    return res.status(201).json(asset);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save media asset";
    console.error("Failed to save media asset:", error);
    return res.status(500).json({
      error: "Failed to save media asset",
      details: process.env.NODE_ENV === "production" ? undefined : message,
    });
  }
});

router.get("/assets", async (req: Request, res: Response) => {
  const prisma = req.app.locals.prisma as PrismaClient;

  try {
    const userId = req.query.userId as string | undefined;
    const folderParam = req.query.folder as string | undefined;
    const normalizedFolder =
      folderParam !== undefined
        ? folderParam.trim().replace(/^\/+|\/+$/g, "") || null
        : undefined;

    const assets = await prisma.mediaAsset.findMany({
      where: {
        ...(userId ? { userId } : {}),
        ...(normalizedFolder !== undefined ? { folder: normalizedFolder } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(assets);
  } catch (error) {
    console.error("Failed to fetch media assets:", error);
    return res.status(500).json({ error: "Failed to fetch media assets" });
  }
});

router.post("/transcribe", async (req: Request, res: Response) => {
  try {
    const { assetId, fileUrl, language } = req.body as {
      assetId?: string;
      fileUrl?: string;
      language?: string;
    };

    if (!assetId || !fileUrl) {
      return res.status(400).json({
        error: "assetId and fileUrl are required",
      });
    }

    const targetLanguage = language?.trim() || "en";

    const { srt } = await transcribeMediaToSrt({
      fileUrl,
      language: targetLanguage,
    });

    return res.json({
      success: true,
      assetId,
      language: targetLanguage,
      srt,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to transcribe media asset";

    console.error("[API/MEDIA/TRANSCRIBE] Failed:", {
      reason: message,
      error,
    });

    return res.status(500).json({ error: message });
  }
});

export default router;
