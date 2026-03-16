import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export type TransportType = "stdio" | "sse" | "http";

export type TransportConfig = {
  readonly type: TransportType;
  readonly options?: Record<string, unknown>;
};

/**
 * Factory function that creates a new Transport instance.
 * Used for creating transport instances on-demand, typically per request
 * for stateless HTTP transports.
 */
export type TransportFactory = () => Transport | Promise<Transport>;
