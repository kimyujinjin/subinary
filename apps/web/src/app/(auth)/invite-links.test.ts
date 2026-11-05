import { describe, expect, it } from "vitest";

import { safeInternalPath } from "@/lib/safe-redirect";

import {
  DEAD_INVITE_NOTICE,
  INVITE_ONLY_NOTICE,
  inviteTokenFromReturnTo,
  joinPathFor,
  loginHrefFor,
  registerHrefFor,
  registerNoticeFor,
} from "./invite-links";

// 실제 토큰은 base64url이지만, 인코딩이 한 겹이라도 어긋나면 깨지는 문자를 일부러 넣는다.
const TRICKY = "a/b+c=d&e%f";

/** 로그인 화면이 하는 일 그대로: 바깥 쿼리를 풀고 → 내부 경로만 통과 → 초대 토큰. */
function loginReadsInvite(loginHref: string): string | null {
  const returnTo = new URL(loginHref, "https://app.invalid").searchParams.get(
    "returnTo"
  );
  const safe = safeInternalPath(returnTo) ?? "/dashboard";
  return inviteTokenFromReturnTo(safe);
}

describe("초대 토큰 왕복 — 가입 ↔ 로그인 ↔ 수락에서 토큰이 그대로 남는다", () => {
  it("가입 화면의 로그인 링크는 초대 수락으로 돌아오는 returnTo를 싣는다", () => {
    expect(loginHrefFor("tok123")).toBe(
      "/login?returnTo=%2Fjoin%3Ftoken%3Dtok123"
    );
  });

  it("두 겹 인코딩이어도 로그인 화면이 원래 토큰을 그대로 읽는다", () => {
    expect(loginReadsInvite(loginHrefFor(TRICKY))).toBe(TRICKY);
  });

  it("로그인 → 가입 링크도 같은 토큰을 invite로 넘긴다", () => {
    const token = loginReadsInvite(loginHrefFor(TRICKY));
    const href = registerHrefFor(token);
    expect(href).not.toBeNull();
    const invite = new URL(href ?? "", "https://app.invalid").searchParams.get(
      "invite"
    );
    expect(invite).toBe(TRICKY);
  });

  it("수락 화면 경로는 토큰을 한 번만 인코딩한다(/join 화면이 만드는 링크와 같다)", () => {
    expect(joinPathFor(TRICKY)).toBe(
      `/join?token=${encodeURIComponent(TRICKY)}`
    );
  });

  it("초대가 없으면 그냥 로그인 화면으로 간다", () => {
    expect(loginHrefFor(null)).toBe("/login");
  });
});

describe("inviteTokenFromReturnTo — 초대 수락으로 돌아가는 길만 알아본다", () => {
  it.each([
    ["/join?token=abc", "abc"],
    ["/join/?token=abc", "abc"], // 정적 export(trailingSlash)
    [`/join?token=${encodeURIComponent(TRICKY)}`, TRICKY],
  ])("%s → 토큰", (returnTo, token) => {
    expect(inviteTokenFromReturnTo(returnTo)).toBe(token);
  });

  it.each([
    ["/dashboard"],
    ["/join"],
    ["/join?token="],
    ["/joinus?token=abc"],
    ["/household?token=abc"],
  ])("%s → 초대 아님", (returnTo) => {
    expect(inviteTokenFromReturnTo(returnTo)).toBeNull();
  });
});

describe("registerHrefFor — 초대 없이 가입 화면을 열지 않는다", () => {
  it("초대가 있으면 invite를 실은 가입 링크", () => {
    expect(registerHrefFor("abc")).toBe("/register?invite=abc");
  });

  it("초대가 없으면 링크가 없다", () => {
    expect(registerHrefFor(null)).toBeNull();
  });
});

describe("registerNoticeFor — 가입 화면 폼 위 한 줄", () => {
  it("초대 토큰이 없으면 초대 링크로 가입한다고 안내한다", () => {
    expect(registerNoticeFor(null, undefined, false)).toBe(INVITE_ONLY_NOTICE);
  });

  it("초대 미리보기에 가족 이름이 있으면 이름을 붙인다", () => {
    expect(
      registerNoticeFor(
        "abc",
        { status: "pending", householdName: "우리집" },
        false
      )
    ).toBe("'우리집' 가족 초대로 가입해요");
  });

  it("미리보기를 아직 못 받았으면 이름 없이 말한다", () => {
    expect(registerNoticeFor("abc", undefined, false)).toBe(
      "가족 초대로 가입해요"
    );
  });

  it.each(["accepted", "revoked", "expired"] as const)(
    "%s 초대는 쓸 수 없다고 말한다",
    (status) => {
      expect(
        registerNoticeFor("abc", { status, householdName: null }, false)
      ).toBe(DEAD_INVITE_NOTICE);
    }
  );

  it("없는 초대(404)도 쓸 수 없다고 말한다", () => {
    expect(registerNoticeFor("abc", undefined, true)).toBe(DEAD_INVITE_NOTICE);
  });

  it("문구에 개발 용어·영어를 내지 않는다", () => {
    for (const text of [INVITE_ONLY_NOTICE, DEAD_INVITE_NOTICE]) {
      expect(text).not.toMatch(/[A-Za-z]/);
    }
  });
});
