import type { CompileEvent, CompileRequest } from "@overleaf-pro/contracts";

// The implementation is supplied by Part 3 only after the Part 0A execution gate.
export interface CompilerAdapter {
  readonly availability: "available" | "unavailable";
  readonly reason: string;
  send(request: CompileRequest, receive: (event: CompileEvent) => void): void;
  dispose(): void;
}

export const pendingCompiler: CompilerAdapter = {
  availability: "unavailable",
  reason:
    "Compilation is not available yet. You can still write and save your source.",
  send() {
    throw new Error("Compiler feasibility gate is open");
  },
  dispose() {},
};
