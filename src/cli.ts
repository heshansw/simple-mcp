#!/usr/bin/env node

import { parseArgs } from "node:util";

const VALID_COMMANDS = ["start", "stop", "status", "config"];

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Handle help
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  const command = args[0]!;

  if (!VALID_COMMANDS.includes(command)) {
    console.error(`Error: Unknown command '${command}'`);
    console.error(`Valid commands: ${VALID_COMMANDS.join(", ")}`);
    process.exit(1);
  }

  try {
    switch (command) {
      case "start": {
        const { executeStartCommand } = await import(
          "./cli/commands/start.command.js"
        );
        const options = parseStartOptions(args.slice(1));
        await executeStartCommand(options);
        break;
      }

      case "stop": {
        const { executeStopCommand } = await import(
          "./cli/commands/stop.command.js"
        );
        await executeStopCommand();
        break;
      }

      case "status": {
        const { executeStatusCommand } = await import(
          "./cli/commands/status.command.js"
        );
        await executeStatusCommand();
        break;
      }

      case "config": {
        const { executeConfigCommand } = await import(
          "./cli/commands/config.command.js"
        );
        await executeConfigCommand();
        break;
      }

      default: {
        const _exhaustive: never = command as never;
        throw new Error(`Unknown command: ${_exhaustive}`);
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`Error: ${errorMessage}`);
    process.exit(1);
  }
}

function parseStartOptions(args: string[]): {
  serverOnly: boolean;
  adminOnly: boolean;
  daemon: boolean;
} {
  try {
    const result = parseArgs({
      args,
      options: {
        "server-only": { type: "boolean" },
        "admin-only": { type: "boolean" },
        daemon: { type: "boolean" },
      },
      strict: true,
    });

    return {
      serverOnly: result.values["server-only"] ?? false,
      adminOnly: result.values["admin-only"] ?? false,
      daemon: result.values.daemon ?? false,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`Failed to parse options: ${errorMessage}`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`simple-mcp - TypeScript MCP Server CLI

Usage: simple-mcp <command> [options]

Commands:
  start              Start the server
    --server-only    Run MCP server only (no admin panel)
    --admin-only     Run admin panel only (no MCP server)
    --daemon         Run in background (daemon mode)

  stop               Stop the running server

  status             Check if server is running

  config             Open admin panel in browser

Examples:
  simple-mcp start
  simple-mcp start --daemon
  simple-mcp start --server-only
  simple-mcp stop
  simple-mcp status
  simple-mcp config

Options:
  -h, --help         Show this help message
`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
