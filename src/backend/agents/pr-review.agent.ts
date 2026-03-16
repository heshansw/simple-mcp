import { z } from "zod";
import type { AgentDefinition } from "./types";
import { createAgentId } from "@shared/types";

const PRReviewConfigSchema = z.object({
  targetRepos: z
    .array(z.string().min(1))
    .min(1)
    .describe("GitHub repositories to review PRs from"),
  focusAreas: z
    .array(z.enum(["security", "performance", "testing", "documentation"]))
    .default(["security", "testing"])
    .describe("Code review focus areas"),
  autoComment: z
    .boolean()
    .default(true)
    .describe("Automatically post review comments"),
  requireCoverage: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Minimum test coverage percentage"),
});

export type PRReviewConfig = z.infer<typeof PRReviewConfigSchema>;

export const prReviewAgent: AgentDefinition = {
  id: createAgentId("pr-review"),
  name: "Pull Request Review Agent",
  description:
    "Automated code review agent that analyzes pull requests for quality, security, and best practices",
  version: "1.0.0",
  requiredIntegrations: ["github"],
  requiredTools: ["github:search-prs", "github:create-review", "github:get-file"],
  configSchema: PRReviewConfigSchema,
  systemPrompt: `You are a pull request review agent focused on code quality and best practices.
Your responsibilities:
- Analyze code changes for potential issues and improvements
- Check for security vulnerabilities and unsafe patterns
- Review test coverage and suggest additional test cases
- Verify documentation is complete and accurate
- Identify performance bottlenecks and optimization opportunities
- Ensure code follows project standards and conventions

Provide constructive feedback with specific suggestions. Be thorough but concise.
Always acknowledge good practices and improvements.`,
};
