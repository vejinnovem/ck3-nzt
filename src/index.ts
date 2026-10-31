#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveConfig, discoverGameDir, discoverSaveDir } from "./config.js";
import { SaveFileSource } from "./source.js";
import { SnapshotCache } from "./cache.js";
import { Localizer } from "./localization.js";
import { registerAllTools } from "./tools/index.js";

async function main() {
  const cfg = resolveConfig();
  const saveDir = cfg.saveDir ?? (await discoverSaveDir());
  if (!saveDir) {
    console.error("No CK3 save dir found. Set CK3_SAVE_DIR.");
    process.exit(1);
  }

  const gameDir = cfg.gameDir ?? (await discoverGameDir());
  const cache = new SnapshotCache(new SaveFileSource({ saveDir }), new Localizer(gameDir));
  const server = new McpServer(
    { name: "ck3-nzt", version: "0.2.0-alpha.1" },
    {
      instructions:
        "Read-only CK3 strategic tools. CK3-NZT also maintains persistent local strategic memory through the separate export command.",
    },
  );
  registerAllTools(server, cache);
  await server.connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
