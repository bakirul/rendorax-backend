import { Router } from "express";
import type { Response } from "express";
import { PrismaClient } from "@prisma/client";
import { transcribeMediaToSrt } from "../lib/transcription";
import { isAllowedR2ObjectKey, isAllowedTranscribeFileUrl } from "../lib/storagePolicy";
import {
  buildThumbnailObjectKey,
  buildPublicUrl,
  deleteR2Object,
} from "../lib/r2";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/requireAuth";

const router = Router();

router.use(requireAuth);

function isAdminUser(req: AuthenticatedRequest): boolean {
  return req.user?.role === "admin";
}

function normalizeFolderValue(
  folder: unknown,
): string | null | undefined {
  if (folder === undefined) return undefined;
  if (folder === null) return null;
  if (typeof folder !== "string") return undefined;
  return folder.trim().replace(/^\/+|\/+$/g, "") || null;
}

function normalizeFileNameValue(fileName: unknown): string | null {
  if (typeof fileName !== "string") return null;
  const trimmed = fileName.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }
  return trimmed;
}

async function findAccessibleAsset(
  prisma: PrismaClient,
  assetId: string,
  req: AuthenticatedRequest,
) {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) {
    return { error: "Media asset not found", status: 404 as const, asset: null };
  }

  const authenticatedUserId = req.user?.id;
  if (!authenticatedUserId) {
    return { error: "Unauthorized", status: 401 as const, asset: null };
  }

  if (!isAdminUser(req) && asset.userId !== authenticatedUserId) {
    return { error: "Forbidden", status: 403 as const, asset: null };
  }

  return { error: null, status: 200 as const, asset };
}

type MediaAssetRow = {
  publicUrl: string;
  objectKey?: string | null;
  thumbnailUrl?: string | null;
  mimeType: string;
};

function serializeMediaAsset<T extends MediaAssetRow>(asset: T): T {
  const objectKey = asset.objectKey?.trim();
  if (!objectKey) {
    return asset;
  }

  const publicUrl = buildPublicUrl(objectKey);
  let thumbnailUrl = asset.thumbnailUrl;

  if (asset.mimeType.startsWith("video/")) {
    thumbnailUrl =
      thumbnailUrl?.trim() ||
      buildPublicUrl(buildThumbnailObjectKey(objectKey));
  }

  return {
    ...asset,
    publicUrl,
    thumbnailUrl,
  };
}

async function bestEffortDeleteR2Asset(asset: {
  objectKey?: string | null;
  mimeType: string;
  id?: string;
}): Promise<void> {
  const objectKey = asset.objectKey?.trim();
  if (!objectKey || !isAllowedR2ObjectKey(objectKey)) {
    return;
  }

  await deleteR2Object(objectKey).catch((error) => {
    console.warn("[media] R2 object delete failed (continuing with DB delete):", {
      assetId: asset.id,
      objectKey,
      error,
    });
  });

  if (!asset.mimeType.startsWith("video/")) {
    return;
  }

  const thumbnailKey = buildThumbnailObjectKey(objectKey);
  if (!isAllowedR2ObjectKey(thumbnailKey)) {
    return;
  }

  await deleteR2Object(thumbnailKey).catch((error) => {
    console.warn("[media] R2 thumbnail delete failed (continuing):", {
      assetId: asset.id,
      thumbnailKey,
      error,
    });
  });
}

router.post("/assets", async (req: AuthenticatedRequest, res: Response) => {
  const prisma = req.app.locals.prisma as PrismaClient;

  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { fileName, thumbnailUrl, mimeType, folder, fileSize, objectKey } =
      req.body as {
        fileName?: string;
        publicUrl?: string;
        thumbnailUrl?: string | null;
        mimeType?: string;
        folder?: string | null;
        fileSize?: number;
        objectKey?: string;
      };

    if (!fileName || !mimeType) {
      return res.status(400).json({
        error: "fileName and mimeType are required",
      });
    }

    const normalizedObjectKey = objectKey?.trim().replace(/^\/+/, "") || null;
    if (!normalizedObjectKey || !isAllowedR2ObjectKey(normalizedObjectKey)) {
      return res.status(400).json({
        error:
          "objectKey is required and must start with uploads/, thumbnails/, or projects/",
      });
    }

    const resolvedPublicUrl = buildPublicUrl(normalizedObjectKey);

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
        publicUrl: resolvedPublicUrl,
        thumbnailUrl: thumbnailUrl?.trim() || null,
        objectKey: normalizedObjectKey,
        mimeType,
        userId: authenticatedUserId,
        folder: normalizedFolder,
        fileSize: normalizedFileSize,
      },
    });

    return res.status(201).json(serializeMediaAsset(asset));
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

