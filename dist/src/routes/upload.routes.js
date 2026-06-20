"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const path_1 = __importDefault(require("path"));
const express_1 = require("express");
const r2_1 = require("../lib/r2");
const router = (0, express_1.Router)();
router.post("/presigned-url", async (req, res) => {
    try {
        const { fileName, fileType } = req.body;
        if (!fileName || !fileType) {
            return res
                .status(400)
                .json({ error: "fileName and fileType are required" });
        }
        if (!r2_1.r2BucketName) {
            return res.status(500).json({ error: "R2_BUCKET_NAME is not configured" });
        }
        const sanitizedName = path_1.default
            .basename(fileName)
            .replace(/[^a-zA-Z0-9._-]/g, "_");
        const objectKey = `uploads/${(0, crypto_1.randomUUID)()}-${sanitizedName}`;
        const uploadUrl = await (0, r2_1.generatePresignedUploadUrl)(objectKey, fileType);
        const publicUrl = (0, r2_1.buildPublicUrl)(objectKey);
        return res.json({ uploadUrl, publicUrl });
    }
    catch (error) {
        console.error("Failed to generate presigned URL:", error);
        return res.status(500).json({ error: "Failed to generate presigned URL" });
    }
});
exports.default = router;
