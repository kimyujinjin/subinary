import { afterEach, describe, expect, it, vi } from "vitest";

import { DEVICE_TIME_ZONE_NOTE, deviceMatchesSeoulTime } from "./device-time";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deviceMatchesSeoulTime", () => {
  it("기기 시간대가 UTC+9면 한국 시간과 같다고 본다", () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-540);
    expect(deviceMatchesSeoulTime(new Date("2026-11-05T05:31:00Z"))).toBe(true);
  });

  it("해외(베트남 UTC+7)에서는 다르다고 본다 — 상세 '오후 2:31'과 칸 12:31이 어긋난다", () => {
    vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(-420);
    expect(deviceMatchesSeoulTime(new Date("2026-11-05T05:31:00Z"))).toBe(
      false
    );
  });

  it("그 순간의 오프셋으로 판정한다 — 일광 절약 시간이 있는 곳도 거래 시각 기준", () => {
    const spy = vi
      .spyOn(Date.prototype, "getTimezoneOffset")
      .mockReturnValue(240);
    const at = new Date("2026-07-01T00:00:00Z");
    expect(deviceMatchesSeoulTime(at)).toBe(false);
    expect(spy.mock.contexts[0]).toBe(at);
  });

  it("잘못된 날짜면 지금 시각으로 본다", () => {
    const spy = vi
      .spyOn(Date.prototype, "getTimezoneOffset")
      .mockReturnValue(-540);
    expect(deviceMatchesSeoulTime(new Date("잘못된 값"))).toBe(true);
    // 오프셋은 잘못된 날짜가 아니라 지금 시각에서 읽는다.
    const read = spy.mock.contexts[0] as Date;
    expect(Number.isNaN(read.getTime())).toBe(false);
  });

  it("안내 문구는 해요체이고 예전 칸 이름을 되살리지 않는다", () => {
    expect(DEVICE_TIME_ZONE_NOTE).toMatch(/요\.$/);
    expect(DEVICE_TIME_ZONE_NOTE).not.toContain("이 기기의 시간");
  });
});
