import { createMiddleware } from "hono/factory";
import pino from "pino";

export function createLogger(level: string): pino.Logger {
  if (process.env.NODE_ENV === "production") {
    return pino({
      level: level as pino.LevelWithSilent,
    });
  }

  return pino({
    level: level as pino.LevelWithSilent,
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
        singleLine: false,
      },
    },
  });
}

export function loggingMiddleware(logger: pino.Logger) {
  return createMiddleware(async (c, next) => {
    const startTime = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Date.now() - startTime;
    const status = c.res.status;

    logger.info(
      {
        method,
        path,
        status,
        duration,
      },
      `${method} ${path} ${status} ${duration}ms`
    );
  });
}
