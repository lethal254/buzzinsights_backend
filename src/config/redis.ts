const Redis = require("ioredis")

export const redis = new Redis({
  host: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME || "localhost",
  port: 6380,
  password: process.env.AZURE_CACHE_FOR_REDIS_ACCESS_KEY,
  tls: {
    servername: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME,
  },
  maxRetriesPerRequest: null, // Disable request retries
  enableReadyCheck: false, // Skip readiness check to prevent issues
})
