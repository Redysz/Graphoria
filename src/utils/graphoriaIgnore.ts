import { normalizeGitPath } from "./gitPath";

export type GraphoriaIgnoreRule = {
  negated: boolean;
  re: RegExp;
};

function escapeRegexChar(ch: string) {
  if (ch === "\\" || ch === "/") return ch;
  if (/[[\]{}()*+?.^$|]/.test(ch)) return `\\${ch}`;
  return ch;
}

function globToRegexBody(glob: string) {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === "*") {
      const next = glob[i + 1];
      if (next === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegexChar(ch);
  }
  return out;
}

function compileOnePattern(lineRaw: string): GraphoriaIgnoreRule | null {
  const trimmedEnd = lineRaw.replace(/\s+$/g, "");
  const trimmedStart = trimmedEnd.replace(/^\s+/g, "");
  if (!trimmedStart) return null;

  const isComment = trimmedStart.startsWith("#");
  if (isComment) return null;

  let line = trimmedStart;
  if (line.startsWith("\\#") || line.startsWith("\\!")) {
    line = line.slice(1);
  }

  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1);
  }

  line = normalizeGitPath(line);
  if (!line) return null;

  const dirOnly = line.endsWith("/");
  if (dirOnly) line = line.replace(/\/+$/g, "");

  const explicitRoot = line.startsWith("/");
  if (explicitRoot) line = line.slice(1);

  const hasSlash = line.includes("/");
  const anchored = explicitRoot || hasSlash;

  const body = globToRegexBody(line);

  if (!body) return null;

  const prefix = anchored ? "^" : "(?:^|.*/)";
  const suffix = dirOnly ? "(?:/.*)?$" : "(?:$|/.*$)";

  const re = new RegExp(`${prefix}${body}${suffix}`);
  return { negated, re };
}

export function compileGraphoriaIgnore(text: string): GraphoriaIgnoreRule[] {
  const normalized = (text ?? "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const rules: GraphoriaIgnoreRule[] = [];
  for (const line of lines) {
    const r = compileOnePattern(line);
    if (!r) continue;
    rules.push(r);
  }
  return rules;
}

export function isGraphoriaIgnored(path: string, rules: GraphoriaIgnoreRule[]): boolean {
  const p = normalizeGitPath(path);
  if (!p) return false;

  let ignored = false;
  for (const r of rules) {
    if (!r.re.test(p)) continue;
    ignored = !r.negated;
  }
  return ignored;
}

export function filterGraphoriaIgnoredEntries<T extends { path: string; old_path?: string | null }>(
  entries: T[],
  rules: GraphoriaIgnoreRule[],
): T[] {
  if (rules.length === 0) return entries;
  return entries.filter((e) => {
    const p = normalizeGitPath(e.path);
    const op = e.old_path ? normalizeGitPath(e.old_path) : "";
    return !isGraphoriaIgnored(p, rules) && (!op || !isGraphoriaIgnored(op, rules));
  });
}
