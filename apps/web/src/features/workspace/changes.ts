import { resourceIdSchema } from "@overleaf-pro/contracts";

const key = "overleaf-pro:project-change";
export function announceProjectChange(id: string) {
  if (!resourceIdSchema.safeParse(id).success) return;
  const channel =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(key);
  channel?.postMessage(id);
  channel?.close();
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ id, nonce: crypto.randomUUID() }),
    );
  } catch {
    /* Active-tab broadcasts still work. */
  }
}
export function onProjectChange(callback: (id: string) => void) {
  const receive = (id: unknown) => {
    const parsed = resourceIdSchema.safeParse(id);
    if (parsed.success) callback(parsed.data);
  };
  const storage = (event: StorageEvent) => {
    if (event.key === key) {
      try {
        receive(JSON.parse(event.newValue ?? "null")?.id);
      } catch {
        /* Ignore malformed signals. */
      }
    }
  };
  window.addEventListener("storage", storage);
  const channel =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(key);
  if (channel) channel.onmessage = (event) => receive(event.data);
  return () => {
    window.removeEventListener("storage", storage);
    channel?.close();
  };
}
