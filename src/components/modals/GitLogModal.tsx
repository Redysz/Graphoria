import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

interface GitCommit {
  hash: string;
  parents: string[];
  author: string;
  author_email: string;
  date: string;
  subject: string;
  refs: string;
  is_head: boolean;
}

interface GitLogSearchParams {
  authors?: string[];
  since?: string;
  until?: string;
  grep?: string;
  grep_all_match?: boolean;
  invert_grep?: boolean;
  paths?: string[];
  max_count?: number;
  skip?: number;
  merges_only?: boolean;
  no_merges?: boolean;
  first_parent?: boolean;
  all?: boolean;
  reverse?: boolean;
  diff_filter?: string;
  min_parents?: number;
  max_parents?: number;
  branches?: string;
  tags?: string;
  remotes?: boolean;
  follow?: boolean;
  regexp_ignore_case?: boolean;
  fixed_strings?: boolean;
  ancestry_path?: boolean;
  simplify_by_decoration?: boolean;
}

type Props = {
  repoPath: string;
  onClose: () => void;
  onShowOnGraph: (hash: string) => void;
  onShowOnCommits: (hash: string) => void;
};

export function GitLogModal({ repoPath, onClose, onShowOnGraph, onShowOnCommits }: Props) {
  // --- filter state ---
  const [authors, setAuthors] = useState<string[]>([""]);
  const [enableAuthors, setEnableAuthors] = useState(false);

  const [enableSince, setEnableSince] = useState(false);
  const [since, setSince] = useState("");
  const [enableUntil, setEnableUntil] = useState(false);
  const [until, setUntil] = useState("");

  const [enableGrep, setEnableGrep] = useState(false);
  const [grep, setGrep] = useState("");
  const [grepAllMatch, setGrepAllMatch] = useState(false);
  const [invertGrep, setInvertGrep] = useState(false);
  const [regexpIgnoreCase, setRegexpIgnoreCase] = useState(false);
  const [fixedStrings, setFixedStrings] = useState(false);

  const [enablePaths, setEnablePaths] = useState(false);
  const [paths, setPaths] = useState<string[]>([""]);
  const [follow, setFollow] = useState(false);

  const [maxCount, setMaxCount] = useState(500);
  const [enableSkip, setEnableSkip] = useState(false);
  const [skip, setSkip] = useState(0);

  const [mergesOnly, setMergesOnly] = useState(false);
  const [noMerges, setNoMerges] = useState(false);
  const [firstParent, setFirstParent] = useState(false);
  const [all, setAll] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [ancestryPath, setAncestryPath] = useState(false);
  const [simplifyByDecoration, setSimplifyByDecoration] = useState(false);
  const [remotes, setRemotes] = useState(false);

  const [enableDiffFilter, setEnableDiffFilter] = useState(false);
  const [diffFilter, setDiffFilter] = useState("");

  const [enableBranches, setEnableBranches] = useState(false);
  const [branchesPattern, setBranchesPattern] = useState("");
  const [enableTags, setEnableTags] = useState(false);
  const [tagsPattern, setTagsPattern] = useState("");

  // --- results ---
  const [results, setResults] = useState<GitCommit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  // --- export ---
  const [exportOpen, setExportOpen] = useState(false);
  const [exportIncludeRefs, setExportIncludeRefs] = useState(true);

  const runSearch = useCallback(async () => {
    setBusy(true);
    setError("");
    setHasSearched(true);
    try {
      const params: GitLogSearchParams = {
        max_count: maxCount > 0 ? maxCount : undefined,
      };

      if (enableAuthors) {
        const a = authors.map((s) => s.trim()).filter(Boolean);
        if (a.length > 0) params.authors = a;
      }
      if (enableSince && since.trim()) params.since = since.trim();
      if (enableUntil && until.trim()) params.until = until.trim();
      if (enableGrep && grep.trim()) {
        params.grep = grep.trim();
        if (grepAllMatch) params.grep_all_match = true;
        if (invertGrep) params.invert_grep = true;
        if (regexpIgnoreCase) params.regexp_ignore_case = true;
        if (fixedStrings) params.fixed_strings = true;
      }
      if (enablePaths) {
        const p = paths.map((s) => s.trim()).filter(Boolean);
        if (p.length > 0) {
          params.paths = p;
          if (follow) params.follow = true;
        }
      }
      if (enableSkip && skip > 0) params.skip = skip;
      if (mergesOnly) params.merges_only = true;
      if (noMerges) params.no_merges = true;
      if (firstParent) params.first_parent = true;
      if (all) params.all = true;
      if (reverse) params.reverse = true;
      if (ancestryPath) params.ancestry_path = true;
      if (simplifyByDecoration) params.simplify_by_decoration = true;
      if (remotes) params.remotes = true;
      if (enableDiffFilter && diffFilter.trim()) params.diff_filter = diffFilter.trim();
      if (enableBranches) params.branches = branchesPattern.trim();
      if (enableTags) params.tags = tagsPattern.trim();

      const commits = await invoke<GitCommit[]>("git_log_search", {
        repoPath,
        params,
      });
      setResults(commits);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setResults([]);
    } finally {
      setBusy(false);
    }
  }, [
    repoPath, maxCount, enableAuthors, authors, enableSince, since, enableUntil, until,
    enableGrep, grep, grepAllMatch, invertGrep, regexpIgnoreCase, fixedStrings,
    enablePaths, paths, follow, enableSkip, skip,
    mergesOnly, noMerges, firstParent, all, reverse, ancestryPath, simplifyByDecoration,
    remotes, enableDiffFilter, diffFilter, enableBranches, branchesPattern, enableTags, tagsPattern,
  ]);

  function formatDate(iso: string) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return iso;
    }
  }

  function buildExportLines() {
    return results.map((c) => ({
      hash: c.hash,
      shortHash: c.hash.slice(0, 8),
      author: c.author,
      date: formatDate(c.date),
      subject: c.subject,
      refs: c.refs,
    }));
  }

  async function exportTxt() {
    setExportOpen(false);
    const lines = buildExportLines();
    const text = lines
      .map((l) => `${l.shortHash}  ${l.date}  ${l.author}  ${l.subject}${exportIncludeRefs && l.refs ? `  (${l.refs})` : ""}`)
      .join("\n");
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: "git-log.txt", filters: [{ name: "Text", extensions: ["txt"] }] });
      if (path) {
        await invoke("write_text_file", { path, content: text });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportHtml() {
    setExportOpen(false);
    const lines = buildExportLines();
    const rows = lines
      .map(
        (l) =>
          `<tr><td style="font-family:monospace;opacity:0.6">${esc(l.shortHash)}</td><td>${esc(l.date)}</td><td>${esc(l.author)}</td>${exportIncludeRefs ? `<td>${l.refs ? esc(l.refs) : ""}</td>` : ""}<td>${esc(l.subject)}</td></tr>`,
      )
      .join("\n");
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Git Log</title>
<style>body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:6px 12px;border-bottom:1px solid #ddd}th{background:#f5f5f5;font-weight:700}</style>
</head><body>
<h2>Git Log &mdash; ${esc(repoPath)}</h2>
<p>${lines.length} commit(s)</p>
<table><thead><tr><th>Hash</th><th>Date</th><th>Author</th>${exportIncludeRefs ? "<th>Refs</th>" : ""}<th>Subject</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: "git-log.html", filters: [{ name: "HTML", extensions: ["html"] }] });
      if (path) {
        await invoke("write_text_file", { path, content: html });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportPdf() {
    setExportOpen(false);
    const lines = buildExportLines();
    try {
      const jsPDFMod = await import("jspdf");
      const autoTableMod = await import("jspdf-autotable");
      const jsPDF = jsPDFMod.default;
      const autoTable = autoTableMod.default;
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      doc.setFontSize(14);
      doc.text("Git Log", 14, 14);
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(repoPath, 14, 20);
      doc.text(`${lines.length} commit(s)`, 14, 25);
      doc.setTextColor(0);

      autoTable(doc, {
        startY: 30,
        head: [exportIncludeRefs ? ["Hash", "Date", "Author", "Refs", "Subject"] : ["Hash", "Date", "Author", "Subject"]],
        body: lines.map((l) => exportIncludeRefs
          ? [l.shortHash, l.date, l.author, l.refs || "", l.subject]
          : [l.shortHash, l.date, l.author, l.subject],
        ),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [55, 55, 65], fontSize: 8 },
        columnStyles: exportIncludeRefs
          ? { 0: { cellWidth: 22, font: "courier" }, 1: { cellWidth: 42 }, 2: { cellWidth: 35 }, 3: { cellWidth: 40 }, 4: { cellWidth: "auto" } }
          : { 0: { cellWidth: 22, font: "courier" }, 1: { cellWidth: 42 }, 2: { cellWidth: 35 }, 3: { cellWidth: "auto" } },
        margin: { left: 14, right: 14 },
      });

      const pdfBlob = doc.output("arraybuffer");
      const bytes = new Uint8Array(pdfBlob);

      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({ defaultPath: "git-log.pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (path) {
        await invoke("write_binary_file", { path, data: Array.from(bytes) });
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function esc(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal gitLogModal">
        <div className="modalHeader">
          <div style={{ fontWeight: 900 }}>Git Log</div>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        <div className="modalBody" style={{ display: "grid", gap: 12 }}>
          {error ? <div className="error">{error}</div> : null}

          <div className="gitLogFilters">
            {/* Authors */}
            <div className="gitLogSection">
              <div className="gitLogRow">
                <label>
                  <input type="checkbox" checked={enableAuthors} onChange={(e) => setEnableAuthors(e.target.checked)} />
                  <span className="gitLogSectionTitle" style={{ margin: 0 }}>Author filter</span>
                </label>
              </div>
              {enableAuthors ? (
                <div className="gitLogAuthors">
                  {authors.map((a, i) => (
                    <div className="gitLogAuthorRow" key={i}>
                      <input
                        type="text"
                        value={a}
                        onChange={(e) => {
                          const next = [...authors];
                          next[i] = e.target.value;
                          setAuthors(next);
                        }}
                        placeholder="Author name or email pattern"
                      />
                      {authors.length > 1 ? (
                        <button type="button" onClick={() => setAuthors(authors.filter((_, j) => j !== i))} title="Remove">
                          &minus;
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <div>
                    <button type="button" className="gitLogAddBtn" onClick={() => setAuthors([...authors, ""])}>
                      + Add author
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Date range */}
            <div className="gitLogSection">
              <div className="gitLogRow">
                <label>
                  <input type="checkbox" checked={enableSince} onChange={(e) => setEnableSince(e.target.checked)} />
                  Since
                </label>
                {enableSince ? (
                  <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
                ) : null}
                <label>
                  <input type="checkbox" checked={enableUntil} onChange={(e) => setEnableUntil(e.target.checked)} />
                  Until
                </label>
                {enableUntil ? (
                  <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
                ) : null}
              </div>
            </div>

            {/* Grep */}
            <div className="gitLogSection">
              <div className="gitLogRow">
                <label>
                  <input type="checkbox" checked={enableGrep} onChange={(e) => setEnableGrep(e.target.checked)} />
                  <span className="gitLogSectionTitle" style={{ margin: 0 }}>Message search (--grep)</span>
                </label>
              </div>
              {enableGrep ? (
                <>
                  <div className="gitLogRow">
                    <input
                      type="text"
                      className="gitLogWideInput"
                      value={grep}
                      onChange={(e) => setGrep(e.target.value)}
                      placeholder="Search pattern in commit message"
                    />
                  </div>
                  <div className="gitLogRow">
                    <label>
                      <input type="checkbox" checked={fixedStrings} onChange={(e) => setFixedStrings(e.target.checked)} />
                      Fixed strings (literal)
                    </label>
                    <label>
                      <input type="checkbox" checked={regexpIgnoreCase} onChange={(e) => setRegexpIgnoreCase(e.target.checked)} />
                      Ignore case
                    </label>
                    <label>
                      <input type="checkbox" checked={invertGrep} onChange={(e) => setInvertGrep(e.target.checked)} />
                      Invert match
                    </label>
                    <label>
                      <input type="checkbox" checked={grepAllMatch} onChange={(e) => setGrepAllMatch(e.target.checked)} />
                      All match (AND)
                    </label>
                  </div>
                </>
              ) : null}
            </div>

            {/* Paths */}
            <div className="gitLogSection">
              <div className="gitLogRow">
                <label>
                  <input type="checkbox" checked={enablePaths} onChange={(e) => setEnablePaths(e.target.checked)} />
                  <span className="gitLogSectionTitle" style={{ margin: 0 }}>File paths</span>
                </label>
              </div>
              {enablePaths ? (
                <div className="gitLogPaths">
                  {paths.map((p, i) => (
                    <div className="gitLogPathRow" key={i}>
                      <input
                        type="text"
                        value={p}
                        onChange={(e) => {
                          const next = [...paths];
                          next[i] = e.target.value;
                          setPaths(next);
                        }}
                        placeholder="Relative path, e.g. src/main.rs"
                      />
                      {paths.length > 1 ? (
                        <button type="button" onClick={() => setPaths(paths.filter((_, j) => j !== i))} title="Remove">
                          &minus;
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <button type="button" className="gitLogAddBtn" onClick={() => setPaths([...paths, ""])}>
                      + Add path
                    </button>
                    <label>
                      <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                      --follow (track renames)
                    </label>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="gitLogSep" />

            {/* Common flags */}
            <div className="gitLogSection">
              <div className="gitLogSectionTitle">Flags</div>
              <div className="gitLogRow">
                <label><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> --all</label>
                <label><input type="checkbox" checked={mergesOnly} onChange={(e) => { setMergesOnly(e.target.checked); if (e.target.checked) setNoMerges(false); }} /> --merges</label>
                <label><input type="checkbox" checked={noMerges} onChange={(e) => { setNoMerges(e.target.checked); if (e.target.checked) setMergesOnly(false); }} /> --no-merges</label>
                <label><input type="checkbox" checked={firstParent} onChange={(e) => setFirstParent(e.target.checked)} /> --first-parent</label>
                <label><input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> --reverse (oldest first)</label>
              </div>
              <div className="gitLogRow">
                <label><input type="checkbox" checked={ancestryPath} onChange={(e) => setAncestryPath(e.target.checked)} /> --ancestry-path</label>
                <label><input type="checkbox" checked={simplifyByDecoration} onChange={(e) => setSimplifyByDecoration(e.target.checked)} /> --simplify-by-decoration</label>
                <label><input type="checkbox" checked={remotes} onChange={(e) => setRemotes(e.target.checked)} /> --remotes</label>
              </div>
            </div>

            {/* Branches / Tags */}
            <div className="gitLogSection">
              <div className="gitLogRow">
                <label>
                  <input type="checkbox" checked={enableBranches} onChange={(e) => setEnableBranches(e.target.checked)} />
                  --branches
                </label>
                {enableBranches ? (
                  <input
                    type="text"
                    className="gitLogInlineInput"
                    value={branchesPattern}
                    onChange={(e) => setBranchesPattern(e.target.value)}
                    placeholder="glob pattern (optional)"
                  />
                ) : null}
                <label>
                  <input type="checkbox" checked={enableTags} onChange={(e) => setEnableTags(e.target.checked)} />
                  --tags
                </label>
                {enableTags ? (
                  <input
                    type="text"
                    className="gitLogInlineInput"
                    value={tagsPattern}
                    onChange={(e) => setTagsPattern(e.target.value)}
                    placeholder="glob pattern (optional)"
                  />
                ) : null}
              </div>
            </div>

            {/* Diff filter */}
            <div className="gitLogSection">
              <div className="gitLogRow">
                <label>
                  <input type="checkbox" checked={enableDiffFilter} onChange={(e) => setEnableDiffFilter(e.target.checked)} />
                  --diff-filter
                </label>
                {enableDiffFilter ? (
                  <input
                    type="text"
                    className="gitLogInlineInput"
                    value={diffFilter}
                    onChange={(e) => setDiffFilter(e.target.value)}
                    placeholder="e.g. ACDMR"
                    title="A=Added, C=Copied, D=Deleted, M=Modified, R=Renamed, T=Type changed"
                    style={{ maxWidth: 120 }}
                  />
                ) : null}
              </div>
            </div>

            {/* Limits */}
            <div className="gitLogSection">
              <div className="gitLogSectionTitle">Limits</div>
              <div className="gitLogRow">
                <label>Max commits:</label>
                <input
                  type="number"
                  value={maxCount}
                  onChange={(e) => setMaxCount(Math.max(0, parseInt(e.target.value) || 0))}
                  min={0}
                  style={{ width: 80 }}
                  title="0 = unlimited"
                />
                <label>
                  <input type="checkbox" checked={enableSkip} onChange={(e) => setEnableSkip(e.target.checked)} />
                  --skip
                </label>
                {enableSkip ? (
                  <input
                    type="number"
                    value={skip}
                    onChange={(e) => setSkip(Math.max(0, parseInt(e.target.value) || 0))}
                    min={0}
                    style={{ width: 80 }}
                  />
                ) : null}
              </div>
            </div>
          </div>

          {/* Results */}
          {hasSearched ? (
            <div className="gitLogResults">
              <div className="gitLogResultsHeader">
                <span>{busy ? "Searching..." : `${results.length} commit(s) found`}</span>
                {results.length > 0 ? (
                  <div className="gitLogResultsActions">
                    <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5 }}>
                      <input type="checkbox" checked={exportIncludeRefs} onChange={(e) => setExportIncludeRefs(e.target.checked)} />
                      Include refs/branch column
                    </label>
                    <div className="gitLogExportMenu">
                      <button type="button" onClick={() => setExportOpen((v) => !v)}>
                        Export &#9662;
                      </button>
                      {exportOpen ? (
                        <div className="gitLogExportDropdown">
                          <button type="button" onClick={() => void exportTxt()}>Export as TXT</button>
                          <button type="button" onClick={() => void exportHtml()}>Export as HTML</button>
                          <button type="button" onClick={() => void exportPdf()}>Export as PDF</button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              {results.length > 0 ? (
                <div className="gitLogResultsList">
                  {results.map((c) => (
                    <div className="gitLogResultItem" key={c.hash}>
                      <div className="gitLogResultInfo">
                        <div className="gitLogResultSubject">
                          {c.subject}
                          {c.refs ? <span style={{ opacity: 0.5, fontWeight: 400, marginLeft: 6 }}>({c.refs})</span> : null}
                        </div>
                        <div className="gitLogResultMeta">
                          <span className="gitLogResultHash">{c.hash.slice(0, 8)}</span>
                          {" "}&middot;{" "}
                          {c.author}
                          {" "}&middot;{" "}
                          {formatDate(c.date)}
                        </div>
                      </div>
                      <div className="gitLogResultBtns">
                        <button type="button" onClick={() => onShowOnGraph(c.hash)} title="Show on Graph view">
                          Graph
                        </button>
                        <button type="button" onClick={() => onShowOnCommits(c.hash)} title="Show on Commits view">
                          Commits
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : !busy ? (
                <div className="gitLogEmpty">No commits match the current filters.</div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="modalFooter">
          <button type="button" onClick={() => void runSearch()} disabled={busy || !repoPath}>
            {busy ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span className="miniSpinner" />
                Searching...
              </span>
            ) : (
              "Search"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
