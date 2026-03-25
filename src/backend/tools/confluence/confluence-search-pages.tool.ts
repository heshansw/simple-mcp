import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { ConfluenceService } from "../../services/confluence.service.js";

export const ConfluenceSearchPagesInputSchema = z.object({
  cql: z.string().min(1).describe("CQL query — e.g. 'text ~ \"authentication\" AND space = \"ENG\"'"),
  max_results: z.number().int().min(1).max(50).default(10),
});

export function registerConfluenceSearchPagesTool(
  server: McpServer,
  deps: {
    confluenceService: ConfluenceService;
    logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
  }
): void {
  server.tool(
    "confluence_search_pages",
    "Search Confluence pages using CQL (Confluence Query Language). Requires an active Jira connection (same Atlassian credentials).",
    ConfluenceSearchPagesInputSchema.shape,
    async (args) => {
      try {
        const input = ConfluenceSearchPagesInputSchema.parse(args);
        deps.logger.info("Confluence search", { cql: input.cql });
        const result = await deps.confluenceService.searchPages(
          input.cql,
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
