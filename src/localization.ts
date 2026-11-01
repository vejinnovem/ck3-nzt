import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export class Localizer {
  private map = new Map<string, string>();
  private traitLookup: string[] | null = null;
  private warned = false;
  private baronyProvince = new Map<string, number>();

  constructor(
    gameDir: string | null,
    preferredLanguage = process.env.CK3_NZT_LANGUAGE ?? "polish",
  ) {
    if (!gameDir) return;

    // English is the stable fallback for missing translation keys. Load it first,
    // then let the preferred language override matching entries. CK3 ships its
    // localisation in language-specific directories such as english/ and polish/.
    this.loadDir(join(gameDir, "localization", "english"));
    if (preferredLanguage && preferredLanguage !== "english") {
      this.loadDir(join(gameDir, "localization", preferredLanguage));
    }

    // The save stores dynamic province state, but in current CK3 saves it does not
    // serialize a reliable province -> barony link. The static landed-title files do.
    this.loadLandedTitles(join(gameDir, "common", "landed_titles"));
  }

  private loadDir(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const path = join(dir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        this.loadDir(path);
        continue;
      }
      if (!name.endsWith(".yml")) continue;
      this.loadFile(path);
    }
  }

  private loadFile(path: string): void {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = /^\s+([\w.-]+):\d*\s+"(.*)"/.exec(line);
      if (m) this.map.set(m[1]!, m[2]!);
    }
  }

  private loadLandedTitles(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      const path = join(dir, name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        this.loadLandedTitles(path);
        continue;
      }
      if (!name.endsWith(".txt")) continue;
      this.loadLandedTitleFile(path);
    }
  }

  private loadLandedTitleFile(path: string): void {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      return;
    }

    // Comments can contain braces or title-like text. They are not relevant to the
    // structural mapping, so remove them before scanning blocks.
    text = text.replace(/#.*$/gm, "");
    const titlePattern = /\b(b_[A-Za-z0-9_]+)\s*=\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = titlePattern.exec(text)) !== null) {
      const key = match[1]!;
      const openBrace = text.indexOf("{", match.index);
      if (openBrace < 0) continue;
      const closeBrace = this.findMatchingBrace(text, openBrace);
      if (closeBrace < 0) continue;

      const body = text.slice(openBrace + 1, closeBrace);
      const provinceMatch = /\bprovince\s*=\s*(\d+)\b/.exec(body);
      if (provinceMatch) {
        const provinceId = Number(provinceMatch[1]);
        if (Number.isFinite(provinceId)) this.baronyProvince.set(key, provinceId);
      }

      // Barony blocks cannot contain other landed-title blocks. Advancing to the end
      // avoids treating script text inside a barony as another top-level match.
      titlePattern.lastIndex = closeBrace + 1;
    }
  }

  private findMatchingBrace(text: string, openBrace: number): number {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = openBrace; index < text.length; index += 1) {
      const ch = text[index]!;
      if (quoted) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') quoted = false;
        continue;
      }
      if (ch === '"') {
        quoted = true;
        continue;
      }
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  }

  /** Per-save trait index table (from the gamestate's traits_lookup). */
  setTraitLookup(lookup: string[] | null): void {
    this.traitLookup = lookup;
  }

  resolve(key: string): string {
    const v = this.map.get(key);
    if (v !== undefined) return v;
    if (!this.warned && this.map.size === 0) {
      this.warned = true;
      process.stderr.write(
        "ck3-advisor: no localization loaded (game dir missing?); showing raw keys.\n",
      );
    }
    return key;
  }

  resolveTrait(idx: number): string {
    const ident = this.traitLookup?.[idx];
    if (!ident) return `trait_${idx}`;

    const direct = this.resolve(ident);
    if (direct !== ident) return direct;

    const prefixed = `trait_${ident}`;
    const resolvedPrefixed = this.resolve(prefixed);
    return resolvedPrefixed !== prefixed ? resolvedPrefixed : ident;
  }

  provinceForBarony(key: string): number | null {
    return this.baronyProvince.get(key) ?? null;
  }
}
