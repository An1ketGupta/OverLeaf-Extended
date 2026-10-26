import { type LocalDraft, localDraftSchema } from "@overleaf-pro/contracts";

const prefix = "overleaf-pro:draft:";
const logoutKey = "overleaf-pro:logout";
const maxAge = 24 * 60 * 60 * 1000;
const key = (draft: Pick<LocalDraft, "userId" | "projectId" | "fileId">) =>
  `${prefix}${encodeURIComponent(draft.userId)}:${draft.projectId}:${draft.fileId}`;

export function writeDraft(draft: LocalDraft) {
  try {
    sessionStorage.setItem(
      key(draft),
      JSON.stringify(localDraftSchema.parse(draft)),
    );
    return true;
  } catch {
    return false;
  }
}
export function removeDraft(
  draft: Pick<LocalDraft, "userId" | "projectId" | "fileId">,
) {
  try {
    sessionStorage.removeItem(key(draft));
  } catch {
    /* Storage can be disabled. The UI already discloses recovery failures. */
  }
}
export function readDrafts(userId: string, projectId: string) {
  const drafts: LocalDraft[] = [];
  let loggedOutAt = 0;
  try {
    loggedOutAt = Number(localStorage.getItem(logoutKey)?.split(":")[0]) || 0;
  } catch {
    /* Live logout broadcasts still clear open tabs. */
  }
  try {
    for (const item of Object.keys(sessionStorage).filter((item) =>
      item.startsWith(prefix),
    )) {
      let value: unknown;
      try {
        value = JSON.parse(sessionStorage.getItem(item) ?? "null");
      } catch {
        sessionStorage.removeItem(item);
        continue;
      }
      const parsed = localDraftSchema.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.userId !== userId ||
        parsed.data.savedAt <= loggedOutAt ||
        Date.now() - parsed.data.savedAt > maxAge ||
        parsed.data.savedAt > Date.now() + 60_000
      ) {
        sessionStorage.removeItem(item);
        continue;
      }
      if (parsed.data.projectId === projectId) drafts.push(parsed.data);
    }
  } catch {
    /* A storage failure is surfaced by the next write. */
  }
  return drafts;
}
export function clearPrivateDrafts() {
  try {
    for (const item of Object.keys(sessionStorage))
      if (item.startsWith(prefix)) sessionStorage.removeItem(item);
  } catch {
    /* No writable storage. */
  }
}
export function clearMismatchedDrafts(userId: string) {
  readDrafts(userId, "");
}
export function removeProjectDrafts(userId: string, projectId: string) {
  for (const draft of readDrafts(userId, projectId)) removeDraft(draft);
}
export function allDrafts(userId: string) {
  // Reuse expiry, logout and identity checks for the account's orphan recovery list.
  const result: LocalDraft[] = [];
  try {
    const projects = new Set<string>();
    for (const item of Object.keys(sessionStorage).filter((item) =>
      item.startsWith(prefix),
    )) {
      try {
        const parsed = localDraftSchema.safeParse(
          JSON.parse(sessionStorage.getItem(item) ?? "null"),
        );
        if (parsed.success) projects.add(parsed.data.projectId);
      } catch {
        /* Invalid records are removed by readDrafts. */
      }
    }
    for (const project of projects) result.push(...readDrafts(userId, project));
  } catch {
    /* Recovery is best effort. */
  }
  return result;
}
const sessionChannel = "overleaf-pro:session-change";
export function announceSessionChange() {
  window.dispatchEvent(new Event(sessionChannel));
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(sessionChannel);
  channel?.postMessage("changed");
  channel?.close();
  try {
    localStorage.setItem(
      sessionChannel,
      `${Date.now()}:${crypto.randomUUID()}`,
    );
  } catch {
    /* Broadcast fallback. */
  }
}
export function onSessionChange(callback: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === sessionChannel) callback();
  };
  window.addEventListener(sessionChannel, callback);
  window.addEventListener("storage", storage);
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(sessionChannel);
  if (channel) channel.onmessage = callback;
  return () => {
    window.removeEventListener(sessionChannel, callback);
    window.removeEventListener("storage", storage);
    channel?.close();
  };
}
export function announceLogout() {
  clearPrivateDrafts();
  window.dispatchEvent(new Event("workspace-logout"));
  try {
    localStorage.setItem(logoutKey, `${Date.now()}:${crypto.randomUUID()}`);
  } catch {
    /* BroadcastChannel also covers tabs when storage is blocked. */
  }
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(logoutKey);
  channel?.postMessage("logout");
  channel?.close();
}
export function onLogout(callback: () => void) {
  const clear = () => {
    clearPrivateDrafts();
    callback();
  };
  const storage = (event: StorageEvent) => {
    if (event.key === logoutKey) clear();
  };
  window.addEventListener("workspace-logout", clear);
  window.addEventListener("storage", storage);
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(logoutKey);
  if (channel) channel.onmessage = clear;
  return () => {
    window.removeEventListener("workspace-logout", clear);
    window.removeEventListener("storage", storage);
    channel?.close();
  };
}
