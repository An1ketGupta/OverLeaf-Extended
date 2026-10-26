import type { LocalDraft } from "@overleaf-pro/contracts";
import { useEffect, useState } from "react";
import { getSession } from "../../api.js";
import { downloadText } from "./download.js";
import { onLogout, onSessionChange, removeDraft } from "./drafts.js";
export function OrphanDrafts({
  drafts,
  onDiscard,
}: {
  drafts: LocalDraft[];
  onDiscard: (id: string) => void;
}) {
  const userId = drafts[0]?.userId;
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let alive = true;
    const validate = () => {
      setAllowed(false);
      void getSession()
        .then((session) => {
          if (alive) setAllowed(!!session && session.user.id === userId);
        })
        .catch(() => {});
    };
    validate();
    const logout = onLogout(() => setAllowed(false)),
      session = onSessionChange(validate);
    window.addEventListener("focus", validate);
    document.addEventListener("visibilitychange", validate);
    return () => {
      alive = false;
      logout();
      session();
      window.removeEventListener("focus", validate);
      document.removeEventListener("visibilitychange", validate);
    };
  }, [userId]);
  if (!drafts.length || !allowed) return null;
  return (
    <section className="workspace-notice" aria-label="Unavailable file drafts">
      <h2>Drafts from unavailable files</h2>
      <p>
        These private recovery copies remain in this tab. Download them before
        discarding or signing out. Deleted files cannot be saved back to their
        old IDs.
      </p>
      {drafts.map((draft) => (
        <div className="inline-actions" key={draft.fileId}>
          <span>Draft {draft.fileId.slice(0, 8)}</span>
          <button
            type="button"
            onClick={() =>
              downloadText(draft.content, `recovered-${draft.fileId}.tex`)
            }
          >
            Download recovered draft
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Discard this recovery draft? Download a copy first.",
                )
              ) {
                removeDraft(draft);
                onDiscard(draft.fileId);
              }
            }}
          >
            Discard recovered draft
          </button>
        </div>
      ))}
    </section>
  );
}
