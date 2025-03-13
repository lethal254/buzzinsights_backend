import { NextFunction, Request, Response } from "express"

export const masterAuthMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Master Control Access"')
    res.status(401).send("Authentication required")
    return
  }

  const base64Credentials = authHeader.split(" ")[1]
  const credentials = Buffer.from(base64Credentials, "base64").toString("ascii")
  const [username, password] = credentials.split(":")

  if (!process.env.MASTER_AUTH_PASSWORD) {
    res.status(500).send("Server configuration error: Master password not set")
    return
  }

  if (password !== process.env.MASTER_AUTH_PASSWORD) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Master Control Access"')
    res.status(401).send("Invalid credentials")
    return
  }

  next()
}
