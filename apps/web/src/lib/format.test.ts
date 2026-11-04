import { describe, expect, it } from "vitest";
import { formatSender } from "./format";

describe("formatSender", () => {
  it("formats 8-digit card company numbers and leaves others as they are", () => {
    expect(formatSender("16617654")).toBe("1661-7654");
    expect(formatSender("15447200")).toBe("1544-7200");
    expect(formatSender("01012345678")).toBe("01012345678");
    expect(formatSender("신한카드")).toBe("신한카드");
  });
});

import { convertToKrw } from "./fx-client";
describe("convertToKrw", () => {
  it("multiplies exact decimals and rounds to won", () => {
    expect(convertToKrw("10294.660625", "1380.5")).toBe(14211779n);
    expect(convertToKrw("0", "1380.5")).toBe(0n);
    expect(convertToKrw("1.5", "1000")).toBe(1500n);
    expect(convertToKrw("0.0004", "1000")).toBe(0n);
    expect(convertToKrw("abc", "1000")).toBeNull();
  });
});
