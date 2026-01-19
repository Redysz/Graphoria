export function parseGitDubiousOwnershipError(raw: string): string | null {
  const prefix = "GIT_DUBIOUS_OWNERSHIP\n";
  if (!raw.startsWith(prefix)) return null;
  return raw.slice(prefix.length).trim();
}
