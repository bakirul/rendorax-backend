"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const router = (0, express_1.Router)();
router.post("/assets", async (req, res) => {
    const prisma = req.app.locals.prisma;
    try {
        const { fileName, publicUrl, mimeType, userId, folder, fileSize } = req.body;
        if (!fileName || !publicUrl || !mimeType) {
            return res.status(400).json({
                error: "fileName, publicUrl, and mimeType are required",
            });
        }
        const asset = await prisma.mediaAsset.create({
            data: {
                fileName,
                publicUrl,
                mimeType,
                userId: userId ?? null,
                folder: folder?.trim() ? folder.trim() : null,
                fileSize: typeof fileSize === "number" && Number.isFinite(fileSize)
                    ? Math.round(fileSize)
                    : null,
            },
        });
        return res.status(201).json(asset);
    }
    catch (error) {
        console.error("Failed to save media asset:", error);
        return res.status(500).json({ error: "Failed to save media asset" });
    }
});
router.get("/assets", async (req, res) => {
    const prisma = req.app.locals.prisma;
    try {
        const userId = req.query.userId;
        const folder = req.query.folder;
        const assets = await prisma.mediaAsset.findMany({
            where: {
                ...(userId ? { userId } : {}),
                ...(folder !== undefined ? { folder: folder || null } : {}),
            },
            orderBy: { createdAt: "desc" },
        });
        return res.json(assets);
    }
    catch (error) {
        console.error("Failed to fetch media assets:", error);
        return res.status(500).json({ error: "Failed to fetch media assets" });
    }
});
exports.default = router;
