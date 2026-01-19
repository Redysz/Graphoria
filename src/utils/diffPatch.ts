function normalizeLf(s: string) {
  return s.replace(/\r\n/g, "\n");
}

export function computeHunkRanges(diffText: string) {
  const lines = normalizeLf(diffText).split("\n");
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("@@")) starts.push(i);
  }

  const ranges = starts.map((start, idx) => {
    const end = (starts[idx + 1] ?? lines.length) - 1;
    return { index: idx, header: lines[start], start, end };
  });
  const headerEnd = starts[0] ?? lines.length;
  return { lines, ranges, headerEnd };
}

export function buildPatchFromSelectedHunks(diffText: string, selected: Set<number>) {
  const { lines, ranges, headerEnd } = computeHunkRanges(diffText);
  if (ranges.length === 0) return "";
  if (selected.size === 0) return "";

  const out: string[] = [];
  out.push(...lines.slice(0, headerEnd));
  for (const r of ranges) {
    if (!selected.has(r.index)) continue;
    out.push(...lines.slice(r.start, r.end + 1));
  }

  const joined = out.join("\n");
  return joined.endsWith("\n") ? joined : `${joined}\n`;
}

export function buildPatchFromUnselectedHunks(diffText: string, selected: Set<number>) {
  const { ranges } = computeHunkRanges(diffText);
  if (ranges.length === 0) return "";

  const keep = new Set<number>();
  for (const r of ranges) {
    if (!selected.has(r.index)) keep.add(r.index);
  }
  return buildPatchFromSelectedHunks(diffText, keep);
}
