export const REDIS_CONFIG = {
  host: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME || "localhost",
  port: 6380, // Azure Redis Cache uses port 6380 for SSL
  password: process.env.AZURE_CACHE_FOR_REDIS_ACCESS_KEY,
  tls: {
    servername: process.env.AZURE_CACHE_FOR_REDIS_HOST_NAME,
  },
}
