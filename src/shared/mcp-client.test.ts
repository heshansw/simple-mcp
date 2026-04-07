import { describe, expect, it } from "vitest";
import {
  APP_DISPLAY_NAME,
  DATABASE_CONNECTIONS_DESCRIPTION,
  DATABASE_PERMISSIONS_DESCRIPTION,
  DEDICATED_LOCAL_MCP_CLIENT_CONNECTION_NAMES,
  DEFAULT_LOCAL_MCP_CLIENT_CONNECTION_NAME,
  LOCAL_MCP_CLIENT_CONNECTION_DESCRIPTION,
  REVIEWS_EMPTY_STATE_PREFIX,
  REVIEWS_PAGE_DESCRIPTION,
  getConnectionTypeLabel,
  getMissingDedicatedLocalMcpClientConnectionNames,
  isAnthropicConnectionCandidate,
  isLocalMcpClientConnectionName,
  shouldCreateDefaultLocalMcpClientConnection,
} from "./mcp-client.js";

describe("mcp-client compatibility helpers", () => {
  it("recognizes the default and legacy local MCP client placeholders", () => {
    expect(isLocalMcpClientConnectionName(DEFAULT_LOCAL_MCP_CLIENT_CONNECTION_NAME)).toBe(true);
    expect(isLocalMcpClientConnectionName("Claude (Local)")).toBe(true);
    expect(isLocalMcpClientConnectionName("Codex (Local)")).toBe(true);
    expect(isLocalMcpClientConnectionName("GitHub")).toBe(false);
  });

  it("creates a new default local MCP client placeholder only when needed", () => {
    expect(shouldCreateDefaultLocalMcpClientConnection([])).toBe(true);
    expect(
      shouldCreateDefaultLocalMcpClientConnection([{ name: "Claude (Local)" }])
    ).toBe(false);
    expect(
      shouldCreateDefaultLocalMcpClientConnection([{ name: "Codex (Local)" }])
    ).toBe(false);
    expect(
      shouldCreateDefaultLocalMcpClientConnection([
        { name: DEFAULT_LOCAL_MCP_CLIENT_CONNECTION_NAME },
      ])
    ).toBe(false);
  });

  it("reports missing dedicated Claude and Codex local client rows", () => {
    expect(getMissingDedicatedLocalMcpClientConnectionNames([])).toEqual(
      DEDICATED_LOCAL_MCP_CLIENT_CONNECTION_NAMES
    );
    expect(
      getMissingDedicatedLocalMcpClientConnectionNames([
        { name: "Claude (Local)" },
      ])
    ).toEqual(["Codex (Local)"]);
    expect(
      getMissingDedicatedLocalMcpClientConnectionNames([
        { name: "Claude (Local)" },
        { name: "Codex (Local)" },
      ])
    ).toEqual([]);
  });

  it("recognizes Anthropic-backed connection names for credential lookup", () => {
    expect(isAnthropicConnectionCandidate("Claude (Local)")).toBe(true);
    expect(isAnthropicConnectionCandidate("Anthropic Production")).toBe(true);
    expect(isAnthropicConnectionCandidate("OpenAI")).toBe(false);
  });

  it("keeps frontend-facing compatibility copy neutral", () => {
    expect(APP_DISPLAY_NAME).toBe("Simple MCP");
    expect(REVIEWS_PAGE_DESCRIPTION).toContain("MCP");
    expect(REVIEWS_PAGE_DESCRIPTION).not.toContain("Claude");
    expect(REVIEWS_EMPTY_STATE_PREFIX).toContain("MCP client");
    expect(DATABASE_PERMISSIONS_DESCRIPTION).toContain("MCP agents");
    expect(DATABASE_CONNECTIONS_DESCRIPTION).toContain("MCP agents");
    expect(LOCAL_MCP_CLIENT_CONNECTION_DESCRIPTION).toContain("Claude");
    expect(LOCAL_MCP_CLIENT_CONNECTION_DESCRIPTION).toContain("Codex");
  });

  it("shows a local client type label for local MCP client rows", () => {
    expect(
      getConnectionTypeLabel({
        name: "Codex (Local)",
        integrationType: "github",
      })
    ).toBe("LOCAL MCP CLIENT");
    expect(
      getConnectionTypeLabel({
        name: "GitHub Org",
        integrationType: "github",
      })
    ).toBe("GITHUB");
  });
});
