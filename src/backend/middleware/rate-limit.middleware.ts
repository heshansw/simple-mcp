import { createMiddleware } from "hono/factory";

export interface RateLimiterOptions {
  readonly windowMs: number;
  readonly maxRequests: number;
}

interface RequestRecord {
  count: number;
  readonly resetAt: number;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const store = new Map<string, RequestRecord>();

  // Cleanup old entries every 60 seconds
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, record] of store.entries()) {
      if (record.resetAt <= now) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => store.delete(key));
  }, 60_000);

  // Cleanup on unref (if running in Node.js)
  if (typeof (cleanupInterval as NodeJS.Timer).unref === "function") {
    (cleanupInterval as NodeJS.Timer).unref();
  }

  return createMiddleware(async (c, next) => {
    const ip = c.req.header("x-forwarded-for") || c.env?.remote?.address || "unknown";
    const now = Date.now();

    const record = store.get(ip);
    let requestRecord: RequestRecord;

    if (!record || record.resetAt <= now) {
      // New window
      requestRecord = {
        count: 1,
        resetAt: now + options.windowMs,
      };
      store.set(ip, requestRecord);
    } else {
      // Existing window
      requestRecord = record;
      requestRecord.count++;
    }

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(options.maxRequests));
    c.header(
      "X-RateLimit-Remaining",
      String(Math.max(0, options.maxRequests - requestRecord.count))
    );
    c.header("X-RateLimit-Reset", String(requestRecord.resetAt));

    if (requestRecord.count > options.maxRequests) {
      const retryAfter = Math.ceil(
        (requestRecord.resetAt - now) / 1000
      );
      c.header("Retry-After", String(retryAfter));

      return c.json(
        {
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests",
          },
        },
        { status: 429 }
      );
    }

    await next();
  });
}
