import type { SourceFile } from "@overleaf-pro/contracts";

// A bounded, linear comparison: one changed block between shared prefix/suffix.
// Repeated/interleaved edits may form a larger block; this is not a minimal diff.
export function sourceDiff(before: string, after: string) {
  if (before === after) return "No source changes.";
  const oldLines = before.split("\n");
  const newLines = after.split("\n");
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  )
    start++;
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (
    endOld > start &&
    endNew > start &&
    oldLines[endOld - 1] === newLines[endNew - 1]
  ) {
    endOld--;
    endNew--;
  }
  return [
    `@@ -${start + 1},${endOld - start} +${start + 1},${endNew - start} @@`,
    ...oldLines.slice(start, endOld).map((line) => `- ${line}`),
    ...newLines.slice(start, endNew).map((line) => `+ ${line}`),
  ].join("\n");
}

export function changedFiles(before: SourceFile[], after: SourceFile[]) {
  const paths = [
    ...new Set([...before, ...after].map((file) => file.path)),
  ].sort();
  return paths.flatMap((path) => {
    const oldFile = before.find((file) => file.path === path);
    const newFile = after.find((file) => file.path === path);
    return oldFile?.content === newFile?.content
      ? []
      : [
          {
            path,
            kind: !oldFile ? "added" : !newFile ? "removed" : "changed",
            diff: sourceDiff(oldFile?.content ?? "", newFile?.content ?? ""),
          },
        ];
  });
}
