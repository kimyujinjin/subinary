import { describe, expect, it, vi } from "vitest";
import { createTransactionEditSession, validateTransactionEdit, type TransactionEditInput } from "./transaction-edit";

const input: TransactionEditInput = {
  amount: "12000", date: "2026-10-22T10:30", initialAmount: 12000,
  initialDate: "2026-10-22T10:30", canEditAmount: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("transaction amount/date validation", () => {
  it.each(["", "0", "-1", "1.5", "1e3", "NaN", "abc", "9007199254740992"])("rejects invalid amount %j instead of dropping it", (amount) => {
    expect(validateTransactionEdit({ ...input, amount })).toEqual({
      ok: false, errors: { amount: "금액은 1 이상의 정수로 입력해 주세요." },
    });
  });

  it.each(["", "2026-02-30T10:30", "2026-13-01T10:30", "2026-10-22T24:30", "2026-10-22T10:60", "0000-10-22T10:30", "not-a-date"])("rejects missing or rollover date %j", (date) => {
    expect(validateTransactionEdit({ ...input, date })).toEqual({
      ok: false, errors: { occurredAt: "올바른 날짜와 시각을 입력해 주세요." },
    });
  });

  it("reports both fields together without submitting a valid half of the edit", () => {
    const result = validateTransactionEdit({ ...input, amount: "0", date: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(["amount", "occurredAt"]);
  });

  it("accepts grouped integers and sends only changed fields", () => {
    expect(validateTransactionEdit({ ...input, amount: " 13,000 " })).toEqual({ ok: true, patch: { amount: 13000 } });
    expect(validateTransactionEdit({ ...input, amount: "12,000" })).toEqual({ ok: true, patch: {} });
    const date = "2028-02-29T10:30";
    expect(validateTransactionEdit({ ...input, date })).toEqual({
      ok: true, patch: { occurredAt: new Date(date).toISOString() },
    });
  });

  it("does not reinterpret an unchanged minute value or submit the disabled linked-amount field", () => {
    expect(validateTransactionEdit(input)).toEqual({ ok: true, patch: {} });
    expect(validateTransactionEdit({ ...input, amount: "invalid disabled value", canEditAmount: false }))
      .toEqual({ ok: true, patch: {} });
  });
});

describe("transaction edit request lifetime", () => {
  it("claims synchronously and does not close before confirmation or submit a second click", async () => {
    const pending = deferred<string>();
    const request = vi.fn(() => pending.promise);
    const saved = vi.fn();
    const failed = vi.fn();
    const session = createTransactionEditSession();
    const first = session.save(request, saved, failed);
    expect(session.pending).toBe(true);
    expect(saved).not.toHaveBeenCalled();
    expect(await session.save(request, saved, failed)).toBe("busy");
    expect(request).toHaveBeenCalledTimes(1);
    pending.resolve("server-confirmed");
    expect(await first).toBe("saved");
    expect(saved).toHaveBeenCalledWith("server-confirmed");
    expect(failed).not.toHaveBeenCalled();
    expect(session.pending).toBe(false);
  });

  it("reports failure without changing the draft and permits an explicit retry", async () => {
    const session = createTransactionEditSession();
    const draft = Object.freeze({ amount: "13,000", date: "2026-10-22T10:30" });
    const error = new Error("synthetic unavailable");
    const saved = vi.fn(); const failed = vi.fn();
    expect(await session.save(async () => { throw error; }, saved, failed)).toBe("failed");
    expect(saved).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledWith(error);
    expect(draft).toEqual({ amount: "13,000", date: "2026-10-22T10:30" });
    expect(session.pending).toBe(false);
    expect(await session.save(async () => "retried", saved, failed)).toBe("saved");
  });

  it("ignores a late success after unmount/cancel without finishing the next editing session", async () => {
    const old = deferred<string>(); const current = deferred<string>();
    const session = createTransactionEditSession();
    const oldSaved = vi.fn(); const currentSaved = vi.fn();
    const first = session.save(() => old.promise, oldSaved, vi.fn());
    session.invalidate();
    const second = session.save(() => current.promise, currentSaved, vi.fn());
    old.resolve("old result");
    expect(await first).toBe("stale");
    expect(oldSaved).not.toHaveBeenCalled();
    expect(session.pending).toBe(true);
    current.resolve("current result");
    expect(await second).toBe("saved");
    expect(currentSaved).toHaveBeenCalledWith("current result");
  });

  it("ignores a late rejected response after browser navigation", async () => {
    const old = deferred<string>(); const session = createTransactionEditSession();
    const failed = vi.fn(); const saved = vi.fn();
    const result = session.save(() => old.promise, saved, failed);
    session.invalidate(); old.reject(new Error("late synthetic failure"));
    expect(await result).toBe("stale");
    expect(saved).not.toHaveBeenCalled(); expect(failed).not.toHaveBeenCalled();
  });
});
