"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisClient = exports.redisSubClient = exports.redisPubClient = void 0;
// rendorax-backend/redis.ts
const ioredis_1 = __importDefault(require("ioredis"));
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const createRedisClient = () => {
    return new ioredis_1.default(REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy(times) {
            return Math.min(times * 50, 2000);
        },
    });
};
exports.redisPubClient = createRedisClient();
exports.redisSubClient = createRedisClient();
exports.redisClient = createRedisClient();
exports.redisClient.on("error", (err) => console.error("[Redis] Client Error:", err));
