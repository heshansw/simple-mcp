import type { Hono } from "hono";

/**
 * Sets up SSE transport endpoints on a Hono application.
 * The transport is created and managed per request in the route handlers.
 *
 * @param app - Hono application instance
 */
export function createSSETransport(
  app: Hono
): { readonly setupRoutes: () => void } {
  return {
    setupRoutes(): void {
      // SSE requires per-request transport setup in route handlers
      // This is typically handled in the main server setup
      app.post("/sse", async (c) => {
        // Implementation provided by server integration
        return c.json({ error: "SSE transport not configured" }, 501);
      });
    },
  };
}
