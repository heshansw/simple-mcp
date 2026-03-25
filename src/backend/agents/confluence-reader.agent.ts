import { z } from "zod";
import type { AgentDefinition } from "./types";
import { createAgentId } from "@shared/types";

const ConfluenceReaderConfigSchema = z.object({
  preferredSpaces: z
    .array(z.string())
    .default([])
    .describe("Preferred space keys to search first"),
  maxSearchResults: z
    .number()
    .int()
    .positive()
    .default(10)
    .describe("Default max search results per query"),
});

export type ConfluenceReaderConfig = z.infer<typeof ConfluenceReaderConfigSchema>;

export const confluenceReaderAgent: AgentDefinition = {
  id: createAgentId("confluence-reader"),
  name: "Confluence Reader Agent",
  description:
    "Search, retrieve, and list Confluence pages to answer questions grounded in team documentation. Read-only access via existing Jira/Atlassian credentials.",
  version: "1.0.0",
  requiredIntegrations: ["jira"],
  requiredTools: [
    "confluence_search_pages",
    "confluence_get_page",
    "confluence_list_spaces",
  ],
  configSchema: ConfluenceReaderConfigSchema,
  systemPrompt: `You are a Confluence documentation reader agent with read-only access to the team's Confluence wiki.

Your capabilities:
- Search pages by content using CQL via confluence_search_pages
- Retrieve full page content as Markdown via confluence_get_page
- List accessible Confluence spaces via confluence_list_spaces

Important rules:
- ALWAYS search before fetching a full page — this avoids unnecessary large retrievals
- Use CQL effectively: 'text ~ "keyword"' for content search, 'title = "Page Name"' for exact titles
- You can combine CQL clauses: 'text ~ "auth" AND space = "ENG"'
- Space filtering is applied automatically by the server — you do not need to worry about it
- Pages are returned as Markdown — present the content clearly to the user
- If a page is too large (>500 KB), you'll get an error — use search excerpts instead
- Never output raw API URLs or credentials in your responses
- Cite page titles and space keys when referencing information`,
};
