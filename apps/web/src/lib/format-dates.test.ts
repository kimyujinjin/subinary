/**
 * 날짜·시각 짧은 표기(2026-11-05 HIG 검수 3·4단계): 'M월 D일'·'2026-11-20'·'2026. 11. 05. 14:31'이 섞여 있던 것을
 * 서울 기준 한 가지로 모은다. 테스트 기계의 시간대와 상관없이 서울 날짜로 나와야 한다.
 */
import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatMonthDay,
  formatMonthDayTime,
  formatTimeShort,
} from "./format";

// 서울 2026-11-05 09:00
const NOW = new Date("2026-11-05T00:00:00Z");

describe("formatMonthDay", () => {
  it("올해는 'M월 D일'", () => {
    expect(formatMonthDay("2026-11-05T05:31:00Z", NOW)).toBe("11월 5일");
    expect(formatMonthDay(new Date("2026-03-09T01:00:00Z"), NOW)).toBe(
      "3월 9일"
    );
  });

  it("서울 날짜로 센다 — UTC로는 전날이어도 서울 자정을 넘었으면 다음 날", () => {
    // UTC 11-04 15:05 = 서울 11-05 00:05
    expect(formatMonthDay("2026-11-04T15:05:00Z", NOW)).toBe("11월 5일");
    // UTC 11-04 14:59 = 서울 11-04 23:59
    expect(formatMonthDay("2026-11-04T14:59:00Z", NOW)).toBe("11월 4일");
  });

  it("올해가 아니면 연도를 붙인다 — 해 경계도 서울 기준", () => {
    // 서울 2025-12-31 23:59
    expect(formatMonthDay("2025-12-31T14:59:00Z", NOW)).toBe(
      "2025년 12월 31일"
    );
    // 서울 2026-01-01 00:30 — UTC로는 2025년이지만 올해다
    expect(formatMonthDay("2025-12-31T15:30:00Z", NOW)).toBe("1월 1일");
    expect(formatMonthDay("2027-01-02T03:00:00Z", NOW)).toBe("2027년 1월 2일");
  });

  it("'지금'의 해도 서울 기준이다", () => {
    // UTC로는 2025-12-31이지만 서울은 이미 2026-01-01 01:00
    const newYearSeoul = new Date("2025-12-31T16:00:00Z");
    expect(formatMonthDay("2026-01-01T00:00:00Z", newYearSeoul)).toBe(
      "1월 1일"
    );
    expect(formatMonthDay("2025-12-20T00:00:00Z", newYearSeoul)).toBe(
      "2025년 12월 20일"
    );
  });

  it("날짜만 있는 'YYYY-MM-DD'도 그 날짜", () => {
    expect(formatMonthDay("2026-11-20", NOW)).toBe("11월 20일");
    expect(formatMonthDay("2025-01-01", NOW)).toBe("2025년 1월 1일");
  });

  it("비었거나 무효면 대시", () => {
    expect(formatMonthDay(null, NOW)).toBe("—");
    expect(formatMonthDay(undefined, NOW)).toBe("—");
    expect(formatMonthDay("", NOW)).toBe("—");
    expect(formatMonthDay("not-a-date", NOW)).toBe("—");
    expect(formatMonthDay(new Date(Number.NaN), NOW)).toBe("—");
  });

  it("now를 안 주면 지금 기준(올해 날짜는 연도 없이)", () => {
    expect(formatMonthDay(new Date())).toMatch(/^\d{1,2}월 \d{1,2}일$/);
  });
});

describe("formatTimeShort", () => {
  it("서울 기준 12시간제 '오후 2:31'", () => {
    expect(formatTimeShort("2026-11-05T05:31:00Z")).toBe("오후 2:31");
    expect(formatTimeShort("2026-11-05T00:07:00Z")).toBe("오전 9:07");
    expect(formatTimeShort(new Date("2026-11-05T14:59:00Z"))).toBe(
      "오후 11:59"
    );
  });

  it("자정은 '오전 12:05', 정오는 '오후 12:00'", () => {
    expect(formatTimeShort("2026-11-04T15:05:00Z")).toBe("오전 12:05");
    expect(formatTimeShort("2026-11-05T03:00:00Z")).toBe("오후 12:00");
  });

  it("시간대가 붙은 ISO도 서울로 바꾼다", () => {
    expect(formatTimeShort("2026-11-05T14:31:00+09:00")).toBe("오후 2:31");
    expect(formatTimeShort("2026-11-05T00:31:00-05:00")).toBe("오후 2:31");
  });

  it("비었거나 무효면 대시", () => {
    expect(formatTimeShort(null)).toBe("—");
    expect(formatTimeShort("nope")).toBe("—");
  });
});

describe("formatMonthDayTime", () => {
  it("올해는 '11월 5일 오후 2:31'", () => {
    expect(formatMonthDayTime("2026-11-05T05:31:00Z", NOW)).toBe(
      "11월 5일 오후 2:31"
    );
  });

  it("자정 직후는 서울 날짜와 시각이 함께 넘어간다", () => {
    expect(formatMonthDayTime("2026-11-04T15:05:00Z", NOW)).toBe(
      "11월 5일 오전 12:05"
    );
  });

  it("올해가 아니면 연도를 붙인다", () => {
    expect(formatMonthDayTime("2025-11-05T05:31:00Z", NOW)).toBe(
      "2025년 11월 5일 오후 2:31"
    );
  });

  it("비었거나 무효면 대시", () => {
    expect(formatMonthDayTime(undefined, NOW)).toBe("—");
    expect(formatMonthDayTime("2026-13-45", NOW)).toBe("—");
  });
});

describe("기존 formatDate는 그대로", () => {
  it("분까지 · 날짜만 · 무효 대시", () => {
    expect(formatDate("2026-11-05T05:31:00Z")).toBe("2026. 11. 05. 14:31");
    expect(formatDate("2026-11-05T05:31:00Z", { dateOnly: true })).toBe(
      "2026. 11. 05."
    );
    expect(formatDate(null)).toBe("—");
  });
});
