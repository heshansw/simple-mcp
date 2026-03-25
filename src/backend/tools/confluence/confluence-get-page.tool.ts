import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isErr, domainErrorMessage } from "@shared/result.js";
import type { ConfluenceService } from "../../services/confluence.service.js";

export const ConfluenceGetPageInputSchema = z.object({
  page_id: z.string().min(1).describe("Numeric Confluence page ID"),
});

export function registerConfluenceGetPageTool(
  server: McpServer,
  deps: {
    confluenceService: ConfluenceService;
    logger: { info(msg: string, meta?: unknown): void; error(msg: string, meta?: unknown): void };
  }
): void {
  server.tool(
    "confluence_get_page",
    "Retrieve a Confluence page by ID. Returns full content converted to Markdown. Requires an active Jira connection.",
    ConfluenceGetPageInputSchema.shape,
    async (args) => {
      try {
        const input = ConfluenceGetPageInputSchema.parse(args);
        deps.logger.info("Confluence get page", { pageId: input.page_id });
        const result = await deps.confluenceService.getPage(input.page_id);
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
