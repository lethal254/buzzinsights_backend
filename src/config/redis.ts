import { RedisOptions } from "ioredis"

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || ""
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || ""

export const redis: RedisOptions = {
  host: new URL(UPSTASH_URL).hostname,
  port: parseInt(process.env.UPSTASH_REDIS_PORT || "6379", 10),
  password: UPSTASH_TOKEN,
  tls: {
    rejectUnauthorized: false,
  },
  retryStrategy: (times: number) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null, // Changed to null as required by BullMQ
  enableReadyCheck: false,
  connectTimeout: 20000,
  disconnectTimeout: 20000,
  commandTimeout: 60000,
  db: 0,
}
