const Redis = require("ioredis")

export const redis = new Redis({
  host: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME || "localhost",
  port: process.env.AZURE_CACHE_FOR_REDIS_PORT || 6379,
  password: process.env.AZURE_CACHE_FOR_REDIS_ACCESS_KEY,
  ...(process.env.AZURE_CACHE_FOR_REDIS_PORT === "6380"
    ? {
        tls: {
          servername: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME,
        },
      }
    : {}),
  enableTLSForSentinelMode: false,
  maxRetriesPerRequest: null, // Disable request retries
  enableReadyCheck: false, // Skip readiness check to prevent issues
})
