import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_DISPLAY_NAME } from "@shared/mcp-client.js";

describe("frontend shell branding", () => {
  it("uses the neutral app title in index.html", () => {
    const html = readFileSync(
      resolve(process.cwd(), "src/frontend/index.html"),
      "utf-8"
    );

    expect(html).toContain(`<title>${APP_DISPLAY_NAME} Admin Panel</title>`);
    expect(html).not.toContain("Claude MCP Admin Panel");
  });
});
