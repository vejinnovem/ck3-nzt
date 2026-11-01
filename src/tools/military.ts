import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp, truncate } from "../format.js";

function score(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(2).replace(/\.00$/, "");
}

export function registerMilitaryTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "military",
    {
      title: "Military",
      description:
        "Player's raw realm mobilisation aggregates and ongoing wars. War data exposes the ticking objective-control component, objective control, and resolved battle/siege result records; it does not claim to expose the full player-visible war score or exact raised-stack size.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const snap = await cache.get();
      if ("error" in snap) return { isError: true, content: [{ type: "text", text: snap.error }] };
      const m = snap.military;

      const levyStr = m.levy !== null ? Math.round(m.levy).toString() : "?";
      const strengthStr = m.strength !== null ? Math.round(m.strength).toString() : "?";
      const currentStr =
        m.currentStrength !== null ? Math.round(m.currentStrength).toString() : "?";

      let body =
        `# Military\n- Realm mobilisation aggregate: levy ${levyStr} | ` +
        `strength ${strengthStr} (current aggregate ${currentStr}; not raised-stack size)\n`;

      const { shown, note } = truncate(m.wars, 5);
      if (shown.length === 0) {
        body += "## Wars (0)\nAt peace.";
      } else {
        body += `## Wars (${m.wars.length})\n`;
        for (const w of shown) {
          const yourTicking =
            w.playerSide === "attacker" ? w.attackerTickingWarScore : w.defenderTickingWarScore;
          const theirTicking =
            w.playerSide === "attacker" ? w.defenderTickingWarScore : w.attackerTickingWarScore;
          const youControlAll =
            w.playerSide === "attacker"
              ? w.attackerControlsAllObjectives
              : w.defenderControlsAllObjectives;
          const theyControlAll =
            w.playerSide === "attacker"
              ? w.defenderControlsAllObjectives
              : w.attackerControlsAllObjectives;
          const target = w.targetTitle ?? "(unknown)";
          body +=
            `- ${w.playerSide.toUpperCase()} vs ${target} — ${w.cbType}, ` +
            `ticking objective score you ${score(yourTicking)} / them ${score(theirTicking)}, ` +
            `controls all objectives you ${youControlAll ? "yes" : "no"} / them ${theyControlAll ? "yes" : "no"}, ` +
            `resolved battle/siege events ${w.warScoreEvents.length}, since ${w.startDate}\n`;
        }
        body += note;
      }

      return { content: [{ type: "text", text: stamp(snap, body) }] };
    },
  );
}
