import { describe, expect, it } from "vitest";

import {
  monthName,
  transactionsEmptyCopy,
  type TransactionsEmptyInput,
} from "./empty-state-copy";

const base: TransactionsEmptyInput = {
  month: "2026-11",
  currentMonth: "2026-11",
  hasOtherConditions: false,
  reviewOnly: false,
  query: "",
  hasAnyTransaction: true,
  monthsWithTransactions: ["2026-09", "2026-10"],
};

describe("monthName", () => {
  it("올해는 달만, 다른 해는 연도까지 쓴다", () => {
    expect(monthName("2026-11", "2026-11")).toBe("11월");
    expect(monthName("2025-12", "2026-01")).toBe("2025년 12월");
    expect(monthName("", "2026-11")).toBe("");
  });
});

describe("transactionsEmptyCopy — 조건 없이 이번 달", () => {
  it("이전 거래가 있으면 연결 권유 대신 지난달로 보낸다", () => {
    const copy = transactionsEmptyCopy(base);
    expect(copy.title).toBe("11월 거래는 아직 없어요");
    expect(copy.description).toBeNull();
    expect(copy.action).toEqual({
      kind: "showMonth",
      label: "지난달 보기",
      month: "2026-10",
    });
  });

  it("지난달이 비었으면 거래가 있는 가장 가까운 달로 보낸다", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      monthsWithTransactions: ["2026-07", "2026-03"],
    });
    expect(copy.action).toEqual({
      kind: "showMonth",
      label: "7월 보기",
      month: "2026-07",
    });
  });

  it("해가 바뀐 1월의 지난달은 작년 12월이다", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      month: "2027-01",
      currentMonth: "2027-01",
      monthsWithTransactions: ["2026-12"],
    });
    expect(copy.title).toBe("1월 거래는 아직 없어요");
    expect(copy.action).toMatchObject({
      label: "지난달 보기",
      month: "2026-12",
    });
  });

  it("거래가 하나도 없을 때만 장치 연결을 권한다", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      hasAnyTransaction: false,
      monthsWithTransactions: [],
    });
    expect(copy.title).toBe("아직 거래가 없어요");
    expect(copy.action).toEqual({
      kind: "connectDevice",
      label: "장치 연결하러 가기",
      href: "/devices",
    });
  });

  it("거래가 하나라도 있는지 모르면 장치 권유 없이 중립 문구만", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      hasAnyTransaction: null,
    });
    expect(copy.title).toBe("11월 거래는 아직 없어요");
    expect(copy.action).toBeNull();
  });

  it("거래 여부는 목록 기준이다 — 달별 집계(원화 승인)가 비어도 거래가 있으면 장치를 권하지 않는다", () => {
    // 외화 결제·취소·뺀 거래만 있는 가족은 달별 집계에 달이 하나도 없다.
    const copy = transactionsEmptyCopy({ ...base, monthsWithTransactions: [] });
    expect(copy.title).toBe("11월 거래는 아직 없어요");
    expect(copy.action).toBeNull();
  });

  it("목록에 거래가 없으면 달별 집계가 남아 있어도 장치 연결을 권한다", () => {
    const copy = transactionsEmptyCopy({ ...base, hasAnyTransaction: false });
    expect(copy.action?.kind).toBe("connectDevice");
  });

  it("달별 집계를 모르면 지난달로 보낸다", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      monthsWithTransactions: null,
    });
    expect(copy.action).toEqual({
      kind: "showMonth",
      label: "지난달 보기",
      month: "2026-10",
    });
  });

  it("거래 있는 달이 이번 달뿐이면(목록과 어긋난 낡은 값) 중립 문구만", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      monthsWithTransactions: ["2026-11"],
    });
    expect(copy.action).toBeNull();
  });
});

describe("transactionsEmptyCopy — 조건 결과 0건", () => {
  it("칩 조건이 있으면 조건만 지운다(기간·검색어는 둔다)", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      hasOtherConditions: true,
      query: "스타벅스",
    });
    expect(copy.reason).toBe("noMatch");
    expect(copy.title).toBe("조건에 맞는 거래가 없어요");
    expect(copy.description).toBe("11월 거래 중에서 찾았어요");
    expect(copy.action).toEqual({
      kind: "clearConditions",
      label: "조건 지우기",
    });
  });

  it("확인할 거래 칩은 제목을 바꾼다. 전체 기간이면 범위를 말하지 않는다", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      month: "",
      reviewOnly: true,
    });
    expect(copy.title).toBe("확인할 거래가 없어요");
    expect(copy.description).toBeNull();
    expect(copy.action?.kind).toBe("clearConditions");
  });

  it("확인할 거래 칩에 다른 조건을 더했으면 '조건에 맞는 확인할 거래'라고 한다", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      month: "",
      reviewOnly: true,
      hasOtherConditions: true,
    });
    expect(copy.title).toBe("조건에 맞는 확인할 거래가 없어요");
    expect(copy.action?.kind).toBe("clearConditions");
  });

  it("확인할 거래 칩에 검색어를 더했어도 '조건에 맞는 확인할 거래'라고 한다", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      month: "",
      reviewOnly: true,
      query: "스타벅스",
    });
    expect(copy.title).toBe("조건에 맞는 확인할 거래가 없어요");
  });

  it("검색어만 있으면 검색어를 지운다", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      month: "2026-10",
      query: "스타벅스",
    });
    expect(copy.title).toBe("검색어와 맞는 거래가 없어요");
    expect(copy.description).toBe("10월 거래 중에서 찾았어요");
    expect(copy.action).toEqual({
      kind: "clearSearch",
      label: "검색어 지우기",
    });
  });

  it("다른 달만 골랐으면 이번 달로 돌아간다", () => {
    const copy = transactionsEmptyCopy({ ...base, month: "2026-08" });
    expect(copy.reason).toBe("empty");
    expect(copy.title).toBe("8월 거래가 없어요");
    expect(copy.action).toEqual({
      kind: "showMonth",
      label: "이번 달 보기",
      month: "2026-11",
    });
  });

  it("조건 없이 전체 기간이 비었으면 거래가 하나도 없는 것이다", () => {
    const copy = transactionsEmptyCopy({
      ...base,
      month: "",
      hasAnyTransaction: null,
      monthsWithTransactions: null,
    });
    expect(copy.title).toBe("아직 거래가 없어요");
    expect(copy.action?.kind).toBe("connectDevice");
  });

  it("문구에 없어진 '필터'를 쓰지 않는다", () => {
    const inputs: TransactionsEmptyInput[] = [
      { ...base, hasOtherConditions: true },
      { ...base, reviewOnly: true, query: "a" },
      { ...base, query: "a" },
      { ...base, month: "2026-01" },
      base,
    ];
    for (const input of inputs) {
      const copy = transactionsEmptyCopy(input);
      const text = [copy.title, copy.description, copy.action?.label].join(" ");
      expect(text).not.toContain("필터");
    }
  });
});
