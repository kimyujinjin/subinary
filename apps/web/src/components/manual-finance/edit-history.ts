const MARKER = "__familyManualEditor";

interface HistoryPort {
  history: {
    readonly state: unknown;
    pushState(data: unknown, unused: string, url?: string | URL | null): void;
    replaceState(
      data: unknown,
      unused: string,
      url?: string | URL | null
    ): void;
    back(): void;
  };
  location: { readonly href: string };
  addEventListener(type: "popstate", listener: EventListener): void;
  removeEventListener(type: "popstate", listener: EventListener): void;
}
const objectState = (state: unknown): Record<string, unknown> =>
  state && typeof state === "object" && !Array.isArray(state)
    ? { ...state }
    : {};
const markerOf = (state: unknown) =>
  objectState(state)[MARKER] as { id?: unknown; url?: unknown } | undefined;

/**
 * One same-route entry closes an editor before leaving the page. Restoring that
 * entry replaces its forward copy, so rejecting repeated Back presses cannot
 * grow history. A different route is never rewritten or trapped.
 */
export function createManualEditorHistory(
  port: HistoryPort,
  id: string,
  options: {
    shouldConfirm: () => boolean;
    onBack: () => void;
    onAbandon: () => void;
  }
) {
  const url = port.location.href;
  let listening = false;
  let closed = false;
  const owned = () =>
    markerOf(port.history.state)?.id === id && port.location.href === url;
  const push = () => {
    const data = objectState(port.history.state);
    data[MARKER] = { id, url };
    port.history.pushState(data, "", url);
  };
  const onPop: EventListener = () => {
    if (closed) return;
    if (port.location.href !== url) {
      closed = true;
      options.onAbandon();
      return;
    }
    if (owned()) return;
    if (options.shouldConfirm()) push();
    options.onBack();
  };
  return {
    attach() {
      if (closed || listening) return;
      // React StrictMode and a replaced editor reuse an existing editor entry.
      const previous = markerOf(port.history.state);
      if (previous?.url === url) {
        port.history.replaceState(
          { ...objectState(port.history.state), [MARKER]: { id, url } },
          "",
          url
        );
      } else push();
      port.addEventListener("popstate", onPop);
      listening = true;
    },
    detach() {
      if (listening) port.removeEventListener("popstate", onPop);
      listening = false;
    },
    close() {
      if (closed) return;
      closed = true;
      if (owned()) port.history.back();
    },
    get hasOwnedEntry() {
      return owned();
    },
  };
}
