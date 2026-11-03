import { describe, expect, it, vi } from "vitest";
import { dispatchTransactionDetailBack, registerTransactionDetailBack } from "./transaction-detail-back";
import { createTransactionEditSession } from "./transaction-edit";

describe("transaction detail back handling", () => {
  it("keeps native app navigation available when no detail is mounted", () => {
    expect(dispatchTransactionDetailBack(new EventTarget())).toBe(true);
  });

  it("consumes a native back only until the mounted detail unregisters", () => {
    const target = new EventTarget(); const handle = vi.fn();
    const cleanup = registerTransactionDetailBack(target, handle);
    expect(dispatchTransactionDetailBack(target)).toBe(false);
    expect(handle).toHaveBeenCalledExactlyOnceWith("native");
    cleanup(); cleanup();
    expect(dispatchTransactionDetailBack(target)).toBe(true);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it("routes multiple mounted dialogs to the last one and supports out-of-order cleanup", () => {
    const target = new EventTarget(); const older = vi.fn(); const newer = vi.fn();
    const first = registerTransactionDetailBack(target, older);
    const second = registerTransactionDetailBack(target, newer);
    dispatchTransactionDetailBack(target);
    expect(newer).toHaveBeenCalledExactlyOnceWith("native");
    expect(older).not.toHaveBeenCalled();
    first(); dispatchTransactionDetailBack(target);
    expect(newer).toHaveBeenCalledTimes(2);
    second(); expect(dispatchTransactionDetailBack(target)).toBe(true);
  });

  it("independently removes duplicate callback registrations and does not leak to another target", () => {
    const target = new EventTarget(); const other = new EventTarget(); const handle = vi.fn();
    const first = registerTransactionDetailBack(target, handle);
    const second = registerTransactionDetailBack(target, handle);
    first(); expect(dispatchTransactionDetailBack(target)).toBe(false);
    expect(dispatchTransactionDetailBack(other)).toBe(true);
    second(); expect(dispatchTransactionDetailBack(target)).toBe(true);
  });

  it("notifies every open layer after browser navigation, even if a callback unregisters itself", () => {
    const target = new EventTarget(); const order: string[] = [];
    const first = registerTransactionDetailBack(target, (source) => order.push(`detail:${source}`));
    const second = registerTransactionDetailBack(target, (source) => { second(); order.push(`memo:${source}`); });
    expect(target.dispatchEvent(new Event("popstate", { cancelable: true }))).toBe(true);
    expect(order).toEqual(["memo:browser", "detail:browser"]);
    first(); expect(dispatchTransactionDetailBack(target)).toBe(true);
  });

  it("does not cancel a browser popstate and invalidates late editor callbacks", async () => {
    const target = new EventTarget(); const session = createTransactionEditSession();
    let resolve!: () => void;
    const pending = new Promise<void>((yes) => { resolve = yes; });
    const saved = vi.fn();
    const saving = session.save(() => pending, saved, vi.fn());
    const close = vi.fn((source) => { if (source === "browser") session.invalidate(); });
    const cleanup = registerTransactionDetailBack(target, close);
    expect(target.dispatchEvent(new Event("popstate", { cancelable: true }))).toBe(true);
    expect(close).toHaveBeenCalledWith("browser");
    resolve(); expect(await saving).toBe("stale"); expect(saved).not.toHaveBeenCalled();
    cleanup(); target.dispatchEvent(new Event("popstate")); expect(close).toHaveBeenCalledTimes(1);
  });
});
