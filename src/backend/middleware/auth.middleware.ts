import { createMiddleware } from "hono/factory";
import { authorizationError } from "@shared/result.js";

export interface AuthMiddlewareConfig {
  readonly apiKey?: string;
}

export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  return createMiddleware(async (c, next) => {
    // If no API key is configured, allow all requests (local-only mode)
    if (!config.apiKey) {
      await next();
      return;
    }

    const authHeader = c.req.header("Authorization");

    if (!authHeader) {
      const error = authorizationError("Missing Authorization header");
      throw error;
    }

    // Expected format: "Bearer <apiKey>"
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      const error = authorizationError(
        "Invalid Authorization header format. Expected: Bearer <token>"
      );
      throw error;
    }

    const providedKey = parts[1];

    if (providedKey !== config.apiKey) {
      const error = authorizationError("Invalid API key");
      throw error;
    }

    await next();
  });
}
