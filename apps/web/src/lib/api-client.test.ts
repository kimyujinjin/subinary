import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "./api-client";

function failWith(status: number, message: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ statusCode: status, message }), {
          status,
          headers: { "content-type": "application/json" },
        })
    )
  );
}

async function userMessage(status: number, serverMessage: string) {
  failWith(status, serverMessage);
  const error = await apiFetch("/v1/transactions/x/link-cancellation", {
    method: "POST",
  }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiError);
  return (error as ApiError).message;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("환불 연결 실패 문구", () => {
  // 취소로 생긴 기록은 화면에서 '환불'이다(이름 규칙) — 연결 창에 '취소 거래'가 다시 나오지 않게.
  it.each([
    [
      "cancellation is already linked",
      409,
      "이미 원래 결제에 연결된 환불이에요",
    ],
    ["source is not a cancellation transaction", 400, "환불 기록이 아니에요"],
    [
      "target is not an approval transaction",
      400,
      "고른 거래는 결제가 아니에요",
    ],
  ])("%s", async (server, status, expected) => {
    const message = await userMessage(status, server);
    expect(message).toBe(expected);
    expect(message).not.toContain("취소 거래");
    expect(message).not.toContain("승인 거래");
  });
});
