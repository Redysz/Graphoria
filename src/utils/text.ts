export function shortHash(hash: string) {
  return hash.slice(0, 8);
}

export function repoNameFromPath(p: string) {
  const normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const parts = normalized.split("/");
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

export function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function authorInitials(author: string) {
  const parts = author
    .trim()
    .split(/\s+/g)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

export function statusBadge(status: string) {
  const s = status.replace(/\s+/g, "");
  if (!s) return "?";
  if (s.includes("?")) return "A";
  if (s.includes("U")) return "U";
  if (s.includes("D")) return "D";
  if (s.includes("R")) return "R";
  if (s.includes("C")) return "C";
  if (s.includes("A")) return "A";
  if (s.includes("M")) return "M";
  if (s.includes("T")) return "T";
  return (s[0] ?? "?").toUpperCase();
}
