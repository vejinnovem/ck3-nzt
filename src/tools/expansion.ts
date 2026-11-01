import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SnapshotCache } from "../cache.js";
import { stamp, truncate } from "../format.js";

function formatStrength(value: number | null): string {
  return value === null ? "?" : String(Math.round(value));
}

function formatCandidate(
  candidate: {
    type: string;
    availability: "candidate" | "blocked";
    blockers: string[];
  },
): string {
  const blockers = candidate.blockers.length === 0 ? "" : `; blockers ${candidate.blockers.join(",")}`;
  return `${candidate.type}:${candidate.availability}${blockers}`;
}

export function registerExpansionTool(server: McpServer, cache: SnapshotCache) {
  server.registerTool(
    "expansion",
    {
      title: "Expansion",
      description:
        "Stored expansion levers: your title claims, de jure opportunities, ongoing-war targets, " +
        "and save-derived strategic targets inside your de-jure kingdom. Strategic targets distinguish " +
        "direct alliances from CK3 confederation co-members and estimate the defensive coalition from both. " +
        "Confirmed claim/de-jure CBs are kept separate from partially evaluated tribal conquest/subjugation candidates. " +
        "Exact map adjacency and the full dynamic CK3 casus-belli script calculation are not reconstructed yet.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const snap = await cache.get();
        if ("error" in snap)
          return { isError: true, content: [{ type: "text", text: snap.error }] };
        const e = snap.expansion;

        let body = "# Expansion\n";

        const { shown: shownClaims, note: claimsNote } = truncate(e.claims, 10);
        if (shownClaims.length === 0) {
          body += `## Claims (0)\nNo claims.\n`;
        } else {
          body += `## Claims (${e.claims.length}, ${e.pressedCount} pressed)\n`;
          for (const c of shownClaims) {
            body += `- ${c.title} (${c.pressed ? "pressed" : "unpressed"})\n`;
          }
          body += claimsNote;
        }

        if (e.deJureUnheld.length > 0) {
          const { shown: shownDJ, note: djNote } = truncate(e.deJureUnheld, 10);
          body += `## Unheld de jure titles (${e.deJureUnheld.length})\n`;
          for (const t of shownDJ) body += `- ${t.title}\n`;
          body += djNote;
        } else {
          body += `## Unheld de jure titles (0)\nNone.\n`;
        }

        if (e.warTargets.length > 0) {
          const { shown: shownWT, note: wtNote } = truncate(e.warTargets, 10);
          body += `## Ongoing war targets (${e.warTargets.length})\n`;
          for (const t of shownWT) body += `- ${t.title} (${t.cbType})\n`;
          body += wtNote;
        }

        const { shown: shownTargets, note: targetNote } = truncate(e.strategicTargets, 12);
        body += `## Strategic targets (${e.strategicTargets.length})\n`;
        if (shownTargets.length === 0) {
          body += "None found in the current de-jure kingdom scope.\n";
        } else {
          for (const target of shownTargets) {
            const rulerOnlyRatio =
              target.playerToTargetStrengthRatio === null
                ? "?"
                : target.playerToTargetStrengthRatio.toFixed(2);
            const coalitionRatio =
              target.playerToDefensiveStrengthRatio === null
                ? "?"
                : target.playerToDefensiveStrengthRatio.toFixed(2);
            const allies =
              target.allies.length === 0
                ? "none"
                : target.allies.map((ally) => ally.realm ?? ally.name).join(", ");
            const confederationMembers =
              target.confederationMembers.length === 0
                ? "none"
                : target.confederationMembers
                    .map((member) => member.realm ?? member.name)
                    .join(", ");
            const wars =
              target.wars.length === 0
                ? "none"
                : target.wars.map((war) => `${war.side}:${war.cbType}`).join(", ");
            const realmCandidates =
              target.candidateCasusBelli.length === 0
                ? "none"
                : target.candidateCasusBelli.map(formatCandidate).join(", ");
            const titles = target.relevantTitles
              .map((title) => {
                const confirmed =
                  title.confirmedCasusBelli.length === 0
                    ? "no confirmed save-only CB"
                    : `confirmed ${title.confirmedCasusBelli.join("+")}`;
                const candidates =
                  title.candidateCasusBelli.length === 0
                    ? "no partial candidates"
                    : `candidates ${title.candidateCasusBelli.map(formatCandidate).join(",")}`;
                return `${title.title} [${confirmed}; ${candidates}]`;
              })
              .join("; ");
            body +=
              `- ${target.realmName} — ruler ${target.rulerName}; ruler army ` +
              `${formatStrength(target.currentStrength)}/${formatStrength(target.strength)}; ` +
              `expected defender coalition ${formatStrength(target.defensiveCurrentStrength)}; ` +
              `our coalition ${formatStrength(target.playerWithAlliesCurrentStrength)}; ` +
              `coalition ratio ${coalitionRatio}; ruler-only ratio ${rulerOnlyRatio}; ` +
              `direct allies ${allies}; confederation defenders ${confederationMembers}; ` +
              `truce ${target.truceUntil ?? "none"}; realm CB candidates ${realmCandidates}; ` +
              `wars ${wars}; titles: ${titles}\n`;
          }
          body += targetNote;
        }

        body +=
          `\nScope: ${e.targetScope.deJureKingdomName ?? "unknown de-jure kingdom"}; ` +
          `exact adjacency: ${e.targetScope.exactAdjacencyAvailable ? "available" : "not available"}; ` +
          `CB coverage: ${e.targetScope.casusBelliCoverage}.\n`;
        if (e.targetScope.casusBelliLimitations.length > 0) {
          body += "CB limitations:\n";
          for (const limitation of e.targetScope.casusBelliLimitations) {
            body += `- ${limitation}\n`;
          }
        }

        return { content: [{ type: "text", text: stamp(snap, body) }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}
