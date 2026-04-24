import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

import type { EnvConfig } from "./config/env.schema.js";
import {
  createDatabase,
  backupDatabase,
} from "./db/client.js";
import { createConnectionsRepository } from "./db/repositories/connections.repository.js";
import { createCredentialsRepository } from "./db/repositories/credentials.repository.js";
import { createAgentConfigsRepository } from "./db/repositories/agent-configs.repository.js";
import { createServerSettingsRepository } from "./db/repositories/server-settings.repository.js";
import { createSyncMetadataRepository } from "./db/repositories/sync-metadata.repository.js";
import { createReviewsRepository } from "./db/repositories/reviews.repository.js";
import { createOAuthNoncesRepository } from "./db/repositories/oauth-nonces.repository.js";
import { createConfluenceActivityRepository } from "./db/repositories/confluence-activity.repository.js";
import { createFolderAccessRepository } from "./db/repositories/folder-access.repository.js";
import { createRepoWorkspacesRepository } from "./db/repositories/repo-workspaces.repository.js";
import { createDbQueryActivityRepository } from "./db/repositories/db-query-activity.repository.js";

import { createEncryptionService } from "./services/encryption.service.js";
import { createConnectionManagerService } from "./services/connection-manager.service.js";
import { createJiraService } from "./services/jira.service.js";
import { createGitHubService } from "./services/github.service.js";
import { createGoogleCalendarService } from "./services/google-calendar.service.js";
import type { GoogleTokenBundle } from "./services/google-calendar.service.js";
import { createLocalFilesystemService } from "./services/local-filesystem.service.js";
import { createConfluenceService } from "./services/confluence.service.js";
import { createDatabaseQueryService } from "./services/database-query.service.js";
import { DbCredentialsSchema, DbPermissionsSchema } from "@shared/schemas/database-connection.schema.js";

import { createLogger, loggingMiddleware } from "./middleware/logging.middleware.js";
import { errorHandlerMiddleware } from "./middleware/error-handler.middleware.js";
import { createRateLimiter } from "./middleware/rate-limit.middleware.js";

import { createAgentRegistry } from "./agents/registry.js";
import {
  jiraTriageAgent,
  prReviewAgent,
  codeSearchAgent,
  sprintPlanningAgent,
  localRepoAnalysisAgent,
  confluenceReaderAgent,
  confluenceWriterAgent,
  databaseExplorerAgent,
  reactFrontendDevAgent,
  javaBackendDevAgent,
  databaseArchitectAgent,
  qaEngineerAgent,
  businessAnalystAgent,
  backendPrReviewerAgent,
  frontendPrReviewerAgent,
  securityReviewerAgent,
  githubPrWorkflowAgent,
  frontendOrchestratorAgent,
  backendOrchestratorAgent,
  fullstackOrchestratorAgent,
} from "./agents/index.js";

import {
  createToolHandlerRegistry,
  createToolExecutor,
  createObservationSummarizer,
  createTaskPlanner,
  createDelegationHandler,
  createExecutionEngine,
} from "./agents/engine/index.js";
import type { ToolHandlerRegistry } from "./agents/engine/index.js";

import { createAgentRunsRepository } from "./db/repositories/agent-runs.repository.js";
import { createAgentTasksRepository } from "./db/repositories/agent-tasks.repository.js";
import { createAgentRunStepsRepository } from "./db/repositories/agent-run-steps.repository.js";

import { registerAgentExecuteTool } from "./tools/system/agent-execute.tool.js";
import { registerAgentStatusTool } from "./tools/system/agent-status.tool.js";
import { registerAgentListTool } from "./tools/system/agent-list.tool.js";
import { registerAgentStartRunTool } from "./tools/system/agent-start-run.tool.js";
import { registerAgentRecordStepTool } from "./tools/system/agent-record-step.tool.js";
import { registerAgentUpdateTaskTool } from "./tools/system/agent-update-task.tool.js";
import { registerAgentCompleteRunTool } from "./tools/system/agent-complete-run.tool.js";

import { createMaintenanceScheduler } from "./maintenance/scheduler.js";
import { createStdioTransport } from "./transports/stdio.transport.js";
import { createSSETransport } from "./transports/sse.transport.js";

import { registerSearchIssuesTool } from "./tools/jira/search-issues.tool.js";
import { registerCreateIssueTool } from "./tools/jira/create-issue.tool.js";
import { registerTransitionIssueTool } from "./tools/jira/transition-issue.tool.js";
import { registerGetTransitionsTool } from "./tools/jira/get-transitions.tool.js";
import { registerChangeStatusTool } from "./tools/jira/change-status.tool.js";
import { registerFindUsersTool } from "./tools/jira/find-users.tool.js";
import { registerAssignIssueTool } from "./tools/jira/assign-issue.tool.js";
import { registerGetCommentsTool } from "./tools/jira/get-comments.tool.js";
import { registerAddCommentTool } from "./tools/jira/add-comment.tool.js";
import { registerUpdateIssueDescriptionTool } from "./tools/jira/update-issue-description.tool.js";
import { registerUpdateIssueTool } from "./tools/jira/update-issue.tool.js";
import { registerListPrsTool } from "./tools/github/list-prs.tool.js";
import { registerReviewPrTool } from "./tools/github/review-pr.tool.js";
import { registerSearchCodeTool } from "./tools/github/search-code.tool.js";
import { registerGetPrDiffTool } from "./tools/github/get-pr-diff.tool.js";
import { registerGetMyPrsTool } from "./tools/github/get-my-prs.tool.js";
import { registerCreatePrTool } from "./tools/github/create-pr.tool.js";
import { registerHealthCheckTool } from "./tools/system/health-check.tool.js";
import { registerListConnectionsTool } from "./tools/system/list-connections.tool.js";
import { registerListEventsTool } from "./tools/google-calendar/list-events.tool.js";
import { registerCreateEventTool } from "./tools/google-calendar/create-event.tool.js";
import { registerCheckAvailabilityTool } from "./tools/google-calendar/check-availability.tool.js";
import { registerListAvailableRoomsTool } from "./tools/google-calendar/list-available-rooms.tool.js";
import { registerFsListDirectoryTool } from "./tools/local-filesystem/fs-list-directory.tool.js";
import { registerFsReadFileTool } from "./tools/local-filesystem/fs-read-file.tool.js";
import { registerFsSearchFilesTool } from "./tools/local-filesystem/fs-search-files.tool.js";
import { registerFsGetFileTreeTool } from "./tools/local-filesystem/fs-get-file-tree.tool.js";
import { registerFsWorkspaceSearchTool } from "./tools/local-filesystem/fs-workspace-search.tool.js";
import { registerFsWorkspaceTreeTool } from "./tools/local-filesystem/fs-workspace-tree.tool.js";
import { registerFsListFoldersTool } from "./tools/local-filesystem/fs-list-folders.tool.js";
import { registerFsListWorkspacesTool } from "./tools/local-filesystem/fs-list-workspaces.tool.js";
import { registerConfluenceSearchPagesTool } from "./tools/confluence/confluence-search-pages.tool.js";
import { registerConfluenceGetPageTool } from "./tools/confluence/confluence-get-page.tool.js";
import { registerConfluenceListSpacesTool } from "./tools/confluence/confluence-list-spaces.tool.js";
import { registerConfluenceCreatePageTool } from "./tools/confluence/confluence-create-page.tool.js";
import { registerConfluenceUpdatePageTool } from "./tools/confluence/confluence-update-page.tool.js";
import { registerConfluenceDeletePageTool } from "./tools/confluence/confluence-delete-page.tool.js";
import { registerDbListSchemasTool } from "./tools/local-database/db-list-schemas.tool.js";
import { registerDbListTablesTool } from "./tools/local-database/db-list-tables.tool.js";
import { registerDbDescribeTableTool } from "./tools/local-database/db-describe-table.tool.js";
import { registerDbQueryTool } from "./tools/local-database/db-query.tool.js";

import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

import { randomBytes } from "node:crypto";
import { isErr, domainErrorMessage } from "@shared/result.js";
import {
  DEFAULT_LOCAL_MCP_CLIENT_CONNECTION_NAME,
  getMissingDedicatedLocalMcpClientConnectionNames,
  isAnthropicConnectionCandidate,
  shouldCreateDefaultLocalMcpClientConnection,
} from "@shared/mcp-client.js";
import type { MaintenanceScheduler } from "./maintenance/scheduler.js";

export interface ServerComponents {
  readonly mcpServer: McpServer;
  readonly httpApp: Hono;
  readonly scheduler: MaintenanceScheduler;
  readonly cleanup: () => Promise<void>;
}

