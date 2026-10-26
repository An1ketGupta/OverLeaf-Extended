export function downloadText(content: string, path: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = path.split("/").pop() ?? "draft.tex";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
