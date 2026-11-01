import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp, truncate } from "../format.js";

export function registerRealmTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "realm",
    {
      title: "Realm",
      description:
        "Every county in the played ruler's de-facto realm, plus strategically relevant foreign counties from the same de-jure kingdom, allied realms, truces, hostile-opinion realms and active-war enemies. Exact geographic adjacency is reported separately because it needs static map data.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const realm = snap.realm;
      if (!realm) {
        return { content: [{ type: "text", text: stamp(snap, "Realm graph unavailable.") }] };
      }

      const { shown, note } = truncate(realm.counties, 40);
      let body =
        `# Realm counties (${realm.countyCount})\n` +
        `- Personally held: ${realm.playerHeldCountyCount}\n` +
        `- Held by vassals: ${realm.vassalHeldCountyCount}\n`;
      for (const county of shown) {
        const holder = county.holderName ?? "?";
        const control = county.control ?? "?";
        const culture = county.cultureId ?? "?";
        const faith = county.faithName ?? county.faith ?? "?";
        const rite = county.riteName ?? county.rite ?? "?";
        body += `- ${county.name}: holder ${holder}, control ${control}, culture ${culture}, faith ${faith}, rite ${rite}${county.heldByPlayer ? " [personal]" : ""}\n`;
      }
      body += note;

      if (realm.relevantForeignCounties.length > 0) {
        const foreign = truncate(realm.relevantForeignCounties, 60);
        body += `\n# Relevant foreign counties (${realm.relevantForeignCountyCount})\n`;
        body += `- same de-jure kingdom: ${realm.relevantForeignCountsByReason.same_de_jure_kingdom}\n`;
        body += `- allied realms: ${realm.relevantForeignCountsByReason.ally_realm}\n`;
        body += `- truce realms: ${realm.relevantForeignCountsByReason.truce_realm}\n`;
        body += `- hostile-opinion realms: ${realm.relevantForeignCountsByReason.hostile_opinion_realm}\n`;
        body += `- active-war enemy realms: ${realm.relevantForeignCountsByReason.active_war_enemy_realm}\n`;
        for (const county of foreign.shown) {
          body += `- ${county.name} (${county.realmName}): ${county.relevance.join(", ")}; holder ${county.holderName ?? "?"}, control ${county.control ?? "?"}\n`;
        }
        body += foreign.note;
      }

      body += `\nExact geographic adjacency: ${realm.exactAdjacencyAvailable ? "available" : "not yet available"}.`;
      if (realm.limitation) body += `\nLimitation: ${realm.limitation}`;
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}

export function registerEducationTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "education",
    {
      title: "Education",
      description:
        "Education status of the ruler's minor descendants and heirs: education focus, succession position and recovered guardian relationships. Missing guardians are warnings because relation serialization is version-dependent.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const education = snap.education;
      if (!education || education.children.length === 0) {
        return { content: [{ type: "text", text: stamp(snap, "No minor descendants in education range.") }] };
      }

      let body = `# Education (${education.children.length})\n`;
      for (const child of education.children) {
        const succession = child.successionPosition === null ? "not in succession list" : `succession #${child.successionPosition}`;
        const focus = child.focus?.type ?? "?";
        const guardians = child.guardianNames.length > 0 ? child.guardianNames.join(", ") : "NOT RECOVERED";
        body += `- ${child.name} (${child.age ?? "?"}): ${succession}, focus ${focus}, guardian ${guardians}\n`;
      }
      body += `\nLimitation: ${education.limitation}`;
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}

export function registerImportantActionsTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "important_actions",
    {
      title: "Important Actions",
      description:
        "Serialized CK3 Important Action / suggestion records. Useful for detecting UI warnings such as education, council expectations and other actionable hints without hard-coding a specific campaign.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const actions = snap.importantActions;
      if (!actions || actions.actions.length === 0) {
        return { content: [{ type: "text", text: stamp(snap, "No structured Important Action records recovered.") }] };
      }

      let body = `# Important actions (${actions.activeCount})\n`;
      for (const action of actions.actions) {
        const chars = action.characterRefs.map((ref) => `${ref.field}=${ref.name ?? ref.id}`).join(", ");
        const titles = action.titleRefs.map((ref) => `${ref.field}=${ref.name ?? ref.id}`).join(", ");
        body += `- ${action.type ?? "unknown"} (${action.id ?? "?"})${action.playerReferenced ? " [player]" : ""}`;
        if (chars) body += `; ${chars}`;
        if (titles) body += `; ${titles}`;
        body += "\n";
      }
      body += `\nLimitation: ${actions.limitation ?? "none"}`;
      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