export async function createServer(
  config: EnvConfig
): Promise<ServerComponents> {
  const logger = createLogger(config.CLAUDE_MCP_LOG_LEVEL);
  logger.info({ config }, "Initializing server");

  // Backup and create database
  console.error("[startup] Creating database...");
  backupDatabase(config.CLAUDE_MCP_DB_PATH);
  const db = await createDatabase(config.CLAUDE_MCP_DB_PATH);
  console.error("[startup] Database created");
  logger.info({ path: config.CLAUDE_MCP_DB_PATH }, "Database initialized");

  // Create repositories
  const connectionsRepo = createConnectionsRepository(db);
  const credentialsRepo = createCredentialsRepository(db);
  const agentConfigsRepo = createAgentConfigsRepository(db);
  const serverSettingsRepo = createServerSettingsRepository(db);
  const reviewsRepo = createReviewsRepository(db);
  const oauthNoncesRepo = createOAuthNoncesRepository(db);
  const confluenceActivityRepo = createConfluenceActivityRepository(db);
  const folderAccessRepo = createFolderAccessRepository(db);
  const workspacesRepo = createRepoWorkspacesRepository(db);
  const dbQueryActivityRepo = createDbQueryActivityRepository(db);
  const agentRunsRepo = createAgentRunsRepository(db);
  const agentTasksRepo = createAgentTasksRepository(db);
  const agentRunStepsRepo = createAgentRunStepsRepository(db);
  createSyncMetadataRepository(db); // Used internally but not exported

  // Create encryption service
  const encryptionKey = config.CLAUDE_MCP_ENCRYPTION_KEY || "default-insecure-key";
  const encryptionService = createEncryptionService(encryptionKey);

  // Create application services
  const connectionManager = createConnectionManagerService({
    connectionsRepo,
    credentialsRepo,
    encryptionService,
    logger,
  });

  // Shared Jira/Confluence connection info resolver — same Atlassian credentials
  const getJiraConnectionInfo = async () => {
    const allConns = await connectionsRepo.findAll();
    const jiraConn = allConns.find(
      (c) => c.integrationType === "jira" && c.status === "connected"
    );
    if (!jiraConn) return null;
    const cred = await credentialsRepo.findByConnectionId(jiraConn.id);
    if (!cred) return null;
    try {
      const raw = encryptionService.decrypt(cred.encryptedData, cred.iv);
      const parsed = JSON.parse(raw) as { email?: string; apiToken?: string };
      if (!parsed.email || !parsed.apiToken) return null;
      return {
        siteUrl: jiraConn.baseUrl,
        credentials: { email: parsed.email, apiToken: parsed.apiToken },
      };
    } catch {
      return null;
    }
  };

  const jiraService = createJiraService({
    logger,
    getConnectionInfo: getJiraConnectionInfo,
  });

  // GitHub service resolves its token from the first connected GitHub connection
  // that actually has stored credentials (skip local MCP client placeholders).
  const resolveGitHubTokenByName = async (connectionName: string): Promise<string | null> => {
    const allConns = await connectionsRepo.findAll();
    const match = allConns.find(
      (c) =>
        c.integrationType === "github" &&
        c.status === "connected" &&
        c.name === connectionName
    );
    if (!match) return null;
    const cred = await credentialsRepo.findByConnectionId(match.id);
    if (!cred) return null;
    try {
      return encryptionService.decrypt(cred.encryptedData, cred.iv);
    } catch {
      return null;
    }
  };

  const githubService = createGitHubService({
    logger,
    getToken: async () => {
      const allConns = await connectionsRepo.findAll();
      const githubConns = allConns.filter(
        (c) => c.integrationType === "github" && c.status === "connected"
      );
      for (const conn of githubConns) {
        const cred = await credentialsRepo.findByConnectionId(conn.id);
        if (!cred) continue;
        try {
          const token = encryptionService.decrypt(cred.encryptedData, cred.iv);
          if (token) return token;
        } catch {
          continue;
        }
      }
      return null;
    },
    getTokenForConnection: resolveGitHubTokenByName,
  });

  // Google Calendar service — only created if OAuth credentials are configured
  const googleCalendarService = config.GOOGLE_OAUTH_CLIENT_ID && config.GOOGLE_OAUTH_CLIENT_SECRET
    ? createGoogleCalendarService({
        logger,
        clientId: config.GOOGLE_OAUTH_CLIENT_ID,
        clientSecret: config.GOOGLE_OAUTH_CLIENT_SECRET,
        getConnectionInfo: async () => {
          const allConns = await connectionsRepo.findAll();
          const gcalConn = allConns.find(
            (c) => c.integrationType === "google-calendar" && c.status === "connected"
          );
          if (!gcalConn) return null;
          const cred = await credentialsRepo.findByConnectionId(gcalConn.id);
          if (!cred) return null;
          try {
            const raw = encryptionService.decrypt(cred.encryptedData, cred.iv);
            const tokens = JSON.parse(raw) as GoogleTokenBundle;
            if (!tokens.access_token || !tokens.refresh_token || !tokens.expiry) return null;
            return { connectionId: gcalConn.id, tokens };
          } catch {
            return null;
          }
        },
        storeUpdatedTokens: async (connectionId: string, tokens: GoogleTokenBundle) => {
          const tokenJson = JSON.stringify(tokens);
          const { encryptedData, iv } = encryptionService.encrypt(tokenJson);
          const existing = await credentialsRepo.findByConnectionId(connectionId);
          if (existing) {
            await credentialsRepo.update(existing.id, { encryptedData, iv });
          } else {
            await credentialsRepo.create({ connectionId, encryptedData, iv });
          }
        },
      })
    : null;

  // Local filesystem service
  const localFilesystemService = createLocalFilesystemService({
    logger,
    folderAccessRepo,
    workspacesRepo,
  });

  // Confluence service — reuses Jira connection info
  const confluenceService = createConfluenceService({
    logger,
    getConnectionInfo: getJiraConnectionInfo,
    getAllowedSpaceKeys: async () => {
      const raw = await serverSettingsRepo.get("confluence.allowed_space_keys");
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as string[]).map((k) => k.toUpperCase()) : [];
      } catch {
        return [];
      }
    },
  });

  // Database query service — resolves connections from the existing connections/credentials tables
  const databaseQueryService = createDatabaseQueryService({
    logger,
    resolveConnection: async (connectionId) => {
      const conn = await connectionsRepo.findById(connectionId);
      if (!conn) {
        return { _tag: "Err", error: { _tag: "NotFoundError", resource: "Connection", id: connectionId } };
      }
      if (conn.integrationType !== "mysql" && conn.integrationType !== "postgres") {
        return {
          _tag: "Err",
          error: { _tag: "ValidationError", message: `Connection '${conn.name}' is not a database connection (type: ${conn.integrationType})`, details: undefined },
        };
      }
      const cred = await credentialsRepo.findByConnectionId(connectionId);
      if (!cred) {
        return { _tag: "Err", error: { _tag: "NotFoundError", resource: "Credential", id: connectionId } };
      }
      let decrypted: string;
      try {
        decrypted = encryptionService.decrypt(cred.encryptedData, cred.iv);
      } catch {
        return {
          _tag: "Err",
          error: { _tag: "IntegrationError", integration: conn.integrationType, message: "Failed to decrypt credentials", statusCode: undefined },
        };
      }
      let parsedCreds: unknown;
      try {
        parsedCreds = JSON.parse(decrypted);
      } catch {
        return {
          _tag: "Err",
          error: { _tag: "ValidationError", message: "Stored credentials are not valid JSON", details: undefined },
        };
      }
      const credResult = DbCredentialsSchema.safeParse(parsedCreds);
      if (!credResult.success) {
        return {
          _tag: "Err",
          error: { _tag: "ValidationError", message: "Stored credentials do not match expected schema", details: undefined },
        };
      }

      let permissions: import("@shared/schemas/database-connection.schema.js").DbPermissions;
      try {
        const raw = conn.dbPermissions && conn.dbPermissions !== "{}" ? JSON.parse(conn.dbPermissions) : {};
        const parsed = DbPermissionsSchema.safeParse(raw);
        permissions = parsed.success ? parsed.data : { allowedSchemas: [], allowWrites: false };
      } catch {
        permissions = { allowedSchemas: [], allowWrites: false };
      }

      // Override allowWrites from the column-level flag as well
      if (conn.allowWrites === 1) {
        permissions = { ...permissions, allowWrites: true };
      }

      return {
        _tag: "Ok",
        value: {
          id: conn.id,
          name: conn.name,
          dialect: conn.integrationType as "mysql" | "postgres",
          status: conn.status,
          permissions,
          credentials: credResult.data,
        },
      };
    },
  });

  // Create MCP server
  console.error("[startup] Creating MCP server...");
  const mcpServer = new McpServer({
    name: "simple-mcp",
    version: "0.1.0",
  });
  console.error("[startup] MCP server created");

  // Register tools — GitHub tools use the new service interface directly
  const githubToolDeps = { githubService, logger };
  const jiraToolDeps = { jiraService, connectionManager, logger };

  console.error("[startup] Registering tools...");
  registerSearchIssuesTool(mcpServer, jiraToolDeps);
  registerCreateIssueTool(mcpServer, jiraToolDeps);
  registerTransitionIssueTool(mcpServer, jiraToolDeps);
  registerGetTransitionsTool(mcpServer, jiraToolDeps);
  registerChangeStatusTool(mcpServer, jiraToolDeps);
  registerFindUsersTool(mcpServer, jiraToolDeps);
  registerAssignIssueTool(mcpServer, jiraToolDeps);
  registerGetCommentsTool(mcpServer, jiraToolDeps);
  registerAddCommentTool(mcpServer, jiraToolDeps);
  registerUpdateIssueDescriptionTool(mcpServer, jiraToolDeps);
  registerUpdateIssueTool(mcpServer, jiraToolDeps);
  registerListPrsTool(mcpServer, githubToolDeps);
  registerReviewPrTool(mcpServer, { ...githubToolDeps, reviewsRepo });
  registerSearchCodeTool(mcpServer, githubToolDeps);
  registerGetPrDiffTool(mcpServer, { ...githubToolDeps, reviewsRepo });
  registerGetMyPrsTool(mcpServer, githubToolDeps);
  registerCreatePrTool(mcpServer, githubToolDeps);
  registerHealthCheckTool(mcpServer, { logger, connectionManager } as any);
  registerListConnectionsTool(mcpServer, { logger, connectionManager } as any);

  // Google Calendar tools — only register if service is available
  if (googleCalendarService) {
    const gcalToolDeps = { googleCalendarService, logger };
    registerListEventsTool(mcpServer, gcalToolDeps);
    registerCreateEventTool(mcpServer, gcalToolDeps);
    registerCheckAvailabilityTool(mcpServer, gcalToolDeps);
    registerListAvailableRoomsTool(mcpServer, gcalToolDeps);
    logger.info("Google Calendar MCP tools registered");
  } else {
    logger.info("Google Calendar tools skipped — GOOGLE_OAUTH_CLIENT_ID/SECRET not configured");
  }

  // Local filesystem tools — always registered (operations are gated by folder registration)
  const fsToolDeps = { fsService: localFilesystemService, logger };
  registerFsListDirectoryTool(mcpServer, fsToolDeps);
  registerFsReadFileTool(mcpServer, fsToolDeps);
  registerFsSearchFilesTool(mcpServer, fsToolDeps);
  registerFsGetFileTreeTool(mcpServer, fsToolDeps);
  registerFsWorkspaceSearchTool(mcpServer, fsToolDeps);
  registerFsWorkspaceTreeTool(mcpServer, fsToolDeps);
  registerFsListFoldersTool(mcpServer, { folderAccessRepo, logger });
  registerFsListWorkspacesTool(mcpServer, { workspacesRepo, folderAccessRepo, logger });
  logger.info("Local filesystem MCP tools registered");

  // Confluence tools — always registered (gated by Jira connection at invocation)
  // Wrap the service to record activity for every call
  const trackedConfluenceService: typeof confluenceService = {
    async searchPages(cql, maxResults) {
      const start = Date.now();
      const result = await confluenceService.searchPages(cql, maxResults);
      const duration = Date.now() - start;
      const isOk = result._tag === "Ok";
      confluenceActivityRepo.record({
        toolName: "confluence_search_pages",
        cql,
        resultCount: isOk ? result.value.results.length : 0,
        contentSizeBytes: isOk ? JSON.stringify(result.value).length : 0,
        durationMs: duration,
        success: isOk ? 1 : 0,
        errorTag: !isOk ? result.error._tag : null,
      }).catch((e) => logger.error({ error: e }, "Failed to record confluence activity"));
      return result;
    },
    async getPage(pageId) {
      const start = Date.now();
      const result = await confluenceService.getPage(pageId);
      const duration = Date.now() - start;
      const isOk = result._tag === "Ok";
      confluenceActivityRepo.record({
        toolName: "confluence_get_page",
        pageId,
        spaceKey: isOk ? result.value.spaceKey : null,
        resultCount: isOk ? 1 : 0,
        contentSizeBytes: isOk ? result.value.contentMarkdown.length : 0,
        durationMs: duration,
        success: isOk ? 1 : 0,
        errorTag: !isOk ? result.error._tag : null,
      }).catch((e) => logger.error({ error: e }, "Failed to record confluence activity"));
      return result;
    },
    async listSpaces(type, maxResults) {
      const start = Date.now();
      const result = await confluenceService.listSpaces(type, maxResults);
      const duration = Date.now() - start;
      const isOk = result._tag === "Ok";
      confluenceActivityRepo.record({
        toolName: "confluence_list_spaces",
        resultCount: isOk ? result.value.spaces.length : 0,
        contentSizeBytes: isOk ? JSON.stringify(result.value).length : 0,
        durationMs: duration,
        success: isOk ? 1 : 0,
        errorTag: !isOk ? result.error._tag : null,
      }).catch((e) => logger.error({ error: e }, "Failed to record confluence activity"));
      return result;
    },
    // Write methods delegated directly — tools handle their own telemetry
    createPage: (input) => confluenceService.createPage(input),
    updatePage: (input) => confluenceService.updatePage(input),
    deletePage: (input) => confluenceService.deletePage(input),
  };
  const confluenceToolDeps = { confluenceService: trackedConfluenceService, logger };
  registerConfluenceSearchPagesTool(mcpServer, confluenceToolDeps);
  registerConfluenceGetPageTool(mcpServer, confluenceToolDeps);
  registerConfluenceListSpacesTool(mcpServer, confluenceToolDeps);

  // Confluence write tools — pass activity repo directly (tools handle their own telemetry)
  const confluenceWriteToolDeps = {
    confluenceService: confluenceService,
    confluenceActivityRepo,
    logger,
  };
  registerConfluenceCreatePageTool(mcpServer, confluenceWriteToolDeps);
  registerConfluenceUpdatePageTool(mcpServer, confluenceWriteToolDeps);
  registerConfluenceDeletePageTool(mcpServer, confluenceWriteToolDeps);
  logger.info("Confluence MCP tools registered (read + write)");

  // Local database tools — always registered (gated by connection resolution at invocation)
  const dbToolDeps = { dbQueryService: databaseQueryService, dbQueryActivityRepo, logger };
  registerDbListSchemasTool(mcpServer, dbToolDeps);
  registerDbListTablesTool(mcpServer, dbToolDeps);
  registerDbDescribeTableTool(mcpServer, dbToolDeps);
  registerDbQueryTool(mcpServer, dbToolDeps);
  logger.info("Local database MCP tools registered");

  console.error("[startup] Tools registered");

  logger.info("All MCP tools registered");

  // Create and populate agent registry
  const agentRegistry = createAgentRegistry({ logger });
  agentRegistry.register(jiraTriageAgent);
  agentRegistry.register(prReviewAgent);
  agentRegistry.register(codeSearchAgent);
  agentRegistry.register(sprintPlanningAgent);
  agentRegistry.register(localRepoAnalysisAgent);
  agentRegistry.register(confluenceReaderAgent);
  agentRegistry.register(confluenceWriterAgent);
  agentRegistry.register(databaseExplorerAgent);

  // Specialist agents (REQ-6.1)
  agentRegistry.register(reactFrontendDevAgent);
  agentRegistry.register(javaBackendDevAgent);
  agentRegistry.register(databaseArchitectAgent);
  agentRegistry.register(qaEngineerAgent);
  agentRegistry.register(businessAnalystAgent);
  agentRegistry.register(backendPrReviewerAgent);
  agentRegistry.register(frontendPrReviewerAgent);
  agentRegistry.register(securityReviewerAgent);

  // Workflow agents
  agentRegistry.register(githubPrWorkflowAgent);

  // Orchestrator agents (REQ-6.2)
  agentRegistry.register(frontendOrchestratorAgent);
  agentRegistry.register(backendOrchestratorAgent);
  agentRegistry.register(fullstackOrchestratorAgent);

  logger.info(
    { agentCount: agentRegistry.getAll().length },
    "Agent registry populated"
  );

  // ── Agent Execution Engine ────────────────────────────────────────────
  console.error("[startup] Initializing agent execution engine...");

  // Create tool handler registry — stores in-process tool handlers for the engine
  const toolHandlerRegistry: ToolHandlerRegistry = createToolHandlerRegistry({ logger });

  // Register tool handlers for the agent engine. These bridge to the same
  // underlying service functions as the MCP tool handlers.
  // Use domainErrorMessage for all error formatting.

  const errText = (e: import("@shared/result").DomainError) =>
    domainErrorMessage(e);

  // Jira tools
  toolHandlerRegistry.register("jira_search_issues", "Search for Jira issues using JQL", { type: "object", properties: { jql: { type: "string" }, maxResults: { type: "number" } }, required: ["jql"] }, async (args) => {
    const result = await jiraService.searchIssues(args.jql as string, (args.maxResults as number) ?? 50);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_create_issue", "Create a new Jira issue", { type: "object", properties: { projectKey: { type: "string" }, summary: { type: "string" }, issueType: { type: "string" }, description: { type: "string" }, descriptionMarkdown: { type: "string" }, descriptionAdf: { type: "object" } }, required: ["projectKey", "summary", "issueType"] }, async (args) => {
    const result = await jiraService.createIssue({
      projectKey: args.projectKey as string,
      summary: args.summary as string,
      issueType: args.issueType as string,
      ...(args.description !== undefined ? { description: args.description as string } : {}),
      ...(args.descriptionMarkdown !== undefined ? { descriptionMarkdown: args.descriptionMarkdown as string } : {}),
      ...(args.descriptionAdf !== undefined ? { descriptionAdf: args.descriptionAdf as import("@shared/schemas/jira.schema").JiraAdfDocument } : {}),
    });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_transition_issue", "Transition a Jira issue to a new status", { type: "object", properties: { issueKey: { type: "string" }, transitionId: { type: "string" } }, required: ["issueKey", "transitionId"] }, async (args) => {
    const result = await jiraService.transitionIssue(args.issueKey as string, args.transitionId as string);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_get_transitions", "List the available Jira transitions for an issue", { type: "object", properties: { issueKey: { type: "string" } }, required: ["issueKey"] }, async (args) => {
    const result = await jiraService.getAvailableTransitions(args.issueKey as string);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_change_status", "Change a Jira issue by resolving a target status name against available transitions", { type: "object", properties: { issueKey: { type: "string" }, targetStatusName: { type: "string" } }, required: ["issueKey", "targetStatusName"] }, async (args) => {
    const result = await jiraService.changeIssueStatus(args.issueKey as string, args.targetStatusName as string);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_find_users", "Find Jira users by query, display name, email address, or account ID", { type: "object", properties: { query: { type: "string" }, displayName: { type: "string" }, emailAddress: { type: "string" }, accountId: { type: "string" }, maxResults: { type: "number" } } }, async (args) => {
    const result = await jiraService.findUsers({
      ...(args.query !== undefined ? { query: args.query as string } : {}),
      ...(args.displayName !== undefined ? { displayName: args.displayName as string } : {}),
      ...(args.emailAddress !== undefined ? { emailAddress: args.emailAddress as string } : {}),
      ...(args.accountId !== undefined ? { accountId: args.accountId as string } : {}),
      ...(args.maxResults !== undefined ? { maxResults: args.maxResults as number } : {}),
    });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_assign_issue", "Assign or unassign a Jira issue", { type: "object", properties: { issueKey: { type: "string" }, assigneeAccountId: { type: "string" }, assigneeQuery: { type: "string" }, assigneeDisplayName: { type: "string" }, assigneeEmailAddress: { type: "string" }, unassign: { type: "boolean" } }, required: ["issueKey"] }, async (args) => {
    const result = await jiraService.assignIssue({
      issueKey: args.issueKey as string,
      ...(args.assigneeAccountId !== undefined ? { assigneeAccountId: args.assigneeAccountId as string } : {}),
      ...(args.assigneeQuery !== undefined ? { assigneeQuery: args.assigneeQuery as string } : {}),
      ...(args.assigneeDisplayName !== undefined ? { assigneeDisplayName: args.assigneeDisplayName as string } : {}),
      ...(args.assigneeEmailAddress !== undefined ? { assigneeEmailAddress: args.assigneeEmailAddress as string } : {}),
      ...(args.unassign !== undefined ? { unassign: args.unassign as boolean } : {}),
    });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });

  // GitHub tools
  toolHandlerRegistry.register("github_list_prs", "List pull requests for a GitHub repository", { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, state: { type: "string" } }, required: ["owner", "repo"] }, async (args) => {
    const result = await githubService.listPullRequests({ owner: args.owner as string, repo: args.repo as string, state: (args.state as "open" | "closed" | "all") ?? "open" });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("github_search_code", "Search for code across GitHub repositories", { type: "object", properties: { query: { type: "string" }, owner: { type: "string" }, repo: { type: "string" } }, required: ["query"] }, async (args) => {
    // searchCode accepts { query } only — embed owner/repo qualifiers into the query string
    let q = args.query as string;
    if (args.owner) q += ` org:${args.owner as string}`;
    if (args.repo && args.owner) q += ` repo:${args.owner as string}/${args.repo as string}`;
    const result = await githubService.searchCode({ query: q });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("github_get_pr_diff", "Get the files of a GitHub pull request", { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, prNumber: { type: "number" } }, required: ["owner", "repo", "prNumber"] }, async (args) => {
    const result = await githubService.getPullRequestFiles(args.owner as string, args.repo as string, args.prNumber as number);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("github_get_my_prs", "Get pull requests authored by the authenticated user", { type: "object", properties: {} }, async () => {
    const result = await githubService.getMyCreatedPRs();
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("github_create_pr", "Create a new GitHub pull request", { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, title: { type: "string" }, head: { type: "string" }, base: { type: "string" }, body: { type: "string" }, draft: { type: "boolean" } }, required: ["owner", "repo", "title", "head", "base"] }, async (args) => {
    const result = await githubService.createPullRequest({ owner: args.owner as string, repo: args.repo as string, title: args.title as string, head: args.head as string, base: args.base as string, body: (args.body as string) ?? "", draft: (args.draft as boolean) ?? false });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("github_submit_review", "Submit a review on a GitHub pull request", { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, prNumber: { type: "number" }, body: { type: "string" }, event: { type: "string", enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"] }, connectionName: { type: "string", description: "Optional: name of the GitHub connection to submit as" } }, required: ["owner", "repo", "prNumber", "body", "event"] }, async (args) => {
    const reviewParams = { owner: args.owner as string, repo: args.repo as string, prNumber: args.prNumber as number, body: args.body as string, event: args.event as "APPROVE" | "REQUEST_CHANGES" | "COMMENT" };
    const result = args.connectionName
      ? await githubService.reviewPullRequestAs(reviewParams, args.connectionName as string)
      : await githubService.reviewPullRequest(reviewParams);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_add_comment", "Add a comment to a Jira issue", { type: "object", properties: { issueKey: { type: "string" }, body: { type: "string" }, bodyMarkdown: { type: "string" }, bodyAdf: { type: "object" }, mentions: { type: "array", items: { type: "object" } } }, required: ["issueKey"] }, async (args) => {
    const result = await jiraService.addComment({
      issueKey: args.issueKey as string,
      ...(args.body !== undefined ? { body: args.body as string } : {}),
      ...(args.bodyMarkdown !== undefined ? { bodyMarkdown: args.bodyMarkdown as string } : {}),
      ...(args.bodyAdf !== undefined ? { bodyAdf: args.bodyAdf as import("@shared/schemas/jira.schema").JiraAdfDocument } : {}),
      ...(args.mentions !== undefined ? { mentions: args.mentions as import("@shared/schemas/jira.schema").JiraMentionInput[] } : {}),
    });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_get_comments", "Get comments for a Jira issue", { type: "object", properties: { issueKey: { type: "string" } }, required: ["issueKey"] }, async (args) => {
    const result = await jiraService.getIssueComments(args.issueKey as string);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_update_issue_description", "Update the description of a Jira issue", { type: "object", properties: { issueKey: { type: "string" }, description: { type: "string" }, descriptionMarkdown: { type: "string" }, descriptionAdf: { type: "object" } }, required: ["issueKey"] }, async (args) => {
    const result = await jiraService.updateIssueDescription(args.issueKey as string, {
      ...(args.description !== undefined ? { description: args.description as string } : {}),
      ...(args.descriptionMarkdown !== undefined ? { descriptionMarkdown: args.descriptionMarkdown as string } : {}),
      ...(args.descriptionAdf !== undefined ? { descriptionAdf: args.descriptionAdf as import("@shared/schemas/jira.schema").JiraAdfDocument } : {}),
    });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("jira_update_issue", "Update editable fields on a Jira issue", { type: "object", properties: { issueKey: { type: "string" }, summary: { type: "string" }, description: { type: "string" }, descriptionMarkdown: { type: "string" }, descriptionAdf: { type: "object" }, labels: { type: "array", items: { type: "string" } }, priority: { type: "string" }, assigneeAccountId: { type: ["string", "null"] }, dueDate: { type: ["string", "null"] } }, required: ["issueKey"] }, async (args) => {
    const result = await jiraService.updateIssue({
      issueKey: args.issueKey as string,
      ...(args.summary !== undefined ? { summary: args.summary as string } : {}),
      ...(args.description !== undefined ? { description: args.description as string } : {}),
      ...(args.descriptionMarkdown !== undefined ? { descriptionMarkdown: args.descriptionMarkdown as string } : {}),
      ...(args.descriptionAdf !== undefined ? { descriptionAdf: args.descriptionAdf as import("@shared/schemas/jira.schema").JiraAdfDocument } : {}),
      ...(args.labels !== undefined ? { labels: args.labels as string[] } : {}),
      ...(args.priority !== undefined ? { priority: args.priority as string } : {}),
      ...(args.assigneeAccountId !== undefined ? { assigneeAccountId: args.assigneeAccountId as string | null } : {}),
      ...(args.dueDate !== undefined ? { dueDate: args.dueDate as string | null } : {}),
    });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });

  // System tools
  toolHandlerRegistry.register("system_health_check", "Check server health status", { type: "object", properties: {} }, async () => {
    return { content: [{ type: "text" as const, text: JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }) }] };
  });
  toolHandlerRegistry.register("system_list_connections", "List all configured connections", { type: "object", properties: {} }, async () => {
    const result = await connectionManager.getAllConnections();
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });

  // Database tools
  toolHandlerRegistry.register("db_list_schemas", "List database schemas", { type: "object", properties: { connectionId: { type: "string" } }, required: ["connectionId"] }, async (args) => {
    const result = await databaseQueryService.listSchemas(args.connectionId as string);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("db_list_tables", "List tables in a database schema", { type: "object", properties: { connectionId: { type: "string" }, schema: { type: "string" } }, required: ["connectionId", "schema"] }, async (args) => {
    const result = await databaseQueryService.listTables(args.connectionId as string, args.schema as string);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("db_describe_table", "Describe a database table structure", { type: "object", properties: { connectionId: { type: "string" }, schema: { type: "string" }, table: { type: "string" } }, required: ["connectionId", "schema", "table"] }, async (args) => {
    const result = await databaseQueryService.describeTable(args.connectionId as string, args.schema as string, args.table as string);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("db_query", "Execute a SQL query", { type: "object", properties: { connectionId: { type: "string" }, sql: { type: "string" }, maxRows: { type: "number" } }, required: ["connectionId", "sql"] }, async (args) => {
    const result = await databaseQueryService.query(args.connectionId as string, args.sql as string, [], (args.maxRows as number) ?? 100, 30000);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });

  // Confluence tools
  toolHandlerRegistry.register("confluence_search_pages", "Search Confluence pages using CQL", { type: "object", properties: { cql: { type: "string" }, maxResults: { type: "number" } }, required: ["cql"] }, async (args) => {
    const result = await confluenceService.searchPages(args.cql as string, (args.maxResults as number) ?? 10);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("confluence_get_page", "Get a Confluence page by ID", { type: "object", properties: { pageId: { type: "string" } }, required: ["pageId"] }, async (args) => {
    const result = await confluenceService.getPage(args.pageId as string);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("confluence_list_spaces", "List Confluence spaces", { type: "object", properties: { type: { type: "string" }, maxResults: { type: "number" } } }, async (args) => {
    const result = await confluenceService.listSpaces((args.type as "global" | "personal" | "all") ?? "all", (args.maxResults as number) ?? 50);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("confluence_create_page", "Create a Confluence page", { type: "object", properties: { spaceKey: { type: "string" }, title: { type: "string" }, body: { type: "object" }, parentId: { type: "string" } }, required: ["spaceKey", "title", "body"] }, async (args) => {
    const parentId = args.parentId as string | undefined;
    const result = await confluenceService.createPage({
      spaceKey: args.spaceKey as string,
      title: args.title as string,
      body: args.body as import("@shared/schemas/confluence.schema.js").ConfluenceAdfDocument,
      ...(parentId !== undefined ? { parentId } : {}),
    });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("confluence_update_page", "Update a Confluence page", { type: "object", properties: { pageId: { type: "string" }, title: { type: "string" }, body: { type: "object" }, versionNumber: { type: "number" } }, required: ["pageId"] }, async (args) => {
    const title = args.title as string | undefined;
    const body = args.body as import("@shared/schemas/confluence.schema.js").ConfluenceAdfDocument | undefined;
    const versionNumber = args.versionNumber as number | undefined;
    const result = await confluenceService.updatePage({
      pageId: args.pageId as string,
      ...(title !== undefined ? { title } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(versionNumber !== undefined ? { versionNumber } : {}),
    });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("confluence_delete_page", "Delete a Confluence page", { type: "object", properties: { pageId: { type: "string" } }, required: ["pageId"] }, async (args) => {
    const result = await confluenceService.deletePage({ pageId: args.pageId as string });
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });

  // Local filesystem tools
  toolHandlerRegistry.register("fs_list_folders", "List registered folder access entries", { type: "object", properties: {} }, async () => {
    const folders = await folderAccessRepo.findAll();
    return { content: [{ type: "text" as const, text: JSON.stringify(folders, null, 2) }] };
  });
  toolHandlerRegistry.register("fs_list_workspaces", "List registered workspaces", { type: "object", properties: {} }, async () => {
    const workspaces = await workspacesRepo.findAll();
    return { content: [{ type: "text" as const, text: JSON.stringify(workspaces, null, 2) }] };
  });
  toolHandlerRegistry.register("fs_list_directory", "List directory contents", { type: "object", properties: { folderId: { type: "string" }, relativePath: { type: "string" } }, required: ["folderId"] }, async (args) => {
    const result = await localFilesystemService.listDirectory(args.folderId as string, (args.relativePath as string) ?? ".", 1);
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: JSON.stringify(result.value, null, 2) }] };
  });
  toolHandlerRegistry.register("fs_read_file", "Read file contents", { type: "object", properties: { folderId: { type: "string" }, relativePath: { type: "string" } }, required: ["folderId", "relativePath"] }, async (args) => {
    const result = await localFilesystemService.readFile(args.folderId as string, args.relativePath as string, "utf-8");
    if (result._tag === "Err") return { content: [{ type: "text" as const, text: `Error: ${errText(result.error)}` }], isError: true };
    return { content: [{ type: "text" as const, text: typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2) }] };
  });

  logger.info(
    { registeredHandlers: toolHandlerRegistry.list().length },
    "Tool handler registry populated for agent engine"
  );

  // Create tool executor
  const toolExecutor = createToolExecutor({ registry: toolHandlerRegistry, logger });

  // Anthropic API key resolver — checks env var first, then stored Anthropic credentials.
  const getAnthropicApiKey = async (): Promise<string | null> => {
    if (config.ANTHROPIC_API_KEY) return config.ANTHROPIC_API_KEY;
    // Check for an Anthropic-backed connection in the DB.
    const allConns = await connectionsRepo.findAll();
    const anthropicConn = allConns.find((c) =>
      isAnthropicConnectionCandidate(c.name)
    );
    if (!anthropicConn) return null;
    const cred = await credentialsRepo.findByConnectionId(anthropicConn.id);
    if (!cred) return null;
    try {
      return encryptionService.decrypt(cred.encryptedData, cred.iv);
    } catch {
      return null;
    }
  };

  // Create observation summarizer
  const observationSummarizer = createObservationSummarizer({
    logger,
    getClient: async () => {
      const key = await getAnthropicApiKey();
      if (!key) return null;
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      return new Anthropic({ apiKey: key });
    },
    model: "claude-sonnet-4-20250514",
    threshold: 4000,
  });

  // Create task planner
  const taskPlanner = createTaskPlanner({
    logger,
    getClient: async () => {
      const key = await getAnthropicApiKey();
      if (!key) return null;
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      return new Anthropic({ apiKey: key });
    },
    model: "claude-sonnet-4-20250514",
  });

  // Create delegation handler
  const delegationHandler = createDelegationHandler({
    logger,
    maxDelegationDepth: 3,
  });

  // Create the execution engine
  const executionEngine = createExecutionEngine({
    logger,
    getAnthropicApiKey,
    agentRegistry,
    connectionManager: {
      hasConnection: (integration: string) => {
        // Synchronous check based on tool availability in the handler registry
        return toolHandlerRegistry.list().some((t) => t.startsWith(integration.replace("-", "_")));
      },
      hasTool: (toolName: string) => toolHandlerRegistry.has(toolName),
    },
    toolExecutor,
    observationSummarizer,
    taskPlanner,
    delegationHandler,
    agentRunsRepo,
    agentRunStepsRepo,
    agentTasksRepo,
  });

  // Wire delegation handler back to engine (circular dependency resolution)
  delegationHandler.setExecuteFn(executionEngine.execute);

  // Register agent execution MCP tools
  const agentToolDeps = { executionEngine, logger };
  registerAgentExecuteTool(mcpServer, agentToolDeps);
  registerAgentStatusTool(mcpServer, agentToolDeps);
  registerAgentListTool(mcpServer, {
    agentRegistry,
    connectionManager: {
      hasConnection: (integration: string) =>
        toolHandlerRegistry.list().some((t) => t.startsWith(integration.replace("-", "_"))),
      hasTool: (toolName: string) => toolHandlerRegistry.has(toolName),
    },
    logger,
  });

  // Register client-driven agent execution tools
  // These let a connected MCP client such as Claude Code or Codex act as the reasoning layer
  registerAgentStartRunTool(mcpServer, {
    agentRegistry,
    agentRunsRepo,
    agentTasksRepo,
    logger,
  });
  registerAgentRecordStepTool(mcpServer, {
    agentRunStepsRepo,
    logger,
  });
  registerAgentUpdateTaskTool(mcpServer, {
    agentTasksRepo,
    logger,
  });
  registerAgentCompleteRunTool(mcpServer, {
    agentRunsRepo,
    agentRunStepsRepo,
    logger,
  });

  console.error("[startup] Agent execution engine initialized");
  logger.info("Agent execution engine ready");

  // Register resources and prompts
  const resourceDeps = {
    connectionsRepo,
    agentRegistry,
    agentConfigsRepo,
    logger,
  };

  registerResources(mcpServer, resourceDeps);
  registerPrompts(mcpServer, resourceDeps);

  // Create HTTP app with middleware
  const httpApp = new Hono();

  // Apply global middleware
  httpApp.use(loggingMiddleware(logger));
  httpApp.use(createRateLimiter({ windowMs: 60_000, maxRequests: 100 }));
  httpApp.use(errorHandlerMiddleware(logger));

  // Health check
  httpApp.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "0.1.0",
    });
  });

  // Connections API
  httpApp.get("/api/connections", async (c) => {
    const result = await connectionManager.getAllConnections();
    if (isErr(result)) {
      throw result.error;
    }
    return c.json(result.value);
  });

  httpApp.post("/api/connections", async (c) => {
    const body = await c.req.json();
    const result = await connectionManager.createConnection({
      name: body.name,
      integrationType: body.integrationType,
      baseUrl: body.baseUrl,
      authMethod: body.authMethod,
    });
    if (isErr(result)) {
      throw result.error;
    }
    return c.json(result.value, { status: 201 });
  });

  // Credentials sub-routes MUST be registered before /api/connections/:id
  // to avoid the wildcard :id from swallowing "credentials" as an id value
  httpApp.post("/api/connections/:id/credentials", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const token = body.token || body.accessToken;
    if (!token || typeof token !== "string") {
      return c.json({ error: "token is required" }, { status: 400 });
    }
    const result = await connectionManager.storeCredentials(id, token);
    if (isErr(result)) {
      throw result.error;
    }
    // After storing credentials, mark connection as connected
    const updateResult = await connectionManager.updateConnection(id, { status: "connected" });
    if (isErr(updateResult)) {
      throw updateResult.error;
    }
    return c.json({ success: true, status: "connected" });
  });

  httpApp.get("/api/connections/:id/credentials/status", async (c) => {
    const id = c.req.param("id");
    const result = await connectionManager.getDecryptedCredentials(id);
    if (isErr(result)) {
      return c.json({ hasCredentials: false });
    }
    return c.json({ hasCredentials: true });
  });

  httpApp.delete("/api/connections/:id/credentials", async (c) => {
    const id = c.req.param("id");
    try {
      const existing = await credentialsRepo.findByConnectionId(id);
      if (existing) {
        await credentialsRepo.deleteByConnectionId(id);
      }
      await connectionManager.updateConnection(id, { status: "disconnected" });
    } catch (error) {
      logger.error({ error, id }, "Failed to remove credentials");
    }
    return c.json({ success: true });
  });

  httpApp.post("/api/connections/:id/test", async (c) => {
    const id = c.req.param("id");
    const result = await connectionManager.testConnection(id);
    if (isErr(result)) {
      throw result.error;
    }
    return c.json(result.value);
  });

  // Generic connection CRUD routes (after specific sub-routes)
  httpApp.get("/api/connections/:id", async (c) => {
    const id = c.req.param("id");
    const result = await connectionManager.getConnection(id);
    if (isErr(result)) {
      throw result.error;
    }
    return c.json(result.value);
  });

  httpApp.put("/api/connections/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const result = await connectionManager.updateConnection(id, {
      name: body.name,
      baseUrl: body.baseUrl,
      status: body.status,
    });
    if (isErr(result)) {
      throw result.error;
    }
    return c.json(result.value);
  });

  httpApp.delete("/api/connections/:id", async (c) => {
    const id = c.req.param("id");
    const result = await connectionManager.deleteConnection(id);
    if (isErr(result)) {
      throw result.error;
    }
    return c.json({ success: true });
  });

  // Helper to convert agent definition to JSON-safe object
  // Strips Zod schema instances (which contain circular refs and methods)
  function serializeAgent(agent: ReturnType<typeof agentRegistry.getAll>[number]) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { configSchema, ...rest } = agent;
    return rest;
  }

  // Agents API
  // Specific named routes FIRST, then wildcard :id routes
  httpApp.get("/api/agents", (_c) => {
    const agents = agentRegistry.getAll();
    return _c.json(agents.map(serializeAgent));
  });

  // ── Agent Execution API ──────────────────────────────────────────────
  // Uses /api/agent-runs (NOT /api/agents/runs) to avoid Hono route
  // conflict with the /api/agents/:id wildcard route below.

  // GET /api/agent-runs/stats — aggregate execution stats for dashboard
  httpApp.get("/api/agent-runs/stats", async (c) => {
    const allRuns = await agentRunsRepo.findRecent(10000);
    const totalRuns = allRuns.length;
    const activeRuns = allRuns.filter(
      (r) => r.status === "planning" || r.status === "executing"
    ).length;
    const completedRuns = allRuns.filter((r) => r.status === "completed").length;
    const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
    const totalTokens = allRuns.reduce(
      (sum, r) => sum + r.inputTokensUsed + r.outputTokensUsed,
      0
    );

    const completedWithTime = allRuns.filter(
      (r) => r.status === "completed" && r.startedAt && r.completedAt
    );
    const avgDurationMs =
      completedWithTime.length > 0
        ? Math.round(
            completedWithTime.reduce((sum, r) => {
              const start = new Date(r.startedAt).getTime();
              const end = new Date(r.completedAt!).getTime();
              return sum + (end - start);
            }, 0) / completedWithTime.length
          )
        : 0;

    // Per-agent usage stats
    const agentMap = new Map<
      string,
      {
        agentId: string;
        totalRuns: number;
        completed: number;
        totalTokens: number;
        totalDurationMs: number;
        completedWithTime: number;
        lastRunAt: string;
      }
    >();
    for (const run of allRuns) {
      const entry = agentMap.get(run.agentId) ?? {
        agentId: run.agentId,
        totalRuns: 0,
        completed: 0,
        totalTokens: 0,
        totalDurationMs: 0,
        completedWithTime: 0,
        lastRunAt: run.createdAt,
      };
      entry.totalRuns++;
      entry.totalTokens += run.inputTokensUsed + run.outputTokensUsed;
      if (run.status === "completed") entry.completed++;
      if (run.status === "completed" && run.startedAt && run.completedAt) {
        entry.completedWithTime++;
        entry.totalDurationMs +=
          new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
      }
      if (run.createdAt > entry.lastRunAt) entry.lastRunAt = run.createdAt;
      agentMap.set(run.agentId, entry);
    }

    const agentUsage = Array.from(agentMap.values()).map((a) => ({
      agentId: a.agentId,
      agentName: agentRegistry.getById(a.agentId as import("@shared/types").AgentId)?.name ?? a.agentId,
      totalRuns: a.totalRuns,
      successRate: a.totalRuns > 0 ? Math.round((a.completed / a.totalRuns) * 100) : 0,
      avgDurationMs: a.completedWithTime > 0 ? Math.round(a.totalDurationMs / a.completedWithTime) : 0,
      avgTokensPerRun: a.totalRuns > 0 ? Math.round(a.totalTokens / a.totalRuns) : 0,
      lastRunAt: a.lastRunAt,
    }));

    return c.json({
      totalRuns,
      activeRuns,
      successRate,
      avgDurationMs,
      totalTokens,
      agentUsage,
    });
  });

  // GET /api/agent-runs/task-progress — orchestrator runs with their task breakdowns
  httpApp.get("/api/agent-runs/task-progress", async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    const statusFilter = c.req.query("status"); // optional: active | completed | all

    const allRuns = await agentRunsRepo.findRecent(limit * 2);

    // Filter to top-level (non-delegated) runs only
    let topLevelRuns = allRuns.filter((r) => !r.parentRunId);

    if (statusFilter === "active") {
      topLevelRuns = topLevelRuns.filter(
        (r) => r.status === "planning" || r.status === "executing"
      );
    } else if (statusFilter === "completed") {
      topLevelRuns = topLevelRuns.filter(
        (r) => r.status === "completed" || r.status === "failed" || r.status === "cancelled"
      );
    }

    topLevelRuns = topLevelRuns.slice(0, limit);

    // Fetch tasks for each run in parallel
    const runsWithTasks = await Promise.all(
      topLevelRuns.map(async (run) => {
        const tasks = await agentTasksRepo.findByRunId(run.id);
        const agentDef = agentRegistry.getById(run.agentId as import("@shared/types").AgentId);

        // Count child (delegated) runs
        const childRuns = allRuns.filter((r) => r.parentRunId === run.id);

        return {
          id: run.id,
          agentId: run.agentId,
          agentName: agentDef?.name ?? run.agentId,
          goal: run.goal,
          status: run.status,
          iterationCount: run.iterationCount,
          toolCallCount: run.toolCallCount,
          inputTokensUsed: run.inputTokensUsed,
          outputTokensUsed: run.outputTokensUsed,
          startedAt: run.startedAt,
          completedAt: run.completedAt ?? null,
          errorMessage: run.errorMessage ?? null,
          tasks: tasks.map((t) => ({
            id: t.id,
            description: t.description,
            status: t.status,
            dependsOn: t.dependsOn,
            requiredTools: t.requiredTools,
            startedAt: t.startedAt ?? null,
            completedAt: t.completedAt ?? null,
          })),
          delegatedRuns: childRuns.map((cr) => ({
            id: cr.id,
            agentId: cr.agentId,
            agentName: agentRegistry.getById(cr.agentId as import("@shared/types").AgentId)?.name ?? cr.agentId,
            goal: cr.goal,
            status: cr.status,
            startedAt: cr.startedAt,
            completedAt: cr.completedAt ?? null,
          })),
        };
      })
    );

    return c.json(runsWithTasks);
  });

  // POST /api/agent-runs/execute — start an agent execution
  httpApp.post("/api/agent-runs/execute", async (c) => {
    const body = await c.req.json();
    const { agentId, goal, config: configOverrides } = body;
    if (!agentId || !goal) {
      return c.json({ error: "agentId and goal are required" }, { status: 400 });
    }
    const { createAgentId: makeId } = await import("@shared/types.js");
    const result = await executionEngine.execute({
      agentId: makeId(agentId),
      goal,
      config: configOverrides,
    });
    if (isErr(result)) {
      return c.json({ error: domainErrorMessage(result.error) }, { status: 500 });
    }
    return c.json(result.value, { status: 200 });
  });

  // GET /api/agent-runs — list recent agent runs
  httpApp.get("/api/agent-runs", async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    const runs = await agentRunsRepo.findRecent(limit);
    return c.json(runs);
  });

  // GET /api/agent-runs/:id/tasks — planned tasks for a run
  httpApp.get("/api/agent-runs/:id/tasks", async (c) => {
    const runId = c.req.param("id");
    const tasks = await agentTasksRepo.findByRunId(runId);
    return c.json(tasks);
  });

  // GET /api/agent-runs/:id/steps — paginated steps for a run
  httpApp.get("/api/agent-runs/:id/steps", async (c) => {
    const runId = c.req.param("id");
    const offset = Number(c.req.query("offset") ?? "0");
    const limit = Number(c.req.query("limit") ?? "100");
    const result = await agentRunStepsRepo.findByRunId(runId, { offset, limit });
    return c.json(result);
  });

  // GET /api/agent-runs/:id/delegation-tree — recursive delegation hierarchy
  httpApp.get("/api/agent-runs/:id/delegation-tree", async (c) => {
    const runId = c.req.param("id");

    type DelegationNode = {
      run: {
        id: string;
        agentId: string;
        goal: string;
        status: string;
        startedAt: string;
        completedAt: string | null;
      };
      children: DelegationNode[];
    };

    async function buildTree(id: string): Promise<DelegationNode | null> {
      const run = await agentRunsRepo.findById(id);
      if (!run) return null;

      // Find children by parentRunId
      const allRuns = await agentRunsRepo.findRecent(1000);
      const children = allRuns.filter((r) => r.parentRunId === id);

      const childNodes: DelegationNode[] = [];
      for (const child of children) {
        const childNode = await buildTree(child.id);
        if (childNode) childNodes.push(childNode);
      }

      return {
        run: {
          id: run.id,
          agentId: run.agentId,
          goal: run.goal,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt ?? null,
        },
        children: childNodes,
      };
    }

    const tree = await buildTree(runId);
    if (!tree) {
      return c.json({ error: "Run not found" }, { status: 404 });
    }
    return c.json(tree);
  });

  // GET /api/agent-runs/:id — get a specific run's status
  httpApp.get("/api/agent-runs/:id", async (c) => {
    const runId = c.req.param("id");
    const { createAgentRunId: makeRunId } = await import("@shared/types.js");
    const result = await executionEngine.getRunStatus(makeRunId(runId));
    if (isErr(result)) {
      return c.json({ error: domainErrorMessage(result.error) }, { status: 404 });
    }
    return c.json(result.value);
  });

  // POST /api/agent-runs/:id/cancel — cancel a running agent
  httpApp.post("/api/agent-runs/:id/cancel", async (c) => {
    const runId = c.req.param("id");
    const { createAgentRunId: makeRunId } = await import("@shared/types.js");
    const result = await executionEngine.cancelRun(makeRunId(runId));
    if (isErr(result)) {
      return c.json({ error: domainErrorMessage(result.error) }, { status: 404 });
    }
    return c.json({ success: true });
  });

  // ── Reviews API ──────────────────────────────────────────────────────

  // GET /api/reviews — list all reviews (most recent first)
  httpApp.get("/api/reviews", async (c) => {
    const limit = Number(c.req.query("limit") ?? "100");
    const reviews = await reviewsRepo.findAll(limit);
    return c.json(reviews);
  });

  // GET /api/reviews/stats — aggregate insights
  httpApp.get("/api/reviews/stats", async (c) => {
    const stats = await reviewsRepo.getStats();
    return c.json(stats);
  });

  // GET /api/reviews/in-progress — reviews currently being analyzed by the AI reviewer
  httpApp.get("/api/reviews/in-progress", async (c) => {
    const inProgress = await reviewsRepo.findInProgress();
    return c.json(inProgress);
  });

  // ── My PRs dashboard endpoints ──────────────────────────────────────

  // Get the authenticated GitHub user
  httpApp.get("/api/github/me", async (c) => {
    const result = await githubService.getAuthenticatedUser();
    if (isErr(result)) {
      return c.json({ error: domainErrorMessage(result.error) }, { status: 502 });
    }
    return c.json(result.value);
  });

  // PRs assigned to me
  httpApp.get("/api/github/me/assigned", async (c) => {
    const result = await githubService.getMyAssignedPRs();
    if (isErr(result)) {
      return c.json({ error: domainErrorMessage(result.error) }, { status: 502 });
    }
    return c.json(result.value);
  });

  // PRs where my review is requested
  httpApp.get("/api/github/me/review-requested", async (c) => {
    const result = await githubService.getMyReviewRequests();
    if (isErr(result)) {
      return c.json({ error: domainErrorMessage(result.error) }, { status: 502 });
    }
    return c.json(result.value);
  });

  // PRs I created
  httpApp.get("/api/github/me/created", async (c) => {
    const result = await githubService.getMyCreatedPRs();
    if (isErr(result)) {
      return c.json({ error: domainErrorMessage(result.error) }, { status: 502 });
    }
    return c.json(result.value);
  });

  // All my PRs in one combined response
  httpApp.get("/api/github/me/dashboard", async (c) => {
    const [assignedResult, reviewResult, createdResult, userResult] = await Promise.all([
      githubService.getMyAssignedPRs(),
      githubService.getMyReviewRequests(),
      githubService.getMyCreatedPRs(),
      githubService.getAuthenticatedUser(),
    ]);

    return c.json({
      user: isErr(userResult) ? null : userResult.value,
      assigned: isErr(assignedResult) ? [] : assignedResult.value,
      reviewRequested: isErr(reviewResult) ? [] : reviewResult.value,
      created: isErr(createdResult) ? [] : createdResult.value,
    });
  });

  // ── Google Calendar OAuth endpoints ───────────────────────────────────

  httpApp.get("/api/connections/google-calendar/oauth/start", async (c) => {
    if (!config.GOOGLE_OAUTH_CLIENT_ID || !config.GOOGLE_OAUTH_CLIENT_SECRET) {
      return c.json(
        { error: "Google OAuth client credentials not configured" },
        { status: 400 }
      );
    }

    // Generate a CSRF state nonce
    const nonce = randomBytes(32).toString("hex");
    const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes
    await oauthNoncesRepo.create(nonce, "google-calendar", NONCE_TTL_MS);

    // Clean up expired nonces periodically
    await oauthNoncesRepo.deleteExpired();

    const redirectUri = `http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}/api/connections/google-calendar/oauth/callback`;

    const scopes = [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/admin.directory.resource.calendar.readonly",
    ];

    const params = new URLSearchParams({
      client_id: config.GOOGLE_OAUTH_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      state: nonce,
      access_type: "offline",
      prompt: "consent",
    });

    const consentUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return c.json({ url: consentUrl });
  });

  httpApp.get("/api/connections/google-calendar/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");

    if (!code || !state) {
      return c.json({ error: "Missing code or state parameter" }, { status: 400 });
    }

    // Validate CSRF nonce
    const nonceRecord = await oauthNoncesRepo.findByNonce(state);
    if (!nonceRecord) {
      return c.json({ error: "Invalid or expired state nonce" }, { status: 400 });
    }

    // Delete consumed nonce
    await oauthNoncesRepo.deleteByNonce(state);

    if (!config.GOOGLE_OAUTH_CLIENT_ID || !config.GOOGLE_OAUTH_CLIENT_SECRET) {
      return c.json({ error: "Google OAuth client credentials not configured" }, { status: 500 });
    }

    const redirectUri = `http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}/api/connections/google-calendar/oauth/callback`;

    // Exchange code for tokens
    try {
      const tokenBody = new URLSearchParams({
        code,
        client_id: config.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: config.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      });

      if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text().catch(() => "");
        logger.error({ status: tokenResponse.status, body: errorBody.slice(0, 300) }, "Google OAuth token exchange failed");
        return c.json({ error: "Failed to exchange authorization code" }, { status: 502 });
      }

      const tokenData = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      if (!tokenData.access_token) {
        return c.json({ error: "No access token received from Google" }, { status: 502 });
      }

      const tokens: GoogleTokenBundle = {
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token ?? "",
        expiry: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      };

      // Find or create the Google Calendar connection
      const allConns = await connectionsRepo.findAll();
      let gcalConn = allConns.find((conn) => conn.integrationType === "google-calendar");

      if (!gcalConn) {
        gcalConn = await connectionsRepo.create({
          name: "Google Calendar",
          integrationType: "google-calendar",
          baseUrl: "https://www.googleapis.com/calendar/v3",
          authMethod: "oauth2",
          status: "connected",
        });
      } else {
        await connectionsRepo.update(gcalConn.id, { status: "connected" });
      }

      // Encrypt and store token bundle
      const tokenJson = JSON.stringify(tokens);
      const { encryptedData, iv } = encryptionService.encrypt(tokenJson);

      const existingCred = await credentialsRepo.findByConnectionId(gcalConn.id);
      if (existingCred) {
        await credentialsRepo.update(existingCred.id, { encryptedData, iv });
      } else {
        await credentialsRepo.create({ connectionId: gcalConn.id, encryptedData, iv });
      }

      logger.info("Google Calendar OAuth flow completed successfully");

      // Redirect to admin panel connections page
      return c.redirect(`http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}/connections`);
    } catch (error) {
      logger.error({ error }, "Google OAuth callback error");
      return c.json({ error: "OAuth callback processing failed" }, { status: 500 });
    }
  });

  // ── Confluence Settings ─────────────────────────────────────────────

  httpApp.get("/api/confluence/settings", async (c) => {
    const raw = await serverSettingsRepo.get("confluence.allowed_space_keys");
    let allowedSpaceKeys: string[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) allowedSpaceKeys = parsed as string[];
      } catch { /* empty */ }
    }
    return c.json({ allowedSpaceKeys });
  });

  httpApp.put("/api/confluence/settings", async (c) => {
    const body = await c.req.json();
    if (!body.allowedSpaceKeys || !Array.isArray(body.allowedSpaceKeys)) {
      return c.json({ error: "allowedSpaceKeys must be an array" }, { status: 400 });
    }
    if (body.allowedSpaceKeys.length > 50) {
      return c.json({ error: "Maximum 50 space keys allowed" }, { status: 400 });
    }
    const keys = (body.allowedSpaceKeys as string[]).map((k: string) =>
      String(k).toUpperCase().trim()
    ).filter((k: string) => k.length > 0);

    await serverSettingsRepo.upsert(
      "confluence.allowed_space_keys",
      JSON.stringify(keys)
    );

    return c.json({ allowedSpaceKeys: keys });
  });

  // ── Confluence Activity / Insights ──────────────────────────────────

  httpApp.get("/api/confluence/activity", async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    const activity = await confluenceActivityRepo.findRecent(limit);
    return c.json(activity);
  });

  httpApp.get("/api/confluence/insights", async (c) => {
    const stats = await confluenceActivityRepo.getStats();
    return c.json(stats);
  });

  // ── Database Connections ────────────────────────────────────────────

  // Create a database connection (MySQL or PostgreSQL)
  httpApp.post("/api/database-connections", async (c) => {
    const body = await c.req.json();

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json({ error: "name is required" }, { status: 400 });
    }
    if (!["mysql", "postgres"].includes(body.dialect)) {
      return c.json({ error: "dialect must be 'mysql' or 'postgres'" }, { status: 400 });
    }

    // Validate permissions if provided
    let permissions: import("@shared/schemas/database-connection.schema.js").DbPermissions = { allowedSchemas: [], allowWrites: false };
    if (body.permissions) {
      const parsed = DbPermissionsSchema.safeParse(body.permissions);
      if (!parsed.success) {
        return c.json({ error: "Invalid permissions schema", details: parsed.error.flatten() }, { status: 400 });
      }
      permissions = parsed.data;
    }

    const authMethod = body.authMethod || "username_password";
    if (!["username_password", "connection_string"].includes(authMethod)) {
      return c.json({ error: "authMethod must be 'username_password' or 'connection_string'" }, { status: 400 });
    }

    const result = await connectionManager.createConnection({
      name: body.name.trim(),
      integrationType: body.dialect,
      baseUrl: "",
      authMethod,
      databaseDialect: body.dialect,
      allowWrites: permissions.allowWrites ? 1 : 0,
      dbPermissions: JSON.stringify(permissions),
    });

    if (isErr(result)) {
      throw result.error;
    }
    return c.json(result.value, { status: 201 });
  });

  // Get all database connections
  httpApp.get("/api/database-connections", async (c) => {
    const result = await connectionManager.getAllConnections();
    if (isErr(result)) {
      throw result.error;
    }
    const dbConns = result.value.filter(
      (conn) => conn.integrationType === "mysql" || conn.integrationType === "postgres"
    );
    return c.json(dbConns);
  });

  // Update database connection permissions
  httpApp.patch("/api/database-connections/:id/permissions", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();

    const conn = await connectionsRepo.findById(id);
    if (!conn) {
      return c.json({ error: "Connection not found" }, { status: 404 });
    }
    if (conn.integrationType !== "mysql" && conn.integrationType !== "postgres") {
      return c.json({ error: "Not a database connection" }, { status: 400 });
    }

    const parsed = DbPermissionsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Invalid permissions", details: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await connectionsRepo.update(id, {
      allowWrites: parsed.data.allowWrites ? 1 : 0,
      dbPermissions: JSON.stringify(parsed.data),
    });

    if (!updated) {
      return c.json({ error: "Connection not found" }, { status: 404 });
    }
    return c.json(updated);
  });

  // Store database credentials
  httpApp.post("/api/database-connections/:id/credentials", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();

    const conn = await connectionsRepo.findById(id);
    if (!conn) {
      return c.json({ error: "Connection not found" }, { status: 404 });
    }
    if (conn.integrationType !== "mysql" && conn.integrationType !== "postgres") {
      return c.json({ error: "Not a database connection" }, { status: 400 });
    }

    const credResult = DbCredentialsSchema.safeParse(body);
    if (!credResult.success) {
      return c.json({ error: "Invalid credentials", details: credResult.error.flatten() }, { status: 400 });
    }

    const storeResult = await connectionManager.storeCredentials(id, JSON.stringify(credResult.data));
    if (isErr(storeResult)) {
      throw storeResult.error;
    }
    await connectionManager.updateConnection(id, { status: "disconnected" });
    return c.body(null, 204);
  });

  // Test a database connection
  httpApp.post("/api/database-connections/:id/test", async (c) => {
    const id = c.req.param("id");

    const testResult = await databaseQueryService.testConnection(id);
    if (isErr(testResult)) {
      // Update status to error
      await connectionManager.updateConnection(id, { status: "error" });
      return c.json({ status: "error", error: domainErrorMessage(testResult.error) }, { status: 503 });
    }

    await connectionManager.updateConnection(id, { status: "connected" });
    return c.json({ status: "connected", dialect: testResult.value.dialect, latency_ms: testResult.value.latencyMs });
  });

  // ── Database Query Insights ───────────────────────────────────────

  httpApp.get("/api/database-insights/activity", async (c) => {
    const limit = Number(c.req.query("limit") ?? "50");
    const connectionId = c.req.query("connection_id");
    if (connectionId) {
      const activity = await dbQueryActivityRepo.findByConnectionId(connectionId, limit);
      return c.json(activity);
    }
    const activity = await dbQueryActivityRepo.findRecent(limit);
    return c.json(activity);
  });

  httpApp.get("/api/database-insights/stats", async (c) => {
    const stats = await dbQueryActivityRepo.getStats();
    return c.json(stats);
  });

  // ── Folder Access CRUD ──────────────────────────────────────────────

  httpApp.get("/api/folder-access", async (c) => {
    const folders = await folderAccessRepo.findAll();
    return c.json(folders);
  });

  httpApp.post("/api/folder-access", async (c) => {
    const body = await c.req.json();

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json({ error: "name is required" }, { status: 400 });
    }
    if (!body.absolutePath || typeof body.absolutePath !== "string" || !body.absolutePath.startsWith("/")) {
      return c.json({ error: "absolutePath must be an absolute path starting with /" }, { status: 400 });
    }

    const { resolve } = await import("node:path");
    const canonicalPath = resolve(body.absolutePath);

    // Check for duplicate path
    const existing = await folderAccessRepo.findByPath(canonicalPath);
    if (existing) {
      return c.json({ error: "A folder with this path is already registered" }, { status: 409 });
    }

    // Check if path exists on disk
    let status: "active" | "path_not_found" = "active";
    try {
      const { access: fsAccess } = await import("node:fs/promises");
      const { constants: fsConstants } = await import("node:fs");
      await fsAccess(canonicalPath, fsConstants.R_OK);
    } catch {
      status = "path_not_found";
    }

    const created = await folderAccessRepo.create({
      name: body.name.trim(),
      absolutePath: canonicalPath,
      allowedExtensions: JSON.stringify(body.allowedExtensions ?? []),
      maxFileSizeKb: body.maxFileSizeKb ?? 512,
      recursive: body.recursive === false ? 0 : 1,
      status,
    });

    return c.json(created, { status: 201 });
  });

  httpApp.patch("/api/folder-access/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();

    const existing = await folderAccessRepo.findById(id);
    if (!existing) {
      return c.json({ error: "Folder access not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.allowedExtensions !== undefined) updateData.allowedExtensions = JSON.stringify(body.allowedExtensions);
    if (body.maxFileSizeKb !== undefined) updateData.maxFileSizeKb = body.maxFileSizeKb;
    if (body.recursive !== undefined) updateData.recursive = body.recursive ? 1 : 0;
    if (body.status !== undefined) updateData.status = body.status;

    const updated = await folderAccessRepo.update(id, updateData);
    if (!updated) {
      return c.json({ error: "Folder access not found" }, { status: 404 });
    }
    return c.json(updated);
  });

  httpApp.delete("/api/folder-access/:id", async (c) => {
    const id = c.req.param("id");

    const existing = await folderAccessRepo.findById(id);
    if (!existing) {
      return c.json({ error: "Folder access not found" }, { status: 404 });
    }

    // Remove folder from all workspaces; auto-delete workspaces that drop below 2
    const removedWorkspaceIds = await workspacesRepo.removeFolderIdFromAll(id);

    await folderAccessRepo.delete(id);

    if (removedWorkspaceIds.length > 0) {
      c.header("X-Workspace-Removed", removedWorkspaceIds.join(","));
    }
    return c.body(null, 204);
  });

  httpApp.post("/api/folder-access/:id/verify", async (c) => {
    const id = c.req.param("id");
    const result = await localFilesystemService.verifyPath(id);
    if (isErr(result)) {
      return c.json({ error: domainErrorMessage(result.error) }, { status: 404 });
    }
    return c.json(result.value);
  });

  // ── Repo Workspaces CRUD ───────────────────────────────────────────

  httpApp.get("/api/repo-workspaces", async (c) => {
    const workspaces = await workspacesRepo.findAll();
    return c.json(workspaces);
  });

  httpApp.post("/api/repo-workspaces", async (c) => {
    const body = await c.req.json();

    if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
      return c.json({ error: "name is required" }, { status: 400 });
    }
    if (!Array.isArray(body.folderIds) || body.folderIds.length < 2) {
      return c.json({ error: "folderIds must contain at least 2 folder access IDs" }, { status: 400 });
    }

    // Check duplicate name
    const existingName = await workspacesRepo.findByName(body.name.trim());
    if (existingName) {
      return c.json({ error: "A workspace with this name already exists" }, { status: 409 });
    }

    // Validate all folder IDs exist
    for (const folderId of body.folderIds) {
      const folder = await folderAccessRepo.findById(folderId);
      if (!folder) {
        return c.json({ error: `Folder access ${folderId} not found` }, { status: 400 });
      }
    }

    const created = await workspacesRepo.create({
      name: body.name.trim(),
      description: body.description ?? "",
      folderIds: JSON.stringify(body.folderIds),
    });

    return c.json(created, { status: 201 });
  });

  httpApp.patch("/api/repo-workspaces/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();

    const existing = await workspacesRepo.findById(id);
    if (!existing) {
      return c.json({ error: "Workspace not found" }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.folderIds !== undefined) {
      if (!Array.isArray(body.folderIds) || body.folderIds.length < 2) {
        return c.json({ error: "folderIds must contain at least 2 folder access IDs" }, { status: 400 });
      }
      updateData.folderIds = JSON.stringify(body.folderIds);
    }

    const updated = await workspacesRepo.update(id, updateData);
    if (!updated) {
      return c.json({ error: "Workspace not found" }, { status: 404 });
    }
    return c.json(updated);
  });

  httpApp.delete("/api/repo-workspaces/:id", async (c) => {
    const id = c.req.param("id");
    const existing = await workspacesRepo.findById(id);
    if (!existing) {
      return c.json({ error: "Workspace not found" }, { status: 404 });
    }
    await workspacesRepo.delete(id);
    return c.body(null, 204);
  });

  // Generic agent routes (wildcard :id — MUST come after named routes above)
  httpApp.get("/api/agents/:id/config", async (c) => {
    const id = c.req.param("id");
    const agentConfig = await agentConfigsRepo.findByAgentId(id);
    if (!agentConfig) {
      return c.json({
        agentId: id,
        enabled: true,
        parameterOverrides: {},
        linkedConnectionIds: [],
      });
    }
    return c.json(agentConfig);
  });

  httpApp.put("/api/agents/:id/config", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const updated = await agentConfigsRepo.upsert(id, {
      enabled: body.enabled ?? true,
      parameterOverrides: body.parameterOverrides ?? {},
      linkedConnectionIds: body.linkedConnectionIds ?? [],
    });
    return c.json(updated);
  });

  httpApp.get("/api/agents/:id", (c) => {
    const id = c.req.param("id");
    const agent = agentRegistry.getById(id as any);
    if (!agent) {
      throw {
        _tag: "NotFoundError" as const,
        resource: "Agent",
        id,
      };
    }
    return c.json(serializeAgent(agent));
  });

  // Server settings API
  httpApp.get("/api/settings", async (c) => {
    const settings = await serverSettingsRepo.getAll();
    return c.json(settings);
  });

  httpApp.put("/api/settings", async (c) => {
    const body = await c.req.json();
    const setting = await serverSettingsRepo.set(body.key, body.value);
    return c.json(setting);
  });

  // Auto-create dedicated local MCP client placeholders for Claude and Codex.
  try {
    const existingConnections = await connectionsRepo.findAll();
    const legacyLocalConnection = existingConnections.find(
      (connection) =>
        connection.name === DEFAULT_LOCAL_MCP_CLIENT_CONNECTION_NAME
    );
    const missingDedicatedLocalConnections =
      getMissingDedicatedLocalMcpClientConnectionNames(existingConnections);

    if (
      legacyLocalConnection &&
      missingDedicatedLocalConnections.length > 0
    ) {
      const [replacementName, ...remainingNames] =
        missingDedicatedLocalConnections;

      if (replacementName) {
        await connectionsRepo.update(legacyLocalConnection.id, {
          name: replacementName,
        });
      }

      for (const connectionName of remainingNames) {
        await connectionsRepo.create({
          name: connectionName,
          integrationType: "github", // placeholder — represents local MCP client presence
          baseUrl: `http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}`,
          authMethod: "api_token",
          status: "connected",
        });
      }

      logger.info(
        { migratedFrom: DEFAULT_LOCAL_MCP_CLIENT_CONNECTION_NAME },
        "Migrated legacy local MCP client placeholder to dedicated client rows"
      );
    } else if (missingDedicatedLocalConnections.length > 0) {
      for (const connectionName of missingDedicatedLocalConnections) {
        await connectionsRepo.create({
          name: connectionName,
          integrationType: "github", // placeholder — represents local MCP client presence
          baseUrl: `http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}`,
          authMethod: "api_token",
          status: "connected",
        });
      }
      logger.info(
        { created: missingDedicatedLocalConnections },
        "Auto-created dedicated local MCP client connections"
      );
    } else if (shouldCreateDefaultLocalMcpClientConnection(existingConnections)) {
      await connectionsRepo.create({
        name: DEFAULT_LOCAL_MCP_CLIENT_CONNECTION_NAME,
        integrationType: "github",
        baseUrl: `http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}`,
        authMethod: "api_token",
        status: "connected",
      });
      logger.info("Auto-created legacy local MCP client connection");
    }
  } catch (error) {
    logger.warn({ error }, "Failed to auto-create local MCP client connection (non-fatal)");
  }

  // Create maintenance scheduler
  const scheduler = createMaintenanceScheduler({ logger });

  // Register maintenance tasks
  scheduler.registerTask(
    "token-refresh",
    5 * 60 * 1000, // 5 minutes
    async () => {
      logger.debug("Running token refresh task");
      // TODO: Implement token refresh logic
    }
  );

  scheduler.registerTask(
    "health-monitor",
    1 * 60 * 1000, // 1 minute
    async () => {
      logger.debug("Running health monitor task");
    }
  );

  logger.info("Maintenance scheduler configured with 2 tasks");

  // Cleanup function
  const cleanup = async (): Promise<void> => {
    logger.info("Shutting down server");
    scheduler.stop();
    await databaseQueryService.closeAll();
    logger.info("Server shutdown complete");
  };

  return {
    mcpServer,
    httpApp,
    scheduler,
    cleanup,
  };
}

