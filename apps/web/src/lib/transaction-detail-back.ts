export const TRANSACTION_DETAIL_BACK_EVENT = "family:transaction-detail-back";
export type TransactionDetailBackSource = "native" | "browser";

type Handler = (source: TransactionDetailBackSource) => void;
const registrations = new WeakMap<EventTarget, { handlers: Handler[]; native: EventListener; browser: EventListener }>();

/** A native back is consumed only while an explicitly registered dialog is open. */
export function dispatchTransactionDetailBack(target: EventTarget): boolean {
  return target.dispatchEvent(new Event(TRANSACTION_DETAIL_BACK_EVENT, { cancelable: true }));
}

/**
 * One listener per target, native back goes to the last mounted dialog first.
 * Browser popstate has already changed the URL: notify all layers to discard
 * response callbacks without cancelling or rewriting history.
 */
export function registerTransactionDetailBack(target: EventTarget, handler: Handler): () => void {
  let registration = registrations.get(target);
  if (!registration) {
    const handlers: Handler[] = [];
    const native: EventListener = (event) => {
      const last = handlers.at(-1);
      if (!last) return;
      event.preventDefault();
      last("native");
    };
    const browser: EventListener = () => {
      for (const handle of [...handlers].reverse()) handle("browser");
    };
    registration = { handlers, native, browser };
    registrations.set(target, registration);
    target.addEventListener(TRANSACTION_DETAIL_BACK_EVENT, native);
    target.addEventListener("popstate", browser);
  }
  // A distinct entry makes even the same callback mounted twice independently removable.
  const entry: Handler = (source) => handler(source);
  registration.handlers.push(entry);
  return () => {
    const current = registrations.get(target);
    if (!current) return;
    const index = current.handlers.indexOf(entry);
    if (index >= 0) current.handlers.splice(index, 1);
    if (current.handlers.length === 0) {
      target.removeEventListener(TRANSACTION_DETAIL_BACK_EVENT, current.native);
      target.removeEventListener("popstate", current.browser);
      registrations.delete(target);
    }
  };
}
