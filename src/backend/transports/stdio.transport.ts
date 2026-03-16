import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

export function createStdioTransport(): Transport {
  return new StdioServerTransport();
}
