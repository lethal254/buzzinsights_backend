const Redis = require("ioredis")

interface RetryStrategy {
  (times: number): number
}

interface ReconnectOnError {
  (err: Error): boolean
}

const redis = new Redis({
  host: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME || "localhost",
  port: 6380,
  password: process.env.AZURE_CACHE_FOR_REDIS_ACCESS_KEY,
  tls: {
    servername: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME,
  },
  connectTimeout: 15000, // Increase connection timeout
  maxRetriesPerRequest: 3, // Add a reasonable retry limit
  retryStrategy: ((times: number): number => {
    return Math.min(times * 500, 10000) // Exponential backoff with 10s cap
  }) as RetryStrategy,
  reconnectOnError: ((err: Error): boolean => {
    const targetError = "READONLY"
    if (err.message.includes(targetError)) {
      return true // Reconnect for specific errors
    }
    return false
  }) as ReconnectOnError,
  enableOfflineQueue: true, // Queue operations when disconnected
  enableTLSForSentinelMode: false,
  enableReadyCheck: true, // Enable this to ensure Redis is ready
})

// Add more detailed logging
redis.on("connect", () => {
  console.log("Redis connected")
})

redis.on("ready", () => {
  console.log("Redis ready for commands")
})

redis.on("reconnecting", () => {
  console.log("Redis reconnecting...")
})

redis.on("close", () => {
  console.log("Redis connection closed")
})

redis.on("error", (error: Error) => {
  console.error("Redis error", error)
})

export { redis }
