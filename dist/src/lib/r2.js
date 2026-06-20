"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.r2Client = exports.r2BucketName = void 0;
exports.buildPublicUrl = buildPublicUrl;
exports.generatePresignedUploadUrl = generatePresignedUploadUrl;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const PRESIGNED_URL_EXPIRY_SECONDS = 15 * 60;
function getR2Endpoint() {
    if (process.env.R2_ENDPOINT) {
        return process.env.R2_ENDPOINT;
    }
    const accountId = process.env.R2_ACCOUNT_ID;
    if (!accountId) {
        throw new Error("R2_ACCOUNT_ID or R2_ENDPOINT must be configured");
    }
    return `https://${accountId}.r2.cloudflarestorage.com`;
}
exports.r2BucketName = process.env.R2_BUCKET_NAME ?? "";
exports.r2Client = new client_s3_1.S3Client({
    region: "auto",
    endpoint: getR2Endpoint(),
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});
function buildPublicUrl(objectKey) {
    const customDomain = process.env.R2_PUBLIC_DOMAIN;
    if (customDomain) {
        return `${customDomain.replace(/\/$/, "")}/${objectKey}`;
    }
    const publicBaseUrl = process.env.R2_PUBLIC_URL;
    if (publicBaseUrl) {
        return `${publicBaseUrl.replace(/\/$/, "")}/${objectKey}`;
    }
    throw new Error("Configure R2_PUBLIC_DOMAIN or R2_PUBLIC_URL for public file URLs");
}
async function generatePresignedUploadUrl(objectKey, contentType) {
    const command = new client_s3_1.PutObjectCommand({
        Bucket: exports.r2BucketName,
        Key: objectKey,
        ContentType: contentType,
    });
    return (0, s3_request_presigner_1.getSignedUrl)(exports.r2Client, command, {
        expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });
}
