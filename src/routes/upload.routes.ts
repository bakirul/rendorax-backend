import { Router } from "express";
import type { Request, Response } from "express";
import { createPresignedUpload } from "../lib/r2";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

router.use(requireAuth);

router.post("/presigned-url", async (req: Request, res: Response) => {
  try {
    const { fileName, fileType } = req.body as {
      fileName?: string;
      fileType?: string;
    };

    if (!fileName || !fileType) {
      return res
        .status(400)
        .json({ error: "fileName and fileType are required" });
    }

    const { uploadUrl, publicUrl, objectKey } = await createPresignedUpload(
      fileName,
      fileType,
    );

    return res.json({ uploadUrl, publicUrl, objectKey });
  } catch (error) {
    console.error("Failed to generate presigned URL:", error);
    return res.status(500).json({ error: "Failed to generate presigned URL" });
  }
});

export default router;
