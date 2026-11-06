/**
 * 거래 상세 시트의 하위 데이터 미리 받기와 열기 전 짧은 기다림(2026-11-06 사용자 지적: 시트가 열린 뒤
 * 최근 결제 등이 따로 도착해 끊기며 그려졌다). 픽스처 값은 모두 지어낸 것이다.
 */
import type { TransactionSummary } from "@family/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/queries";
import { reviewRequestsKey } from "@/lib/review-requests";
import { transactionDetailKey } from "@/lib/transaction-detail-cache";
import { detailFallbackReason } from "@/lib/transaction-detail-fallback";

import {
  DETAIL_OPEN_WAIT_MS,
  createDetailOpenGate,
  prefetchTransactionDetail,
  resolveDetailFallback,
  seedTransactionDetail,
  settleWithin,
  type DetailPrefetchContext,
} from "./detail-prefetch";
import { duplicatePairQuery, duplicatePairWindow } from "./duplicate-pair";

const at = "2026-08-03T05:31:00.000Z";

function txn(overrides: Partial<TransactionSummary> = {}): TransactionSummary {
  return {
    id: "txn-a",
    householdId: "hh-test",
    memberId: "m1",
    cardId: "c1",
    transactionType: "approval",
    status: "approved",
    amount: 12_500,
    cancelledAmount: 0,
    netAmount: 12_500,
    currency: "KRW",
    originalAmount: null,
    originalCurrency: null,
    exchangeRate: null,
    merchantRaw: "가상카페 본점",
    merchantNormalized: "가상카페",
    categoryId: null,
    categorySlug: null,
    approvedAt: at,
    cancelledAt: null,
    installmentMonths: null,
    parentTransactionId: null,
    visibility: "household",
    memo: null,
    masked: false,
    excludedAt: null,
    createdAt: at,
    ...overrides,
  };
}

const clients: QueryClient[] = [];
afterEach(() => {
  clients.splice(0).forEach((qc) => qc.clear());
  vi.useRealTimers();
});

function setup(overrides: Partial<DetailPrefetchContext> = {}) {
  // 앱과 같은 신선 기간(app/providers.tsx staleTime 30초).
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  clients.push(queryClient);
  // 요청 함수는 부르지 않고 빈 목록을 돌려준다 — 몇 번 요청했는지만 센다.
  const authedFetch = vi.fn(async () => ({ items: [], nextCursor: null }));
  const context: DetailPrefetchContext = {
    householdId: "hh-test",
    authedFetch: authedFetch as unknown as DetailPrefetchContext["authedFetch"],
    askFamily: true,
    ...overrides,
  };
  return { queryClient, authedFetch, context };
}

describe("prefetchTransactionDetail — 시트가 쓸 하위 데이터를 미리 받는다", () => {
  it("훅과 같은 키로 받는다 — 최근 결제는 useTransactions({ q, limit: 30 })와도 캐시를 함께 쓴다", async () => {
    const { queryClient, context, authedFetch } = setup();
    const duplicate = txn({ status: "duplicate_suspected" });
    const ready = prefetchTransactionDetail(queryClient, duplicate, context);
    expect(ready).toBeInstanceOf(Promise);
    await ready;
    expect(authedFetch).toHaveBeenCalledTimes(3);
    expect(
      queryClient.getQueryData(
        queryKeys.transactions("hh-test", { q: "가상카페", limit: 30 })
      )
    ).toBeDefined();
    expect(
      queryClient.getQueryData(
        duplicatePairQuery(
          "hh-test",
          duplicatePairWindow(duplicate),
          context.authedFetch
        ).queryKey
      )
    ).toBeDefined();
    expect(
      queryClient.getQueryData(reviewRequestsKey("hh-test", duplicate.id))
    ).toBeDefined();
  });

  it("받아 둔 것이 신선하면 다시 요청하지 않고 기다릴 것도 없다(null)", async () => {
    const { queryClient, context, authedFetch } = setup();
    await prefetchTransactionDetail(queryClient, txn(), context);
    const calls = authedFetch.mock.calls.length;
    expect(prefetchTransactionDetail(queryClient, txn(), context)).toBeNull();
    expect(authedFetch).toHaveBeenCalledTimes(calls);
  });

  it("받는 중에 같은 줄을 또 눌러도(pointerdown → click) 요청은 한 번이다", async () => {
    const { queryClient, context, authedFetch } = setup();
    const first = prefetchTransactionDetail(queryClient, txn(), context);
    const second = prefetchTransactionDetail(queryClient, txn(), context);
    // 아직 도착 전이라 둘 다 기다릴 것이 있다.
    expect(first).toBeInstanceOf(Promise);
    expect(second).toBeInstanceOf(Promise);
    await Promise.all([first, second]);
    // 최근 결제 + 가족에게 물어보기 = 2건(중복 의심이 아니라 짝 결제는 부르지 않는다).
    expect(authedFetch).toHaveBeenCalledTimes(2);
  });

  it("이 거래에 쓰이지 않는 것은 부르지 않는다", async () => {
    // 나만 보기 승인: 최근 결제만.
    const own = setup();
    await prefetchTransactionDetail(
      own.queryClient,
      txn({ visibility: "private" }),
      own.context
    );
    expect(own.authedFetch).toHaveBeenCalledTimes(1);

    // 물어볼 가족이 없으면 확인 요청을 기다리지 않는다.
    const alone = setup({ askFamily: false });
    await prefetchTransactionDetail(alone.queryClient, txn(), alone.context);
    expect(alone.authedFetch).toHaveBeenCalledTimes(1);

    // 비공개 행은 가맹점을 몰라 아무것도 부르지 않는다.
    const masked = setup();
    expect(
      prefetchTransactionDetail(
        masked.queryClient,
        txn({ masked: true, merchantNormalized: null, merchantRaw: null }),
        masked.context
      )
    ).toBeNull();
    expect(masked.authedFetch).not.toHaveBeenCalled();

    // 가족이 정해지지 않았으면(훅도 꺼져 있다) 부르지 않는다.
    const noHousehold = setup({ householdId: null });
    expect(
      prefetchTransactionDetail(
        noHousehold.queryClient,
        txn(),
        noHousehold.context
      )
    ).toBeNull();
    expect(noHousehold.authedFetch).not.toHaveBeenCalled();
  });
});

