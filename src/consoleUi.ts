export type ConsoleTone = "info" | "success" | "warning" | "error" | "muted";

const RESET = "\u001b[0m";
const COLORS: Record<ConsoleTone | "date", string> = {
  info: "\u001b[36m",
  success: "\u001b[32m",
  warning: "\u001b[33m",
  error: "\u001b[31m",
  muted: "\u001b[90m",
  date: "\u001b[94m",
};

export function shouldUseColor(
  env: NodeJS.ProcessEnv = process.env,
  isTty = Boolean(process.stdout.isTTY),
): boolean {
  if (env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0") return true;
  return isTty && env.TERM !== "dumb";
}

export function paint(
  text: string,
  tone: ConsoleTone | "date",
  enabled = shouldUseColor(),
): string {
  return enabled ? `${COLORS[tone]}${text}${RESET}` : text;
}

export function highlightGameDate(date: string, enabled = shouldUseColor()): string {
  return paint(date, "date", enabled);
}

export function highlightSaveFilename(filename: string, enabled = shouldUseColor()): string {
  const match = filename.match(/_(\d{3,4})_(\d{1,2})_(\d{1,2})(?=\.ck3$)/i);
  if (!match || match.index === undefined) return filename;

  const start = match.index + 1;
  const rawDate = `${match[1]}_${match[2]}_${match[3]}`;
  return `${filename.slice(0, start)}${paint(rawDate, "date", enabled)}${filename.slice(start + rawDate.length)}`;
}

export function formatStatus(
  message: string,
  tone: ConsoleTone = "info",
  enabled = shouldUseColor(),
): string {
  return paint(message, tone, enabled);
}

export function formatProgress(
  date: string | null,
  message: string,
  tone: ConsoleTone = "info",
  enabled = shouldUseColor(),
): string {
  const prefix = date ? `${highlightGameDate(date, enabled)}  ` : "";
  return `${prefix}${formatStatus(message, tone, enabled)}`;
}
