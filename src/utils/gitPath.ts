export function normalizeGitPath(p: string) {
  return p.replace(/\\/g, "/").replace(/\/+$/g, "");
}
