export interface HealthSemantics {
  /** Raw numeric scalar serialized by CK3 under living/<character>/alive_data/health. */
  rawSaveValue: number | null;
  /** Null until CK3-NZT can reconstruct every relevant health modifier reliably. */
  effectiveValue: null;
  effectiveAvailable: false;
  /** Stable machine-readable source label for consumers of current.json. */
  source: "living.alive_data.health";
  /** Prevent consumers from interpreting the raw scalar as a UI-equivalent effective value. */
  scope: "serialized_scalar_not_ui_equivalent";
  modifierBreakdownAvailable: false;
  limitation: string;
}

export const HEALTH_LIMITATION =
  "CK3-NZT exposes the serialized alive_data.health scalar but does not reconstruct a reliable UI-equivalent effective health value. The exact relationship between this scalar and active trait, modifier, age, disease/event, and runtime health effects is not established, so do not treat rawSaveValue as effective health.";

export function healthSemantics(rawSaveValue: number | null): HealthSemantics {
  return {
    rawSaveValue,
    effectiveValue: null,
    effectiveAvailable: false,
    source: "living.alive_data.health",
    scope: "serialized_scalar_not_ui_equivalent",
    modifierBreakdownAvailable: false,
    limitation: HEALTH_LIMITATION,
  };
}

/**
 * Attach ruler-health semantics to an exported snapshot without changing the existing
 * Snapshot shape used internally by the MCP/cache. Object.assign keeps the extra field
 * in JSON persistence while preserving backward compatibility for current consumers.
 */
export function attachRulerHealthSemantics<
  T extends { ruler?: { health: number | null } | null },
>(snapshot: T): T & { rulerHealth: HealthSemantics } {
  return Object.assign(snapshot, {
    rulerHealth: healthSemantics(snapshot.ruler?.health ?? null),
  });
}
