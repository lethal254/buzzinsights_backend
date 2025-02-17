import { Response } from "express"
import { safeJsonStringify } from "./jsonReplacer"

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: any
  }
  metadata?: {
    timestamp: string
    path?: string
  }
}

export class ResponseUtils {
  static success<T>(res: Response, data: T, statusCode: number = 200): void {
    const response: ApiResponse<T> = {
      success: true,
      data,
      metadata: {
        timestamp: new Date().toISOString(),
        path: res.req.originalUrl,
      },
    }
    res.setHeader("Content-Type", "application/json")
    res.end(safeJsonStringify(response))
  }

  static error(
    res: Response,
    message: string,
    statusCode: number = 500,
    code: string = "INTERNAL_SERVER_ERROR",
    details?: any
  ): void {
    const response: ApiResponse<null> = {
      success: false,
      error: {
        code,
        message,
        details,
      },
      metadata: {
        timestamp: new Date().toISOString(),
        path: res.req.originalUrl,
      },
    }
    res.statusCode = statusCode
    res.setHeader("Content-Type", "application/json")
    res.end(safeJsonStringify(response))
  }
}