describe("settleWithin — 최대 250ms만 기다린다", () => {
  it("일이 먼저 끝나면 바로 풀리고 타이머를 남기지 않는다", async () => {
    vi.useFakeTimers();
    let done = false;
    const task = new Promise<void>((resolve) => setTimeout(resolve, 80));
    void settleWithin(task, DETAIL_OPEN_WAIT_MS).then((result) => {
      expect(result).toBe("settled");
      done = true;
    });
    await vi.advanceTimersByTimeAsync(79);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("끝나지 않으면 250ms에 풀린다", async () => {
    vi.useFakeTimers();
    let result: string | null = null;
    void settleWithin(new Promise(() => undefined), 250).then((value) => {
      result = value;
    });
    await vi.advanceTimersByTimeAsync(249);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe("timeout");
  });

  it("실패도 끝난 것으로 본다 — 시트는 어차피 연다", async () => {
    vi.useFakeTimers();
    await expect(
      settleWithin(Promise.reject(new Error("network")), 250)
    ).resolves.toBe("settled");
  });
});

describe("createDetailOpenGate — 한 번에 하나만 기다린다", () => {
  function deferred() {
    let resolve: () => void = () => undefined;
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("기다릴 것이 없으면(캐시에 있음·키보드) 바로 연다", () => {
    const pending = vi.fn();
    const run = vi.fn();
    createDetailOpenGate(pending).open("txn-a", null, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(pending).not.toHaveBeenCalled();
  });

  it("기다리는 동안 누른 줄을 알리고, 받으면 바로 연다", async () => {
    vi.useFakeTimers();
    const pending = vi.fn();
    const run = vi.fn();
    const data = deferred();
    createDetailOpenGate(pending).open("txn-a", data.promise, run);
    expect(pending).toHaveBeenLastCalledWith("txn-a");
    expect(run).not.toHaveBeenCalled();
    data.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(pending).toHaveBeenLastCalledWith(null);
  });

  it("같은 줄을 두 번 눌러도 한 번만 연다", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const gate = createDetailOpenGate(() => undefined);
    const data = deferred();
    gate.open("txn-a", data.promise, run);
    gate.open("txn-a", data.promise, run);
    await vi.advanceTimersByTimeAsync(DETAIL_OPEN_WAIT_MS);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("기다리는 중에 다른 줄을 누르면 마지막 것만 연다", async () => {
    vi.useFakeTimers();
    const pending = vi.fn();
    const first = vi.fn();
    const second = vi.fn();
    const gate = createDetailOpenGate(pending);
    gate.open("txn-a", new Promise(() => undefined), first);
    gate.open("txn-b", new Promise(() => undefined), second);
    expect(pending).toHaveBeenLastCalledWith("txn-b");
    await vi.advanceTimersByTimeAsync(DETAIL_OPEN_WAIT_MS);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("오래 걸려도 250ms 뒤에는 연다(남은 섹션은 자리를 잡아 둔다)", async () => {
    vi.useFakeTimers();
    const run = vi.fn();
    createDetailOpenGate(() => undefined).open(
      "txn-a",
      new Promise(() => undefined),
      run
    );
    await vi.advanceTimersByTimeAsync(DETAIL_OPEN_WAIT_MS - 1);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("버리면(화면을 떠남) 열지 않는다", async () => {
    vi.useFakeTimers();
    const pending = vi.fn();
    const run = vi.fn();
    const gate = createDetailOpenGate(pending);
    gate.open("txn-a", new Promise(() => undefined), run);
    gate.cancel();
    expect(pending).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(DETAIL_OPEN_WAIT_MS);
    expect(run).not.toHaveBeenCalled();
  });
});

describe("seedTransactionDetail — 시트 안에서 목록 밖 거래로 넘어갈 때", () => {
  it("가진 요약을 먼저 넣되 오래된 것으로 두어 열리자마자 한 번 확인한다", () => {
    const { queryClient } = setup();
    const other = txn({ id: "txn-old-month" });
    seedTransactionDetail(queryClient, "hh-test", other);
    const key = transactionDetailKey("hh-test", other.id);
    expect(queryClient.getQueryData(key)).toBe(other);
    expect(queryClient.getQueryState(key)?.dataUpdatedAt).toBe(0);
  });

  it("이미 받아 둔 상세는 덮어쓰지 않는다", () => {
    const { queryClient } = setup();
    const key = transactionDetailKey("hh-test", "txn-old-month");
    const fetched = txn({ id: "txn-old-month", memo: "단건 조회 결과" });
    queryClient.setQueryData(key, fetched);
    seedTransactionDetail(
      queryClient,
      "hh-test",
      txn({ id: "txn-old-month", memo: null })
    );
    expect(queryClient.getQueryData(key)).toBe(fetched);
  });
});

describe("resolveDetailFallback — 단건 조회가 실패해도 시트와 얼럿이 겹치지 않는다", () => {
  /** 서버 오류 모양만 흉내 낸다(ApiError의 status 필드). */
  const httpError = (status: number) =>
    Object.assign(new Error(`HTTP ${status}`), { status });

  async function failAfterSeed(status: number) {
    const { queryClient } = setup();
    const other = txn({ id: "txn-old-month" });
    seedTransactionDetail(queryClient, "hh-test", other);
    const key = transactionDetailKey("hh-test", other.id);
    // page.tsx detailFallbackQuery처럼 재시도 없이 한 번 확인한다(미리 넣은 값은 오래된 것이라 바로 요청한다).
    await queryClient
      .fetchQuery({
        queryKey: key,
        queryFn: () => Promise.reject(httpError(status)),
        retry: false,
      })
      .catch(() => undefined);
    return { other, state: queryClient.getQueryState(key) };
  }

  it("전제: 확인이 실패해도 캐시에는 미리 넣은 요약이 남는다 — 그대로 쓰면 시트 위에 얼럿이 겹쳤다", async () => {
    const { other, state } = await failAfterSeed(404);
    expect(state?.status).toBe("error");
    expect(state?.data).toBe(other);
  });

  it("연결이 잠깐 끊긴 것이면 가진 요약으로 시트를 그대로 두고 얼럿은 띄우지 않는다", async () => {
    const { other, state } = await failAfterSeed(503);
    const view = resolveDetailFallback(
      state?.data as TransactionSummary | undefined,
      detailFallbackReason(state?.error)
    );
    expect(view).toEqual({ txn: other, failure: null });
  });

  it("없거나(404) 막힌(403) 거래면 요약을 버리고 얼럿만 띄운다 — 미리 넣기 전과 같은 흐름", async () => {
    for (const [status, reason] of [
      [404, "missing"],
      [403, "forbidden"],
    ] as const) {
      const { state } = await failAfterSeed(status);
      expect(
        resolveDetailFallback(
          state?.data as TransactionSummary | undefined,
          detailFallbackReason(state?.error)
        )
      ).toEqual({ txn: null, failure: reason });
    }
  });

  it("가진 것이 없으면 이유가 무엇이든 얼럿을 띄운다(딥링크로 처음 연 거래)", () => {
    for (const reason of ["error", "missing", "forbidden"] as const) {
      expect(resolveDetailFallback(undefined, reason)).toEqual({
        txn: null,
        failure: reason,
      });
    }
  });

  it("실패하지 않았으면 가진 것을 그린다(불러오는 중이면 아무것도)", () => {
    const other = txn({ id: "txn-old-month" });
    expect(resolveDetailFallback(other, null)).toEqual({
      txn: other,
      failure: null,
    });
    expect(resolveDetailFallback(undefined, null)).toEqual({
      txn: null,
      failure: null,
    });
  });

  it("어떤 조합에서도 시트와 얼럿을 함께 내지 않는다", () => {
    const other = txn({ id: "txn-old-month" });
    for (const data of [other, undefined]) {
      for (const failure of [null, "error", "missing", "forbidden"] as const) {
        const view = resolveDetailFallback(data, failure);
        expect(view.txn != null && view.failure != null).toBe(false);
      }
    }
  });
});
