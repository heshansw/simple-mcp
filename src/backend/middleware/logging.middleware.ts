import { createMiddleware } from "hono/factory";
import pino from "pino";

export function createLogger(level: string): pino.Logger {
  // CRITICAL: In stdio MCP transport mode, stdout is reserved for JSON-RPC messages.
  // All logs MUST go to stderr to avoid corrupting the MCP stream.
  // Always write to stderr regardless of environment.
  const isStdioMode = process.env.CLAUDE_MCP_TRANSPORT === "stdio";
  const destination = pino.destination({ dest: 2, sync: false }); // fd 2 = stderr

  if (isStdioMode || process.env.NODE_ENV === "production") {
    // Plain JSON to stderr — no colors, no pretty printing
    return pino({ level: level as pino.LevelWithSilent }, destination);
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
        destination: 2, // stderr
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
