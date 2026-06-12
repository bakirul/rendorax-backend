// kachna-backend/redis.ts
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const createRedisClient = () => {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times) {
      return Math.min(times * 50, 2000);
    },
  });
};

export const redisPubClient = createRedisClient();
export const redisSubClient = createRedisClient();
export const redisClient = createRedisClient();

redisClient.on("error", (err) => console.error("[Redis] Client Error:", err));