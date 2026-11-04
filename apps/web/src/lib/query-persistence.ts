"use client";
/* ---------------------------------------------------------------------------
 * 앱 화면 캐시 영속화(2026-11-05) — 콜드 스타트에 마지막 화면을 바로 보여 준다.
 *
 * - 앱(네이티브)에서만 켠다. 웹 브라우저는 공용 PC일 수 있어 저장하지 않는다.
 * - 저장 내용은 AES-GCM으로 암호화한다. 키는 refresh 토큰과 같은 Keychain/Keystore
 *   (이 기기 전용, 잠금 해제 상태에서만)에 둔다. 세션이 닫히는 모든 경로(로그아웃·세션
 *   만료·생체인증 실패)에서 키와 암호문을 함께 지운다.
 * - 허용 목록의 화면 데이터만 저장한다. 연결 계좌 관리·문자 원문·알림함·AI·초대처럼
 *   비밀값이나 원문이 섞일 수 있는 것은 넣지 않는다.
 * - 같은 사용자·같은 앱 번들·7일 이내일 때만 복원한다. 복원한 값은 받은 시각을 그대로
 *   가지고 있어(stale) 화면이 뜨자마자 뒤에서 새로 받는다. 이미 더 새 값이 있으면
 *   hydrate가 덮어쓰지 않는다.
 * ------------------------------------------------------------------------- */
import {
  dehydrate,
  hydrate,
  type DehydratedState,
  type QueryClient,
} from "@tanstack/react-query";

import {
  getQueryCacheKey,
  isNative,
  removeQueryCacheKey,
  setQueryCacheKey,
} from "./native";

const STORAGE_KEY = "family.queryCache.v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** 암호화 전 JSON 길이 상한. 넘으면 저장하지 않는다(WebView 저장소 한도 보호). */
const MAX_CHARS = 1_500_000;
const SAVE_DELAY_MS = 2_000;
/** OTA 번들 버전(deploy-ota-bundle.sh). 번들이 바뀌면 옛 화면 데이터 모양을 믿지 않는다. */
const BUNDLE_VERSION = process.env.NEXT_PUBLIC_BUNDLE_VERSION || "dev";

/** 저장해도 되는 쿼리 키 첫 요소 — 탭 화면을 그리는 데이터만. */
const PERSIST_ROOTS = new Set([
  "analytics",
  "budgets",
  "cards",
  "categories",
  "connected-accounts",
  "fx-reference",
  "household",
  "household-members",
  "manual-finance",
  "monthly-insights",
  "notification-unread",
  "recurring-series",
  "recurring-upcoming",
  "review-requests",
  "spend-summary",
  "transactions",
]);

export function shouldPersistQuery(queryKey: readonly unknown[]): boolean {
  const root = queryKey[0];
  if (typeof root !== "string" || !PERSIST_ROOTS.has(root)) return false;
  // 수동 기록은 가족 공유 범위만 — 본인 소유 연결·가져오기 기록(owner)·비공개는 넣지 않는다.
  if (root === "manual-finance") return queryKey[3] === "household";
  return true;
}

/** 순수 JSON 값만 저장한다 — Date·Map·BigInt 같은 값은 복원하면 모양이 바뀐다. */
export function isPlainJson(
  value: unknown,
  budget = { left: 200_000 }
): boolean {
  if (--budget.left < 0) return false;
  if (value === null || value === undefined) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (Array.isArray(value))
        return value.every((item) => isPlainJson(item, budget));
      const proto: unknown = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) return false;
      return Object.values(value).every((item) => isPlainJson(item, budget));
    }
    default:
      return false;
  }
}

/** 무한 목록은 첫 페이지만 — 콜드 스타트 첫 화면에 필요한 만큼만 저장한다. */
function firstPageOnly(data: unknown): unknown {
  if (data && typeof data === "object") {
    const { pages, pageParams } = data as {
      pages?: unknown;
      pageParams?: unknown;
    };
    if (Array.isArray(pages) && Array.isArray(pageParams)) {
      return { pages: pages.slice(0, 1), pageParams: pageParams.slice(0, 1) };
    }
  }
  return data;
}

export function persistableState(qc: QueryClient): DehydratedState {
  const state = dehydrate(qc, {
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" && shouldPersistQuery(query.queryKey),
  });
  return {
    mutations: [],
    queries: state.queries.flatMap((query) => {
      const data = firstPageOnly(query.state.data);
      return isPlainJson(data)
        ? [{ ...query, state: { ...query.state, data } }]
        : [];
    }),
  };
}

