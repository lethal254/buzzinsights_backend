const Redis = require("ioredis")

const redis = new Redis({
  host: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME || "localhost",
  port: 6380,
  password: process.env.AZURE_CACHE_FOR_REDIS_ACCESS_KEY,
  tls: {
    servername: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME,
  },
  enableTLSForSentinelMode: false,
  maxRetriesPerRequest: null, // Disable request retries
  enableReadyCheck: false, // Skip readiness check to prevent issues
})

// Log connection success or fails
redis.on("connect", () => {
  console.log("Redis connected")
})
interface RedisErrorHandler {
  (error: Error): void
}

redis.on("error", (error: Error): void => {
  console.error("Redis error", error)
})

export { redis }
