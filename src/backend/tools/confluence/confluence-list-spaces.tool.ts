import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { ConfluenceService } from "../../services/confluence.service.js";

export const ConfluenceListSpacesInputSchema = z.object({
  type: z.enum(["global", "personal", "all"]).default("global"),
  max_results: z.number().int().min(1).max(50).default(25),
});

export function registerConfluenceListSpacesTool(
  server: McpServer,
  deps: {
    confluenceService: ConfluenceService;
    logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
  }
): void {
  server.tool(
    "confluence_list_spaces",
    "List Confluence spaces accessible to the connected Atlassian account, filtered by the configured space allowlist. Requires an active Jira connection.",
    ConfluenceListSpacesInputSchema.shape,
    async (args) => {
      try {
        const input = ConfluenceListSpacesInputSchema.parse(args);
        deps.logger.info("Confluence list spaces", { type: input.type });
        const result = await deps.confluenceService.listSpaces(
          input.type,
          input.max_results
        );
        if (isErr(result)) {
          return {
            content: [{ type: "text" as const, text: `Error: ${domainErrorMessage(result.error)}` }],
            isError: true,
          };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
