import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Hono } from "hono";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Creates a WebStandard Streamable HTTP transport factory for use with Hono.
 * This transport works with Hono and other web standard runtime environments.
 *
 * @returns A factory function that creates new transport instances
 */
export function createStreamableHTTPTransport(): () => Transport {
  return () => new WebStandardStreamableHTTPServerTransport();
}

/**
 * Sets up the HTTP MCP endpoint on a Hono application.
 * The transport is created per-request for stateless operation.
 *
 * @param app - Hono application instance
 * @param handleRequest - Async function to handle MCP requests with a transport
 */
export function setupHTTPTransportRoute(
  app: Hono,
  handleRequest: (transport: Transport, request: Request) => Promise<Response>
): void {
  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const response = await handleRequest(transport, c.req.raw);
    return response;
  });
}
