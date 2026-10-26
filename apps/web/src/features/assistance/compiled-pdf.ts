import { onLogout } from "../workspace/drafts.js";

let pending:
  | { file: File; revision: number; projectId: string; pdfSha256: string }
  | undefined;
onLogout(() => {
  pending = undefined;
});
export function analyzeCompiledPdf(input: NonNullable<typeof pending>) {
  pending = input;
}
export function takeCompiledPdf() {
  const value = pending;
  pending = undefined;
  return value;
}
