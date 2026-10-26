import {
  type AiProposal,
  type AiRequest,
  aiProposalSchema,
  type Project,
} from "@overleaf-pro/contracts";
import { useEffect, useRef, useState } from "react";
import { projectApi } from "../workspace/api.js";
import { containDialogFocus } from "../workspace/dialog.js";
import { changedFiles } from "../workspace/diff.js";
import { savedProjectForHistory } from "../workspace/export.js";
import type { WorkspaceModel } from "../workspace/model.js";
import { mutateSavedProject } from "../workspace/mutations.js";
import { assistanceRequest } from "./api.js";
import "./assistance.css";

export function Assistant({
  model,
  fileId,
  selection,
  onClose,
  initialDiagnostics,
}: {
  model: WorkspaceModel;
  fileId: string;
  selection: { from: number; to: number } | undefined;
  onClose: () => void;
  initialDiagnostics?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const [mode, setMode] = useState<AiRequest["mode"]>("explain");
  const [instruction, setInstruction] = useState("");
  const [diagnostics, setDiagnostics] = useState(initialDiagnostics ?? "");
  const [sharing, setSharing] = useState(false);
  const [fileIds, setFileIds] = useState([fileId]);
  const [proposal, setProposal] = useState<AiProposal>();
  const [base, setBase] = useState<Project>();
  const [recent, setRecent] = useState<AiProposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: A mounted dialog belongs to one fixed workspace model.
  useEffect(() => {
    alive.current = true;
    const before = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    void refresh().catch(() => {});
    return () => {
      alive.current = false;
      element?.close();
      if (before instanceof HTMLElement && before.isConnected) before.focus();
    };
  }, []);
  async function refresh() {
    const data = await assistanceRequest("ai-proposals");
    if (alive.current && model.isActive)
      setRecent(
        aiProposalSchema
          .array()
          .max(50)
          .parse(data)
          .filter((p) => p.projectId === model.project.id),
      );
  }
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (error) {
      if (alive.current)
        setMessage(
          error instanceof Error ? error.message : "Assistance unavailable.",
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const changes =
    base && proposal?.result && base.revision === proposal.baseRevision
      ? changedFiles(
          base.files,
          base.files.map((f) => ({
            ...f,
            content:
              proposal.result?.edits.find((e) => e.fileId === f.id)?.content ??
              f.content,
          })),
        )
      : [];
  return (
    <dialog
      onKeyDown={containDialogFocus}
      ref={dialog}
      className="history-dialog assistant-dialog"
      aria-labelledby="assistant-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <div className="history-heading">
        <h2 id="assistant-title">Writing assistant</h2>
        <button type="button" disabled={busy} onClick={onClose}>
          Close assistant
        </button>
      </div>
      <p>
        Review every change before applying. Accepted edits preserve a snapshot.
        Recompile accepted edits in the workspace to verify their PDF output.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            const current = await savedProjectForHistory(model);
            const requestId = crypto.randomUUID();
            setBase(current);
            setProposal(undefined);
            setMessage(
              `Request ${requestId} is running. If interrupted, check recent requests.`,
            );
            const result = aiProposalSchema.parse(
              await assistanceRequest("ai-proposals", "POST", {
                requestId,
                projectId: current.id,
                baseRevision: current.revision,
                mode,
                instruction,
                fileIds,
                diagnostics,
                shareWithProvider: sharing,
                ...(selection && fileIds.includes(fileId)
                  ? { selection: { fileId, ...selection } }
                  : {}),
              }),
            );
            if (!alive.current || !model.isActive) return;
            setProposal(result);
            setMessage("");
            await refresh();
          });
        }}
      >
        <label>
          Task{" "}
          <select
            aria-label="Task"
            value={mode}
            disabled={busy}
            onChange={(e) => setMode(e.target.value as AiRequest["mode"])}
          >
            <option value="explain">Explain selected code</option>
            <option value="rewrite">Rewrite</option>
            <option value="generate">Generate LaTeX</option>
            <option value="question">Project question</option>
            <option value="diagnostic">Explain compiler diagnostic</option>
          </select>
        </label>
        <fieldset disabled={busy}>
          <legend>Source shared with the provider (up to four files)</legend>
          {[...model.buffers.values()].map((f) => (
            <label className="check-label" key={f.base.id}>
              <input
                type="checkbox"
                checked={fileIds.includes(f.base.id)}
                onChange={(e) =>
                  setFileIds((ids) =>
                    e.target.checked
                      ? [...ids, f.base.id].slice(0, 4)
                      : ids.filter((id) => id !== f.base.id),
                  )
                }
              />
              {f.base.path}
            </label>
          ))}
        </fieldset>
        {selection && (
          <p>
            Selection: characters {selection.from + 1}–{selection.to} in the
            active file. Selected rewrites preserve surrounding text.
          </p>
        )}
        <label>
          Instruction
          <textarea
            aria-label="Instruction"
            required
            maxLength={2000}
            value={instruction}
            disabled={busy}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </label>
        {mode === "diagnostic" && (
          <label>
            Diagnostic text (optional, up to 4000 characters)
            <textarea
              aria-label="Diagnostic text (optional, up to 4000 characters)"
              value={diagnostics}
              maxLength={4000}
              disabled={busy}
              onChange={(e) => setDiagnostics(e.target.value)}
            />
          </label>
        )}
        <p>
          Requests send the checked saved files, selection, instruction, and
          supplied diagnostics to Groq. Groq may retain content for
          reliability/abuse investigations for up to 30 days unless its account
          data controls opt out. Requests and outputs remain in your private
          assistance history until deleted.{" "}
          <a
            href="https://console.groq.com/docs/your-data"
            target="_blank"
            rel="noreferrer"
          >
            Provider data policy
          </a>
        </p>
        <label className="check-label">
          <input
            type="checkbox"
            checked={sharing}
            disabled={busy}
            onChange={(e) => setSharing(e.target.checked)}
          />
          Share this context with the configured provider
        </label>
        <button type="submit" disabled={busy || !sharing || !fileIds.length}>
          Request assistance
        </button>
      </form>
      <p role="status">{message}</p>
      {proposal && (
        <section aria-label="AI proposal">
          <h3>
            {proposal.status} · {proposal.model}
          </h3>
          <p className="preserve-whitespace">
            {proposal.result?.answer ??
              proposal.failure ??
              "Pending; use Check request after 30 seconds to detect interruption."}
          </p>
          <small>
            Request {proposal.id} · {proposal.promptVersion}
            {proposal.usage
              ? ` · ${proposal.usage.inputTokens} input / ${proposal.usage.outputTokens} output tokens`
              : ""}
          </small>
          {changes.map((change) => (
            <div key={change.path}>
              <h4>{change.path}</h4>
              <pre className="source-diff">{change.diff}</pre>
            </div>
          ))}
          {proposal.status === "ready" && (
            <>
              <p>
                Minus lines are current source; plus lines are proposed. All
                edits apply together. Confirm factual accuracy before accepting.
              </p>
              <button
                type="button"
                disabled={
                  busy ||
                  !proposal.result?.edits.length ||
                  base?.revision !== proposal.baseRevision
                }
                onClick={() =>
                  void run(async () => {
                    await mutateSavedProject(model, async (current) => {
                      if (current.revision !== proposal.baseRevision)
                        throw new Error(
                          "This proposal is stale. Request new assistance.",
                        );
                      aiProposalSchema.parse(
                        await assistanceRequest(
                          `ai-proposals/${proposal.id}/apply`,
                          "POST",
                          {},
                        ),
                      );
                      return projectApi.get(model.project.id);
                    });
                    if (alive.current && model.isActive) onClose();
                  })
                }
              >
                Apply all proposed edits
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = aiProposalSchema.parse(
                      await assistanceRequest(
                        `ai-proposals/${proposal.id}/reject`,
                        "POST",
                        {},
                      ),
                    );
                    if (alive.current) setProposal(result);
                    await refresh();
                  })
                }
              >
                Reject proposal
              </button>
            </>
          )}
          {proposal.status === "applied" && (
            <>
              <p>
                Changes applied at revision {proposal.appliedRevision}.
                Recompile from the workspace to verify the changes. Restore is
                allowed only while that revision is still current.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await mutateSavedProject(model, async (current) => {
                      if (
                        current.revision !== proposal.appliedRevision ||
                        !proposal.backupSnapshotId
                      )
                        throw new Error(
                          "Later work exists. Use History to compare and restore deliberately.",
                        );
                      return projectApi.restore(
                        model.project.id,
                        proposal.backupSnapshotId,
                        current.revision,
                      );
                    });
                    if (alive.current && model.isActive) onClose();
                  })
                }
              >
                Restore before these edits
              </button>
            </>
          )}
        </section>
      )}
      <div className="history-heading">
        <h3>Recent requests</h3>
        <button type="button" disabled={busy} onClick={() => void run(refresh)}>
          Refresh requests
        </button>
      </div>
      <ul className="history-list">
        {recent.map((item) => (
          <li key={item.id}>
            <span>
              r{item.baseRevision} · {item.status} ·{" "}
              {new Date(item.createdAt).toLocaleString()}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const current = await savedProjectForHistory(model);
                  const loaded = aiProposalSchema.parse(
                    await assistanceRequest(`ai-proposals/${item.id}`),
                  );
                  if (alive.current) {
                    setBase(current);
                    setProposal(loaded);
                    if (
                      current.revision !== loaded.baseRevision &&
                      loaded.status === "ready"
                    )
                      setMessage(
                        "Project changed. This proposal is stale and cannot be applied.",
                      );
                  }
                  await refresh();
                })
              }
            >
              Check request
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await assistanceRequest(`ai-proposals/${item.id}`, "DELETE");
                  if (proposal?.id === item.id) setProposal(undefined);
                  await refresh();
                })
              }
            >
              Delete request
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}