export async function startServer(config: EnvConfig): Promise<void> {
  const logger = createLogger(config.CLAUDE_MCP_LOG_LEVEL);

  let components: ServerComponents;
  try {
    components = await createServer(config);
  } catch (error) {
    logger.error({ error }, "Failed to create server");
    console.error("Server creation failed:", error);
    throw error;
  }

  const { mcpServer, httpApp, scheduler, cleanup } = components;

  // Start maintenance scheduler
  scheduler.start();
  logger.info("Maintenance scheduler started");

  // Start HTTP admin panel server.
  // In stdio mode an MCP client may spawn this process concurrently with an
  // existing instance. If the admin port is already bound, log a warning and
  // continue — the MCP stdio transport works independently of the admin panel.
  const server = serve(
    {
      fetch: httpApp.fetch,
      port: config.CLAUDE_MCP_ADMIN_PORT,
    },
    (info) => {
      logger.info(
        { port: info.port },
        `Admin panel listening on http://localhost:${info.port}`
      );
    }
  );

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      // Another instance already owns the admin port — this is expected when
      // Some MCP clients spawn a second process during protocol negotiation.
      // Warn and continue; the MCP tools are fully functional without it.
      logger.warn(
        { port: config.CLAUDE_MCP_ADMIN_PORT },
        `Admin panel port ${config.CLAUDE_MCP_ADMIN_PORT} is already in use — skipping admin server for this instance`
      );
    } else {
      logger.error({ error }, "HTTP server error — exiting");
      process.exit(1);
    }
  });

  // Connect MCP transport based on config
  // NOTE: stdio transport takes over stdin/stdout, so it must start AFTER
  // the HTTP server and should not be used when running alongside a dev
  // server (e.g. `pnpm dev` via concurrently). Use SSE or HTTP transport
  // for dev mode instead.
  if (config.CLAUDE_MCP_TRANSPORT === "stdio") {
    const transport = createStdioTransport();
    await mcpServer.connect(transport);
    logger.info("MCP server connected via stdio transport");
  } else if (config.CLAUDE_MCP_TRANSPORT === "sse") {
    const sseTransport = createSSETransport(httpApp);
    sseTransport.setupRoutes();
    logger.info("MCP server configured for SSE transport");
  } else {
    logger.info({ transport: config.CLAUDE_MCP_TRANSPORT }, "MCP transport configured");
  }

  // Handle graceful shutdown
  const handleShutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutdown signal received");
    await cleanup();
    // server.close() is a no-op if the admin server never started (EADDRINUSE)
    try { server.close(); } catch { /* already closed or never started */ }
    process.exit(0);
  };

  process.on("SIGINT", () => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    handleShutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    handleShutdown("SIGTERM");
  });

  logger.info("Server startup complete");
}
