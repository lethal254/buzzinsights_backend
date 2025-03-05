import express, { Request, Response } from "express"
import dotenv from "dotenv"
import cors from "cors"
dotenv.config()
import { emailQueue } from "./queues/email.queue"
import { createBullBoard } from "@bull-board/api"
import { BullAdapter } from "@bull-board/api/bullAdapter"
import { ExpressAdapter } from "@bull-board/express"
import { ingestionQueue } from "./queues/ingestion.queue"
import { categorizationQueue } from "./queues/categorization.queue"
import { notificationQueue } from "./queues/notification.queue"
import { pineconeQueue } from "./queues/pineconeIngestion.queue"
import basicAuth from "express-basic-auth"

// Import routes
import metricsRoutes from "./routes/metrics.routes"
import ingestionRoutes from "./routes/ingestion.routes"
import notificationRoutes from "./routes/notification.routes"
import categorizationRoutes from "./routes/categorization.routes"
import productCategoriesRoutes from "./routes/product-categories.routes"
import feedbackCategoriesRoutes from "./routes/feedback-categories.routes"
import subredditRoutes from "./routes/subreddit.routes"
import preferencesRoutes from "./routes/preferences.routes"
import postsRoutes from "./routes/posts.routes"
import aiinsightsRoutes from "./routes/aiinsights.routes"
import pineconeRoutes from "./routes/pineconeIngestion.route"
import Redis from "ioredis"
interface RedisError extends Error {
  code?: string
  errno?: number
  syscall?: string
}

const app = express()
const port = process.env.PORT || 4000

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  process.env.FRONTEND_URL,
].filter(Boolean) // Remove any undefined values

const corsOptions = {
  origin: function (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void
  ) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      return callback(null, true)
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      console.warn(`Origin ${origin} not allowed by CORS`)
      callback(new Error("Not allowed by CORS"))
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: true,
  optionsSuccessStatus: 200,
  maxAge: 86400, // 24 hours
}
app.use(cors(corsOptions))
app.use(express.json())

// Rebuild Bull Board configuration on each request using only static queues
const serverAdapter = new ExpressAdapter()

app.use("/admin/queues", async (req, res, next) => {
  const staticQueues = [
    new BullAdapter(emailQueue),
    new BullAdapter(ingestionQueue),
    new BullAdapter(categorizationQueue),
    new BullAdapter(notificationQueue),
    new BullAdapter(pineconeQueue),
  ]
  const boards = createBullBoard({
    queues: staticQueues,
    serverAdapter,
  })
  serverAdapter.setBasePath("/admin/queues")
  next()
})

// Use basic auth middleware for the dashboard
app.use(
  "/admin/queues",
  basicAuth({
    users: {
      admin: process.env.BULL_DASHBOARD_PASSWORD || "admin",
    },
    challenge: true,
  }),
  serverAdapter.getRouter()
)
// Mount the Bull Board UI
app.use("/admin/queues", serverAdapter.getRouter())

// Mount routes
app.use("/metrics", metricsRoutes)
app.use("/ingestion", ingestionRoutes)
app.use("/notifications", notificationRoutes)
app.use("/categorization", categorizationRoutes)
app.use("/product-categories", productCategoriesRoutes)
app.use("/feedback-categories", feedbackCategoriesRoutes)
app.use("/subreddits", subredditRoutes)
app.use("/preferences", preferencesRoutes)
app.use("/posts", postsRoutes)
app.use("/ai", aiinsightsRoutes)
app.use("/pinecone", pineconeRoutes)

// Root endpoint
app.get("/", (req: Request, res: Response) => {
  res.send("Express + TypeScript Server")
})

// Email endpoint
app.post("/send-email", async (req: Request, res: Response) => {
  try {
    const { to, subject, content } = req.body

    const job = await emailQueue.add({
      to,
      subject,
      content,
      timestamp: new Date(),
    })

    res.json({
      message: "Email job added to queue",
      jobId: job.id,
    })
  } catch (error) {
    res.status(500).json({
      error: "Failed to add job to queue",
      message: error instanceof Error ? error.message : "Unknown error",
    })
  }
})

const server = app
  .listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`)
    console.log(
      `🔄 Bull Board available at http://localhost:${port}/admin/queues`
    )
  })
  .on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.log(`Port ${port} is busy, trying ${Number(port) + 1}`)
      server.listen(Number(port) + 1)
    } else {
      console.error("Server error:", err)
    }
  })
