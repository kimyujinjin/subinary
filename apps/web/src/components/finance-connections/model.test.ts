import { describe, expect, it } from "vitest";
import { connectionFixture as item } from "./fixtures.test-support";
import { canRefreshOnOpen, connectionDecimal, connectionMoney, connectionFailureMessage, connectionTime, createConnectionSession, hasPreviousSnapshot, reconcileConnectionOperation, registrationFormVisible, type ConnectionOperation } from "./model";

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

describe("connectionMoney", () => {
  it("keeps won exact and rounds dollars to cents without passing through Number", () => {
    expect(connectionMoney("123456.75", "KRW")).toBe("123,456.75원");
    expect(connectionMoney("10294.660625", "USD")).toBe("$10,294.66");
    expect(connectionMoney("98.005", "USD")).toBe("$98.01");
    expect(connectionMoney("0.004", "USD")).toBe("$0.00");
    expect(connectionMoney("99.999", "USD")).toBe("$100.00");
    expect(connectionMoney("90071992547409931234.5", "USD")).toBe("$90,071,992,547,409,931,234.50");
    expect(connectionMoney("-1.234", "USD")).toBe("-$1.23");
  });
});

describe("등록 폼은 다시 읽기로 닫히지 않는다", () => {
  const open = { open: true, canManage: true, busy: false, data: { enabled: true } };
  it("앱 복귀·60초 안전망으로 목록을 다시 읽는 동안에도 입력 중인 폼을 남긴다", () => {
    // beforeRead가 목록을 비우고 진행 중으로 바꾼 상태 — 예전에는 여기서 폼이 사라져 입력이 지워졌다.
    expect(registrationFormVisible({ ...open, data: null, busy: true })).toBe(true);
    expect(registrationFormVisible(open)).toBe(true);
  });
  it("읽은 결과가 등록을 막으면 닫는다", () => {
    expect(registrationFormVisible({ ...open, data: { enabled: false } })).toBe(false);
    // 읽기 실패: 목록 없음 + 진행 끝.
    expect(registrationFormVisible({ ...open, data: null, busy: false })).toBe(false);
    expect(registrationFormVisible({ ...open, canManage: false })).toBe(false);
    expect(registrationFormVisible({ ...open, open: false })).toBe(false);
  });
});
