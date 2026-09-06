import type { NextFunction, Request, Response } from "express";

/**
 * Minimal structured access log: method, path, status, duration. No headers, no bodies, no
 * tokens, no PII — Render/Azure capture stdout as the log viewer, so this is deliberately safe to
 * leave on in production.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    console.log(
      JSON.stringify({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
      })
    );
  });
  next();
}
