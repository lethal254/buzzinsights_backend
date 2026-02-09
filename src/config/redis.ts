import { RedisOptions } from "ioredis"

// const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || ""
// const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || ""

// Use Azure Redis if configured, otherwise use local/Docker Redis
const isAzureRedis = !!process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME

export const redis: RedisOptions = {
  host: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME || process.env.REDIS_HOST || "redis",
  port: isAzureRedis ? 6380 : parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.AZURE_CACHE_FOR_REDIS_ACCESS_KEY,
  tls: isAzureRedis ? {
    servername: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME,
    rejectUnauthorized: false,
  } : undefined,
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null, // Changed to null as required by BullMQ
  enableReadyCheck: false,
  connectTimeout: 20000,
  disconnectTimeout: 20000,
  commandTimeout: 60000,
  db: 0,
}
