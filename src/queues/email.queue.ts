import { Queue, Worker } from "bullmq"
import nodemailer from "nodemailer"
import { createLogger, format, transports } from "winston"
import { redis } from "../config/redis"

const logger = createLogger({
  level: "info",
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "email.log" }),
  ],
})

// Verify environment variables
if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
  throw new Error(
    "SMTP_USER or SMTP_PASSWORD environment variables are not set"
  )
}

// Create email transporter
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
  tls: {
    rejectUnauthorized: false,
  },
})

// Verify email configuration on startup
transporter.verify((error) => {
  if (error) {
    logger.error("Email configuration error:", error)
  } else {
    logger.info("Email server is ready to send messages")
  }
})

// Email queue interface
interface EmailJob {
  to: string[]
  subject: string
  content: string
  timestamp: Date
}

// Create email queue with default job options
export const emailQueue = new Queue<EmailJob>("email", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
})

// Create a Worker to process email jobs
const emailWorker = new Worker<EmailJob>(
  "email",
  async (job) => {
    const { to, subject, content, timestamp } = job.data
    logger.info("Processing email job", { jobId: job.id, to, subject })
    try {
      // Send email with enhanced HTML template
      const info = await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: to.join(", "),
        subject,
        text: content,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; background-color: #f9f9f9;">
            <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <h2 style="color: #2c3e50; margin-top: 0;">Social Eye Services Alert</h2>
              <div style="color: #34495e; line-height: 1.6;">
                ${content
                  .split("\n")
                  .map((line) =>
                    line.trim().startsWith("-")
                      ? `<li style="margin-bottom: 10px;">${line.substring(
                          1
                        )}</li>`
                      : line.includes(":")
                      ? `<p style="margin: 5px 0;"><strong>${
                          line.split(":")[0]
                        }:</strong>${line.split(":")[1]}</p>`
                      : `<p style="margin: 15px 0;">${line}</p>`
                  )
                  .join("")}
              </div>
              <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #7f8c8d; font-size: 0.9em;">
                <p>Sent at: ${timestamp.toLocaleString()}</p>
                <p style="margin-top: 10px;">This is an automated notification from Social Eye Services. Please do not reply to this email.</p>
              </div>
            </div>
          </div>
        `,
      })

      logger.info("Email sent successfully", {
        jobId: job.id,
        messageId: info.messageId,
        response: info.response,
      })

      return info
    } catch (error) {
      logger.error("Error sending email", {
        jobId: job.id,
        error: error instanceof Error ? error.message : "Unknown error",
        to,
        subject,
      })
      throw error
    }
  },
  { connection: redis }
)

// Handle failed jobs
emailWorker.on("failed", (job, error) => {
  console.error("Email job failed:", job?.id, error)
})

// Handle completed jobs
emailWorker.on("completed", (job) => {
  console.log("Email sent successfully:", job.id)
})
