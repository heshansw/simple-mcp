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

import { createEncryptionService } from "./services/encryption.service.js";
import { createConnectionManagerService } from "./services/connection-manager.service.js";
import { createJiraService } from "./services/jira.service.js";
import { createGitHubService } from "./services/github.service.js";

import { createLogger, loggingMiddleware } from "./middleware/logging.middleware.js";
import { errorHandlerMiddleware } from "./middleware/error-handler.middleware.js";
import { createRateLimiter } from "./middleware/rate-limit.middleware.js";

import { createAgentRegistry } from "./agents/registry.js";
import {
  jiraTriageAgent,
  prReviewAgent,
  codeSearchAgent,
  sprintPlanningAgent,
} from "./agents/index.js";

import { createMaintenanceScheduler } from "./maintenance/scheduler.js";
import { createStdioTransport } from "./transports/stdio.transport.js";
import { createSSETransport } from "./transports/sse.transport.js";

import { registerSearchIssuesTool } from "./tools/jira/search-issues.tool.js";
import { registerCreateIssueTool } from "./tools/jira/create-issue.tool.js";
import { registerTransitionIssueTool } from "./tools/jira/transition-issue.tool.js";
import { registerListPrsTool } from "./tools/github/list-prs.tool.js";
import { registerReviewPrTool } from "./tools/github/review-pr.tool.js";
import { registerSearchCodeTool } from "./tools/github/search-code.tool.js";
import { registerHealthCheckTool } from "./tools/system/health-check.tool.js";
import { registerListConnectionsTool } from "./tools/system/list-connections.tool.js";

import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

import { isErr } from "@shared/result.js";
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
  backupDatabase(config.CLAUDE_MCP_DB_PATH);
  const db = await createDatabase(config.CLAUDE_MCP_DB_PATH);
  logger.info({ path: config.CLAUDE_MCP_DB_PATH }, "Database initialized");

  // Create repositories
  const connectionsRepo = createConnectionsRepository(db);
  const credentialsRepo = createCredentialsRepository(db);
  const agentConfigsRepo = createAgentConfigsRepository(db);
  const serverSettingsRepo = createServerSettingsRepository(db);
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

  const jiraService = createJiraService({ logger });
  const githubService = createGitHubService({ logger });

  // Create MCP server
  const mcpServer = new McpServer({
    name: "simple-mcp",
    version: "0.1.0",
  });

  // Register tools
  const toolDeps = {
    jiraService,
    githubService,
    connectionManager,
    logger,
  } as any;

  registerSearchIssuesTool(mcpServer, toolDeps);
  registerCreateIssueTool(mcpServer, toolDeps);
  registerTransitionIssueTool(mcpServer, toolDeps);
  registerListPrsTool(mcpServer, toolDeps);
  registerReviewPrTool(mcpServer, toolDeps);
  registerSearchCodeTool(mcpServer, toolDeps);
  registerHealthCheckTool(mcpServer, toolDeps);
  registerListConnectionsTool(mcpServer, toolDeps);

  logger.info("All MCP tools registered");

  // Create and populate agent registry
  const agentRegistry = createAgentRegistry({ logger });
  agentRegistry.register(jiraTriageAgent);
  agentRegistry.register(prReviewAgent);
  agentRegistry.register(codeSearchAgent);
  agentRegistry.register(sprintPlanningAgent);

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
  httpApp.get("/api/connections", (c) => {
    const result = connectionManager.getAllConnections();
    if (isErr(result)) {
      throw result.error;
    }
    return c.json({ connections: result.value });
  });

  httpApp.post("/api/connections", async (c) => {
    const body = await c.req.json();
    const result = connectionManager.createConnection({
      name: body.name,
      integrationType: body.integrationType,
      baseUrl: body.baseUrl,
      authMethod: body.authMethod,
    });
    if (isErr(result)) {
      throw result.error;
    }
    return c.json({ connection: result.value }, { status: 201 });
  });

  httpApp.get("/api/connections/:id", (c) => {
    const id = c.req.param("id");
    const result = connectionManager.getConnection(id);
    if (isErr(result)) {
      throw result.error;
    }
    return c.json({ connection: result.value });
  });

  httpApp.put("/api/connections/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const result = connectionManager.updateConnection(id, {
      name: body.name,
      baseUrl: body.baseUrl,
      status: body.status,
    });
    if (isErr(result)) {
      throw result.error;
    }
    return c.json({ connection: result.value });
  });

  httpApp.delete("/api/connections/:id", (c) => {
    const id = c.req.param("id");
    const result = connectionManager.deleteConnection(id);
    if (isErr(result)) {
      throw result.error;
    }
    return c.json({ success: true });
  });

  // Agents API
  httpApp.get("/api/agents", (c) => {
    const agents = agentRegistry.getAll();
    const enabledAgents = agents.filter((agent) => {
      const config = agentConfigsRepo.findByAgentId(agent.id);
      return config?.enabled ?? true;
    });
    return c.json({
      agents,
      enabledCount: enabledAgents.length,
    });
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
    return c.json({ agent });
  });

  httpApp.put("/api/agents/:id/config", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json();
    const updated = agentConfigsRepo.upsert(id, {
      enabled: body.enabled ?? true,
      parameterOverrides: body.parameterOverrides ?? undefined,
      linkedConnectionIds: body.linkedConnectionIds ?? undefined,
    });
    return c.json({ config: updated });
  });

  // Server settings API
  httpApp.get("/api/settings", (c) => {
    const settings = serverSettingsRepo.getAll();
    return c.json({ settings });
  });

  httpApp.put("/api/settings", async (c) => {
    const body = await c.req.json();
    const setting = serverSettingsRepo.set(body.key, body.value);
    return c.json({ setting });
  });

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
      // TODO: Implement health monitoring logic
    }
  );

  scheduler.registerTask(
    "schema-sync",
    30 * 60 * 1000, // 30 minutes
    async () => {
      logger.debug("Running schema sync task");
      // TODO: Implement schema sync logic
    }
  );

  logger.info("Maintenance scheduler configured with 3 tasks");

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

  const { mcpServer, httpApp, scheduler, cleanup } = await createServer(config);

  // Start maintenance scheduler
  scheduler.start();
  logger.info("Maintenance scheduler started");

  // Connect MCP transport based on config
  if (config.CLAUDE_MCP_TRANSPORT === "stdio") {
    const transport = createStdioTransport();
    await mcpServer.connect(transport);
    logger.info("MCP server connected via stdio transport");
  } else if (config.CLAUDE_MCP_TRANSPORT === "sse") {
    const sseTransport = createSSETransport(httpApp);
    sseTransport.setupRoutes();
    logger.info("MCP server configured for SSE transport");
  }

  // Start HTTP server
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

  // Handle graceful shutdown
  const handleShutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutdown signal received");
    await cleanup();
    server.close();
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