router.get("/assets", async (req: AuthenticatedRequest, res: Response) => {
  const prisma = req.app.locals.prisma as PrismaClient;

  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const requestedUserId = req.query.userId as string | undefined;
    const folderParam = req.query.folder as string | undefined;
    const normalizedFolder =
      folderParam !== undefined
        ? folderParam.trim().replace(/^\/+|\/+$/g, "") || null
        : undefined;

    const scopedUserId =
      isAdminUser(req) && requestedUserId?.trim()
        ? requestedUserId.trim()
        : authenticatedUserId;

    const assets = await prisma.mediaAsset.findMany({
      where: {
        ...(scopedUserId ? { userId: scopedUserId } : {}),
        ...(normalizedFolder !== undefined ? { folder: normalizedFolder } : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(assets.map(serializeMediaAsset));
  } catch (error) {
    console.error("Failed to fetch media assets:", error);
    return res.status(500).json({ error: "Failed to fetch media assets" });
  }
});

router.get("/folders", async (req: AuthenticatedRequest, res: Response) => {
  const prisma = req.app.locals.prisma as PrismaClient;

  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const requestedUserId = req.query.userId as string | undefined;
    const scopedUserId =
      isAdminUser(req) && requestedUserId?.trim()
        ? requestedUserId.trim()
        : authenticatedUserId;

    const [assetFolders, virtualFolders] = await Promise.all([
      prisma.mediaAsset.findMany({
        where: { userId: scopedUserId, folder: { not: null } },
        select: { folder: true },
        distinct: ["folder"],
        orderBy: { folder: "asc" },
      }),
      prisma.mediaFolder.findMany({
        where: { userId: scopedUserId },
        select: { path: true },
        orderBy: { path: "asc" },
      }),
    ]);

    const folderSet = new Set<string>();
    for (const row of assetFolders) {
      if (row.folder) folderSet.add(row.folder);
    }
    for (const row of virtualFolders) {
      if (row.path) folderSet.add(row.path);
    }

    return res.json(Array.from(folderSet).sort());
  } catch (error) {
    console.error("Failed to fetch media folders:", error);
    return res.status(500).json({ error: "Failed to fetch media folders" });
  }
});

router.post("/folders", async (req: AuthenticatedRequest, res: Response) => {
  const prisma = req.app.locals.prisma as PrismaClient;

  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const folderPath = normalizeFolderValue(
      (req.body as { path?: string }).path,
    );
    if (!folderPath) {
      return res.status(400).json({ error: "path is required" });
    }

    const folder = await prisma.mediaFolder.upsert({
      where: {
        userId_path: {
          userId: authenticatedUserId,
          path: folderPath,
        },
      },
      create: {
        userId: authenticatedUserId,
        path: folderPath,
      },
      update: {},
    });

    return res.status(201).json({ path: folder.path });
  } catch (error) {
    console.error("Failed to create media folder:", error);
    return res.status(500).json({ error: "Failed to create media folder" });
  }
});

router.patch("/assets/:id", async (req: AuthenticatedRequest, res: Response) => {
  const prisma = req.app.locals.prisma as PrismaClient;

  try {
    const assetId = String(req.params.id ?? "").trim();
    if (!assetId) {
      return res.status(400).json({ error: "Asset id is required" });
    }

    const access = await findAccessibleAsset(prisma, assetId, req);
    if (!access.asset) {
      return res.status(access.status).json({ error: access.error });
    }

    const { fileName, folder } = req.body as {
      fileName?: string;
      folder?: string | null;
    };

    const normalizedFileName = normalizeFileNameValue(fileName);
    const normalizedFolder = normalizeFolderValue(folder);

    if (fileName !== undefined && !normalizedFileName) {
      return res.status(400).json({ error: "Invalid fileName" });
    }

    if (folder !== undefined && normalizedFolder === undefined) {
      return res.status(400).json({ error: "Invalid folder" });
    }

    if (fileName === undefined && folder === undefined) {
      return res.status(400).json({ error: "fileName or folder is required" });
    }

    const updated = await prisma.mediaAsset.update({
      where: { id: access.asset.id },
      data: {
        ...(normalizedFileName ? { fileName: normalizedFileName } : {}),
        ...(folder !== undefined ? { folder: normalizedFolder ?? null } : {}),
      },
    });

    return res.json(serializeMediaAsset(updated));
  } catch (error) {
    console.error("Failed to update media asset:", error);
    return res.status(500).json({ error: "Failed to update media asset" });
  }
});

router.delete("/assets/folder", async (req: AuthenticatedRequest, res: Response) => {
  const prisma = req.app.locals.prisma as PrismaClient;

  try {
    const authenticatedUserId = req.user?.id;
    if (!authenticatedUserId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const folderPath = normalizeFolderValue(
      (req.body as { folderPath?: string }).folderPath,
    );
    if (!folderPath) {
      return res.status(400).json({ error: "folderPath is required" });
    }

    const assets = await prisma.mediaAsset.findMany({
      where: {
        userId: authenticatedUserId,
        OR: [
          { folder: folderPath },
          { folder: { startsWith: `${folderPath}/` } },
        ],
      },
    });

    await Promise.all(assets.map((asset) => bestEffortDeleteR2Asset(asset)));

    if (assets.length > 0) {
      await prisma.mediaAsset.deleteMany({
        where: { id: { in: assets.map((asset) => asset.id) } },
      });
    }

    await prisma.mediaFolder.deleteMany({
      where: {
        userId: authenticatedUserId,
        OR: [
          { path: folderPath },
          { path: { startsWith: `${folderPath}/` } },
        ],
      },
    });

    return res.json({ deletedCount: assets.length });
  } catch (error) {
    console.error("Failed to delete media assets in folder:", error);
    return res.status(500).json({ error: "Failed to delete folder assets" });
  }
});

router.delete("/assets/:id", async (req: AuthenticatedRequest, res: Response) => {
  const prisma = req.app.locals.prisma as PrismaClient;

  try {
    const assetId = String(req.params.id ?? "").trim();
    if (!assetId) {
      return res.status(400).json({ error: "Asset id is required" });
    }

    const access = await findAccessibleAsset(prisma, assetId, req);
    if (!access.asset) {
      return res.status(access.status).json({ error: access.error });
    }

    await bestEffortDeleteR2Asset(access.asset);

    await prisma.mediaAsset.delete({ where: { id: access.asset.id } });

    return res.status(204).send();
  } catch (error) {
    console.error("Failed to delete media asset:", error);
    return res.status(500).json({ error: "Failed to delete media asset" });
  }
});

router.post("/transcribe", async (req: AuthenticatedRequest, res: Response) => {
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

    if (!isAllowedTranscribeFileUrl(fileUrl)) {
      return res.status(400).json({
        error: "fileUrl host is not allowed for transcription",
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