interface Payload {
  userId: string;
  bundle: string;
  savedAt: number;
  state: DehydratedState;
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === "undefined"
      ? null
      : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** 세션이 닫힐 때마다 올린다 — 진행 중이던 저장·복원이 지운 뒤에 되살아나지 않게 한다. */
let generation = 0;
let cachedKey: CryptoKey | null = null;
let saveChain: Promise<void> = Promise.resolve();

async function getKey(create: boolean): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  const raw = await getQueryCacheKey();
  let bytes: Uint8Array<ArrayBuffer> | null = raw ? fromBase64(raw) : null;
  if (!bytes) {
    if (!create) return null;
    bytes = crypto.getRandomValues(new Uint8Array(32));
    await setQueryCacheKey(toBase64(bytes));
  }
  cachedKey = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

/** 저장된 화면 데이터를 이 사용자 것일 때만 캐시에 넣는다. 맞지 않거나 깨졌으면 지운다. */
export async function restoreQueryCache(
  qc: QueryClient,
  userId: string,
  now: number = Date.now()
): Promise<boolean> {
  if (!isNative()) return false;
  const store = storage();
  if (!store) return false;
  const startGeneration = generation;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return false;
    const envelope = JSON.parse(raw) as {
      v?: unknown;
      iv?: unknown;
      data?: unknown;
    };
    if (
      envelope.v !== 1 ||
      typeof envelope.iv !== "string" ||
      typeof envelope.data !== "string"
    ) {
      throw new Error("query_cache_envelope");
    }
    const key = await getKey(false);
    if (!key) throw new Error("query_cache_key_missing");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.data)
    );
    const payload = JSON.parse(new TextDecoder().decode(plain)) as Payload;
    if (generation !== startGeneration) return false;
    if (
      payload.userId !== userId ||
      payload.bundle !== BUNDLE_VERSION ||
      !(now - payload.savedAt <= MAX_AGE_MS)
    ) {
      throw new Error("query_cache_mismatch");
    }
    hydrate(qc, payload.state);
    return true;
  } catch {
    try {
      store.removeItem(STORAGE_KEY);
    } catch {
      // 저장소에 접근하지 못하면 다음 저장이 덮어쓴다.
    }
    return false;
  }
}

/** 지금 캐시를 암호화해 저장한다. 세션이 닫혔거나 너무 크면 저장하지 않는다. */
export function persistQueryCacheNow(
  qc: QueryClient,
  userId: string
): Promise<void> {
  const startGeneration = generation;
  saveChain = saveChain
    .then(async () => {
      const store = storage();
      if (!isNative() || !store || generation !== startGeneration) return;
      const text = JSON.stringify({
        userId,
        bundle: BUNDLE_VERSION,
        savedAt: Date.now(),
        state: persistableState(qc),
      } satisfies Payload);
      if (text.length > MAX_CHARS) {
        store.removeItem(STORAGE_KEY);
        return;
      }
      const key = await getKey(true);
      if (!key || generation !== startGeneration) return;
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const sealed = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          new TextEncoder().encode(text)
        )
      );
      if (generation !== startGeneration) return;
      store.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 1, iv: toBase64(iv), data: toBase64(sealed) })
      );
    })
    .catch(() => undefined);
  return saveChain;
}

/** 로그인된 동안 화면 데이터가 바뀔 때마다(2초 모아서) 저장하고, 앱이 백그라운드로 갈 때 바로 저장한다. */
export function startQueryCachePersistence(
  qc: QueryClient,
  userId: string
): () => void {
  if (!isNative() || !storage()) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const save = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!stopped) void persistQueryCacheNow(qc, userId);
  };
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (
      !stopped &&
      timer === null &&
      event.type === "updated" &&
      event.action.type === "success" &&
      shouldPersistQuery(event.query.queryKey)
    ) {
      timer = setTimeout(save, SAVE_DELAY_MS);
    }
  });
  const onVisibility = () => {
    if (document.visibilityState === "hidden" && timer !== null) save();
  };
  if (typeof document !== "undefined")
    document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stopped = true;
    unsubscribe();
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVisibility);
    if (timer !== null) clearTimeout(timer);
  };
}

/** 세션이 닫힐 때: 암호문과 키를 함께 지운다(키가 없으면 남은 암호문도 풀 수 없다). */
export async function clearQueryCache(): Promise<void> {
  generation += 1;
  cachedKey = null;
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // 접근 실패 — 키를 지우면 남은 암호문은 쓸모없다.
  }
  await removeQueryCacheKey().catch(() => undefined);
}
