import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const secure = new Map<string, string>();
vi.mock("./native", () => ({
  isNative: () => true,
  getQueryCacheKey: async () => secure.get("key") ?? null,
  setQueryCacheKey: async (value: string) => {
    secure.set("key", value);
  },
  removeQueryCacheKey: async () => {
    secure.delete("key");
  },
}));

const {
  clearQueryCache,
  isPlainJson,
  persistableState,
  persistQueryCacheNow,
  restoreQueryCache,
  shouldPersistQuery,
} = await import("./query-persistence");

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  get size() {
    return this.values.size;
  }
  dump() {
    return [...this.values.values()].join("");
  }
}

let store: MemoryStorage;
beforeEach(async () => {
  store = new MemoryStorage();
  vi.stubGlobal("localStorage", store);
  await clearQueryCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const HH = "hh-a";
const monthlyKey = ["analytics", "monthly", HH, "2026-11"];
const seeded = () => {
  const qc = new QueryClient();
  qc.setQueryData(monthlyKey, {
    totalNet: 526339,
    merchant: "스타벅스 합성점",
  });
  qc.setQueryData(
    ["manual-finance", HH, "u1", "owner", "finance-connections"],
    { secretish: true }
  );
  qc.setQueryData(["card-sms-events", HH], { raw: "[Web발신] 원문" });
  return qc;
};

describe("앱 화면 캐시 — 무엇을 저장하나", () => {
  it("탭 화면 데이터만 허용하고 연결 계좌 관리·문자 원문·AI·알림함은 넣지 않는다", () => {
    expect(shouldPersistQuery(monthlyKey)).toBe(true);
    expect(
      shouldPersistQuery(["manual-finance", HH, "u1", "household", "overview"])
    ).toBe(true);
    for (const key of [
      ["manual-finance", HH, "u1", "owner", "finance-connections"],
      ["manual-finance", HH, "u1", "private", "assets"],
      ["card-sms-events", HH],
      ["slack", "workspaces"],
      ["notifications", HH],
      ["transaction-detail", HH, "t1"],
    ]) {
      expect(shouldPersistQuery(key)).toBe(false);
    }
  });

  it("무한 목록은 첫 페이지만, JSON이 아닌 값은 통째로 뺀다", () => {
    const qc = new QueryClient();
    qc.setQueryData(["transactions", HH], {
      pages: [{ items: [1] }, { items: [2] }],
      pageParams: [null, "c2"],
    });
    qc.setQueryData(["budgets", HH], { when: new Date() });
    qc.setQueryData(["cards", HH], { big: 1n });
    const state = persistableState(qc);
    expect(state.queries.map((query) => query.queryKey[0])).toEqual([
      "transactions",
    ]);
    expect(state.queries[0]!.state.data).toEqual({
      pages: [{ items: [1] }],
      pageParams: [null],
    });
    expect(isPlainJson(new Map())).toBe(false);
    expect(isPlainJson({ a: [1, "x", null, { b: true }] })).toBe(true);
  });
});

describe("앱 화면 캐시 — 저장·복원", () => {
  it("암호화해 저장하고 같은 사용자에게 받은 시각 그대로 복원한다", async () => {
    const qc = seeded();
    const updatedAt = qc.getQueryState(monthlyKey)!.dataUpdatedAt;
    await persistQueryCacheNow(qc, "u1");
    expect(store.size).toBe(1);
    // 저장소에는 평문 금액·가맹점이 남지 않는다.
    expect(store.dump()).not.toContain("526339");
    expect(store.dump()).not.toContain("스타벅스");

    const fresh = new QueryClient();
    await expect(restoreQueryCache(fresh, "u1")).resolves.toBe(true);
    expect(fresh.getQueryData(monthlyKey)).toEqual({
      totalNet: 526339,
      merchant: "스타벅스 합성점",
    });
    expect(fresh.getQueryState(monthlyKey)!.dataUpdatedAt).toBe(updatedAt);
    expect(
      fresh.getQueryData([
        "manual-finance",
        HH,
        "u1",
        "owner",
        "finance-connections",
      ])
    ).toBeUndefined();
    expect(fresh.getQueryData(["card-sms-events", HH])).toBeUndefined();
  });

  it("다른 사용자·7일 지난 값은 복원하지 않고 지운다", async () => {
    await persistQueryCacheNow(seeded(), "u1");
    const other = new QueryClient();
    await expect(restoreQueryCache(other, "u2")).resolves.toBe(false);
    expect(other.getQueryData(monthlyKey)).toBeUndefined();
    expect(store.size).toBe(0);

    await persistQueryCacheNow(seeded(), "u1");
    const later = Date.now() + 8 * 24 * 60 * 60_000;
    await expect(
      restoreQueryCache(new QueryClient(), "u1", later)
    ).resolves.toBe(false);
    expect(store.size).toBe(0);
  });

  it("세션이 닫히면 암호문과 키를 함께 지워 복원할 수 없다", async () => {
    await persistQueryCacheNow(seeded(), "u1");
    expect(secure.has("key")).toBe(true);
    await clearQueryCache();
    expect(store.size).toBe(0);
    expect(secure.has("key")).toBe(false);
    await expect(restoreQueryCache(new QueryClient(), "u1")).resolves.toBe(
      false
    );
  });

  it("키 없이 남은 암호문(앱 재설치 등)은 풀지 못하므로 지운다", async () => {
    await persistQueryCacheNow(seeded(), "u1");
    secure.delete("key");
    await clearQueryCache().then(() => undefined); // 메모리에 남은 키도 버린다
    store.setItem(
      "family.queryCache.v1",
      JSON.stringify({ v: 1, iv: "AAAAAAAAAAAAAAAA", data: "AAAA" })
    );
    await expect(restoreQueryCache(new QueryClient(), "u1")).resolves.toBe(
      false
    );
    expect(store.size).toBe(0);
  });

  it("이미 더 새 값이 있으면 복원 값으로 덮어쓰지 않는다", async () => {
    await persistQueryCacheNow(seeded(), "u1");
    const qc = new QueryClient();
    qc.setQueryData(
      monthlyKey,
      { totalNet: 999, merchant: "새 값" },
      { updatedAt: Date.now() + 60_000 }
    );
    await restoreQueryCache(qc, "u1");
    expect(qc.getQueryData(monthlyKey)).toEqual({
      totalNet: 999,
      merchant: "새 값",
    });
  });
});
