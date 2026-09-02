export type CommitRefMarker = { kind: "head" | "branch" | "tag" | "remote"; label: string };

export function parseRefs(refs: string, remoteNames: string[]): CommitRefMarker[] {
  const parts = refs
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const out: CommitRefMarker[] = [];

  const remotePrefixes = (remoteNames ?? [])
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  const isRemoteRef = (label: string) => {
    const t = label.trim();
    if (!t) return false;
    return remotePrefixes.some((r) => t.startsWith(`${r}/`));
  };

  for (const part of parts) {
    if (part.startsWith("tag: ")) {
      const label = part.slice("tag: ".length).trim();
      if (label) out.push({ kind: "tag", label });
      continue;
    }

    if (part.includes(" -> ")) {
      const [leftRaw, rightRaw] = part.split(" -> ", 2);
      const left = leftRaw.trim();
      const right = rightRaw.trim();
      if (left === "HEAD") {
        out.push({ kind: "head", label: "HEAD" });
      } else if (left.endsWith("/HEAD")) {
        out.push({ kind: "remote", label: left });
      } else if (left) {
        out.push({ kind: isRemoteRef(left) ? "remote" : "branch", label: left });
      }
      if (right) {
        out.push({ kind: isRemoteRef(right) ? "remote" : "branch", label: right });
      }
      continue;
    }

    if (part === "HEAD") {
      out.push({ kind: "head", label: "HEAD" });
      continue;
    }

    out.push({ kind: isRemoteRef(part) ? "remote" : "branch", label: part });
  }

  return out;
}
