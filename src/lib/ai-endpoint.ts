/**
 * AI endpoint trust classification.
 *
 * The AI panel posts the user's question — and optionally the connected
 * database's schema — to whatever URL is configured in settings. That URL is
 * user-editable, so it can point anywhere. Treating "loopback" and "remote"
 * identically would let a one-character settings change silently start
 * shipping schema metadata off the machine.
 *
 * This module is the single place that decides whether an endpoint counts as
 * local. Keep it dependency-free and pure so it stays trivially testable.
 */

/** Hostnames that resolve to this machine and never leave it. */
const LOOPBACK_HOSTS: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
];

export type EndpointTrust = "local" | "remote" | "invalid";

/**
 * Classify an endpoint URL.
 *
 * - `local`   — loopback host; data stays on this machine.
 * - `remote`  — any other host; sending data leaves the machine.
 * - `invalid` — not a parseable absolute URL (treated as remote by callers,
 *               i.e. fail closed).
 */
export function classifyEndpoint(raw: string): EndpointTrust {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "invalid";
  const host = url.hostname.toLowerCase();
  return LOOPBACK_HOSTS.includes(host) ? "local" : "remote";
}

/** True only when the endpoint is provably loopback. Fails closed. */
export function isLocalEndpoint(raw: string): boolean {
  return classifyEndpoint(raw) === "local";
}

/**
 * Host shown in the outbound-data confirmation prompt. Returns the raw string
 * when it cannot be parsed, so the user still sees what was configured.
 */
export function endpointHost(raw: string): string {
  try {
    return new URL(raw).host;
  } catch {
    return raw;
  }
}
