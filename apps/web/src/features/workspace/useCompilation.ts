import type { CompileEvent } from "@overleaf-pro/contracts";
import { useEffect, useRef, useState } from "react";
import { projectApi } from "./api.js";
import { BrowserCompiler } from "./browser-compiler.js";
import { savedProjectForHistory } from "./export.js";
import type { WorkspaceModel } from "./model.js";

type Success = Extract<CompileEvent, { type: "succeeded" }>;
type Message = Success["diagnostics"][number] & { key: string };
export type CompiledOutput = {
  event: Success;
  file: File;
  fingerprint: string;
};
export function useCompilation(model: WorkspaceModel, enabled: boolean) {
  const adapter = useRef<BrowserCompiler | undefined>(undefined);
  if (!adapter.current) adapter.current = new BrowserCompiler();
  const alive = useRef(true);
  const generation = useRef(0);
  const current = useRef("");
  const [output, setOutput] = useState<CompiledOutput>();
  const [state, setState] = useState("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [auto, setAuto] = useState(false);
  const fingerprint = JSON.stringify([
    model.project.mainFile,
    ...[...model.buffers.values()].map((f) => [
      f.base.id,
      f.base.path,
      f.content,
    ]),
    (model.project.assets ?? []).map((a) => [a.id, a.version, a.sha256]),
  ]);
  current.current = fingerprint;
  const compiling = ["saving", "loading", "queued", "running"].includes(state);
  const cancel = () => {
    generation.current++;
    adapter.current?.cancel();
    setState("cancelled");
  };
  const compile = async () => {
    const g = ++generation.current;
    adapter.current?.cancel();
    if (!enabled || !model.isActive) return;
    const source = current.current;
    setState("saving");
    setMessages([]);
    try {
      const project = await savedProjectForHistory(model);
      if (
        !alive.current ||
        g !== generation.current ||
        source !== current.current ||
        !model.isActive
      )
        return;
      const input = await projectApi.compileInput(project.id, project.revision);
      if (
        !alive.current ||
        g !== generation.current ||
        source !== current.current ||
        !model.isActive
      )
        return;
      await adapter.current?.compile(input, crypto.randomUUID(), (event) => {
        if (
          !alive.current ||
          g !== generation.current ||
          source !== current.current ||
          !model.isActive
        )
          return;
        setMessages(
          event.diagnostics.map((d) => ({ ...d, key: crypto.randomUUID() })),
        );
        if (event.type === "succeeded") {
          setState("succeeded");
          setOutput({
            event,
            fingerprint: source,
            file: new File(
              [new Uint8Array(event.pdf)],
              `project-r${event.revision}.pdf`,
              { type: "application/pdf" },
            ),
          });
        } else setState(event.state);
      });
    } catch (error) {
      if (alive.current && g === generation.current) {
        setState("failed");
        setMessages([
          {
            severity: "error",
            key: crypto.randomUUID(),
            message:
              error instanceof Error
                ? error.message
                : "Could not compile saved source",
          },
        ]);
      }
    }
  };
  const compileRef = useRef(compile);
  compileRef.current = compile;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      adapter.current?.dispose();
    };
  }, []);
  useEffect(() => {
    // Editing invalidates pending source and its late result immediately.
    void fingerprint;
    generation.current++;
    adapter.current?.cancel();
    setState((s) =>
      ["saving", "loading", "queued", "running"].includes(s) ? "cancelled" : s,
    );
    if (!enabled) {
      setOutput(undefined);
      setMessages([]);
    }
  }, [fingerprint, enabled]);
  useEffect(() => {
    void fingerprint;
    if (!auto || !enabled) return;
    const timer = setTimeout(() => {
      void compileRef.current();
    }, 1400);
    return () => clearTimeout(timer);
  }, [auto, enabled, fingerprint]);
  return {
    output,
    state,
    messages,
    auto,
    setAuto,
    compiling,
    compile,
    cancel,
    stale:
      !!output &&
      (output.fingerprint !== fingerprint ||
        ["failed", "timed-out"].includes(state)),
    clear: () => setOutput(undefined),
  };
}
