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
