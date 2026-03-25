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

import { createEncryptionService } from "./services/encryption.service.js";
import { createConnectionManagerService } from "./services/connection-manager.service.js";
import { createJiraService } from "./services/jira.service.js";
import { createGitHubService } from "./services/github.service.js";
import { createGoogleCalendarService } from "./services/google-calendar.service.js";
import type { GoogleTokenBundle } from "./services/google-calendar.service.js";
import { createLocalFilesystemService } from "./services/local-filesystem.service.js";
import { createConfluenceService } from "./services/confluence.service.js";

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
} from "./agents/index.js";

import { createMaintenanceScheduler } from "./maintenance/scheduler.js";
import { createStdioTransport } from "./transports/stdio.transport.js";
import { createSSETransport } from "./transports/sse.transport.js";

import { registerSearchIssuesTool } from "./tools/jira/search-issues.tool.js";
import { registerCreateIssueTool } from "./tools/jira/create-issue.tool.js";
import { registerTransitionIssueTool } from "./tools/jira/transition-issue.tool.js";
import { registerGetCommentsTool } from "./tools/jira/get-comments.tool.js";
import { registerAddCommentTool } from "./tools/jira/add-comment.tool.js";
import { registerListPrsTool } from "./tools/github/list-prs.tool.js";
import { registerReviewPrTool } from "./tools/github/review-pr.tool.js";
import { registerSearchCodeTool } from "./tools/github/search-code.tool.js";
import { registerGetPrDiffTool } from "./tools/github/get-pr-diff.tool.js";
import { registerGetMyPrsTool } from "./tools/github/get-my-prs.tool.js";
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

import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

import { randomBytes } from "node:crypto";
import { isErr, domainErrorMessage } from "@shared/result.js";
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
  // that actually has stored credentials (skip placeholder connections like "Claude (Local)")
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
  registerGetCommentsTool(mcpServer, jiraToolDeps);
  registerAddCommentTool(mcpServer, jiraToolDeps);
  registerListPrsTool(mcpServer, githubToolDeps);
  registerReviewPrTool(mcpServer, { ...githubToolDeps, reviewsRepo });
  registerSearchCodeTool(mcpServer, githubToolDeps);
  registerGetPrDiffTool(mcpServer, { ...githubToolDeps, reviewsRepo });
  registerGetMyPrsTool(mcpServer, githubToolDeps);
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
  };
  const confluenceToolDeps = { confluenceService: trackedConfluenceService, logger };
  registerConfluenceSearchPagesTool(mcpServer, confluenceToolDeps);
  registerConfluenceGetPageTool(mcpServer, confluenceToolDeps);
  registerConfluenceListSpacesTool(mcpServer, confluenceToolDeps);
  logger.info("Confluence MCP tools registered");

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

  logger.info(
    { agentCount: agentRegistry.getAll().length },
    "Agent registry populated"
  );

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

  // GET /api/reviews/in-progress — reviews currently being analyzed by Claude
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

  // Auto-create default Claude connection if it doesn't exist
  try {
    const existingConnections = await connectionsRepo.findAll();
    const hasClaudeConnection = existingConnections.some(
      (c) => c.name === "Claude (Local)" || c.integrationType === "claude" as string
    );
    if (!hasClaudeConnection) {
      await connectionsRepo.create({
        name: "Claude (Local)",
        integrationType: "github", // default placeholder — acts as local MCP connection
        baseUrl: `http://localhost:${config.CLAUDE_MCP_ADMIN_PORT}`,
        authMethod: "api_token",
        status: "connected",
      });
      logger.info("Auto-created default Claude (Local) connection");
    }
  } catch (error) {
    logger.warn({ error }, "Failed to auto-create Claude connection (non-fatal)");
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
  // In stdio mode Claude Desktop may spawn this process concurrently with an
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
      // Claude Desktop spawns a second process during protocol negotiation.
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
