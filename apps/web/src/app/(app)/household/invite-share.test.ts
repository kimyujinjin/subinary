import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_INVITE_EXPIRY_HOURS,
  INVITE_EXPIRY_OPTIONS,
  canShareLink,
  inviteExpiryLabel,
  inviteResultBackAction,
  inviteShareText,
  shareInviteLink,
} from "./invite-share";

describe("초대 링크 유효 기간", () => {
  it("날 단위로 고르고(1일·3일·7일·30일) 서버에는 시간으로 보낸다", () => {
    expect(INVITE_EXPIRY_OPTIONS.map((o) => o.label)).toEqual([
      "1일",
      "3일",
      "7일",
      "30일",
    ]);
    expect(INVITE_EXPIRY_OPTIONS.map((o) => Number(o.value))).toEqual([
      24, 72, 168, 720,
    ]);
    // 서버 허용 범위(1~720시간) 안이다.
    for (const option of INVITE_EXPIRY_OPTIONS) {
      expect(Number(option.value)).toBeGreaterThanOrEqual(1);
      expect(Number(option.value)).toBeLessThanOrEqual(720);
    }
  });

  it("기본은 7일이다", () => {
    expect(DEFAULT_INVITE_EXPIRY_HOURS).toBe(168);
    expect(inviteExpiryLabel(DEFAULT_INVITE_EXPIRY_HOURS)).toBe("7일");
  });

  it("선택지에 없는 값은 시간 그대로 보여 준다", () => {
    expect(inviteExpiryLabel(5)).toBe("5시간");
  });
});

describe("초대 링크 전달", () => {
  it("공유 시트가 없으면(Android 웹뷰) 공유를 쓰지 않는다 — 복사가 주 버튼", () => {
    expect(canShareLink(undefined)).toBe(false);
    expect(canShareLink({})).toBe(false);
    expect(canShareLink({ share: () => Promise.resolve() })).toBe(true);
  });

  it("공유 문구에 가족 이름을 넣고, 링크는 url로 따로 넘긴다", async () => {
    const share = vi.fn(() => Promise.resolve());
    await expect(
      shareInviteLink(
        { share },
        { url: "https://example.test/join?token=t", householdName: "우리집" }
      )
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "가족 초대",
      text: inviteShareText("우리집"),
      url: "https://example.test/join?token=t",
    });
    expect(inviteShareText("우리집")).toContain("'우리집'");
    expect(inviteShareText("")).not.toContain("''");
  });

  it("사용자가 공유 시트를 닫으면 실패가 아니라 취소다", async () => {
    const abort = Object.assign(new Error("closed"), { name: "AbortError" });
    await expect(
      shareInviteLink(
        { share: () => Promise.reject(abort) },
        { url: "u", householdName: "" }
      )
    ).resolves.toBe("cancelled");
    await expect(
      shareInviteLink(
        { share: () => Promise.reject(new TypeError("blocked")) },
        { url: "u", householdName: "" }
      )
    ).resolves.toBe("failed");
  });
});

describe("초대 결과 창의 안드로이드 뒤로", () => {
  it("링크를 보내기 전에는 무시하고(링크를 잃지 않게), 보낸 뒤에는 창만 닫는다", () => {
    expect(inviteResultBackAction(false)).toBe("ignore");
    expect(inviteResultBackAction(true)).toBe("close");
  });
});
