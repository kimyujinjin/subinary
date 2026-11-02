import { describe, expect, it } from "vitest";
import { connectionFixture as item } from "./fixtures.test-support";
import { canRefreshOnOpen, connectionDecimal, connectionFailureMessage, connectionTime, createConnectionSession, hasPreviousSnapshot, reconcileConnectionOperation, type ConnectionOperation } from "./model";

describe("connection display and refresh decisions", () => {
  it("preserves large integers and fractional precision without a currency conversion", () => {
    expect(connectionDecimal("99999999999999999999999.0001234500")).toBe("99,999,999,999,999,999,999,999.0001234500");
    expect(connectionDecimal("0.0000001")).toBe("0.0000001");
  });
  it("distinguishes absent time from an actual Seoul lookup time", () => {
    expect(connectionTime(null)).toBe("아직 없음");
    expect(connectionTime("2020-01-01T15:00:00Z")).toContain("02.");
  });
  it("requires consent, a selected verified account and server refresh eligibility", () => {
    expect(canRefreshOnOpen(item)).toBe(true);
    for (const patch of [{ refreshOnOpen: false }, { canRefresh: false }, { selectedAccountId: null }, { status: "connecting" as const }, { status: "refreshing" as const }, { status: "reauth_required" as const }, { status: "disconnected" as const }])
      expect(canRefreshOnOpen({ ...item, ...patch })).toBe(false);
  });
  it("marks previous values on failure or in-flight refresh, never inventing a zero", () => {
    expect(hasPreviousSnapshot(item)).toBe(false);
    expect(hasPreviousSnapshot({ ...item, status: "error", errorCode: "provider_unavailable" })).toBe(true);
    expect(hasPreviousSnapshot({ ...item, status: "refreshing" })).toBe(true);
    expect(hasPreviousSnapshot({ ...item, snapshot: null, status: "error" })).toBe(false);
  });
  it("never includes raw provider or credential errors in user-facing messages", () => {
    expect(connectionFailureMessage({ message: "synthetic-secret", status: 502 })).not.toContain("synthetic-secret");
    expect(connectionFailureMessage({ status: 409 })).toContain("상태가 바뀌었어요");
    expect(connectionFailureMessage({ status: 403 })).toContain("권한");
  });
});

describe("uncached connection task session", () => {
  it("claims a synchronous lock so repeated clicks cannot start a second request", async () => {
    const session = createConnectionSession();
    let resolve!: (value: string) => void;
    const published: string[] = [];
    const first = session.run(() => new Promise<string>((done) => { resolve = done; }), (value) => published.push(value), () => {});
    let secondCalls = 0;
    expect(await session.run(async () => { ++secondCalls; return "second"; }, () => {}, () => {})).toBe("busy");
    resolve("first");
    expect(await first).toBe("saved");
    expect(secondCalls).toBe(0);
    expect(published).toEqual(["first"]);
  });
  it("aborts and suppresses late responses after closing, navigation or identity change", async () => {
    const session = createConnectionSession();
    let resolve!: (value: string) => void;
    let observedSignal: AbortSignal | undefined;
    let published = false;
    const request = session.run((signal) => { observedSignal = signal; return new Promise<string>((done) => { resolve = done; }); }, () => { published = true; }, () => { published = true; });
    session.invalidate();
    resolve("old account");
    expect(await request).toBe("stale");
    expect(observedSignal?.aborted).toBe(true);
    expect(published).toBe(false);
  });
  it("does not retry an unknown provider operation automatically", async () => {
    const session = createConnectionSession();
    let calls = 0;
    let failures = 0;
    expect(await session.run(async () => { ++calls; throw new Error("unknown result"); }, () => {}, () => { ++failures; })).toBe("failed");
    expect(calls).toBe(1);
    expect(failures).toBe(1);
    expect(session.pending).toBe(false);
  });
  it("retains an interrupted disconnect until a GET proves a changed or disconnected version", async () => {
    const session = createConnectionSession();
    const operation: ConnectionOperation = { kind: "disconnect", id: item.id, version: item.version };
    let resolve!: (value: string) => void;
    let published = false;
    const deletion = session.run(() => new Promise<string>((done) => { resolve = done; }), () => { published = true; }, () => { published = true; });
    session.invalidate(); // the existing membership authorization GET starts
    expect(reconcileConnectionOperation(operation, [item])).toBe(operation);
    expect(reconcileConnectionOperation(operation, [])).toBe(operation);
    resolve("late deleted response");
    expect(await deletion).toBe("stale");
    expect(published).toBe(false);
    expect(reconcileConnectionOperation(operation, [{ ...item, status: "disconnected", version: item.version + 1 }])).toBeNull();
  });
  it("does not treat another owner's/record's result as reconciliation", () => {
    const operation: ConnectionOperation = { kind: "register", id: "44444444-4444-4444-8444-444444444444", version: 0 };
    expect(reconcileConnectionOperation(operation, [item])).toBe(operation);
  });
});
