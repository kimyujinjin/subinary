import { describe, expect, it } from "vitest";

import {
  amountInputToMinor,
  clearDetailErrors,
  detailActionField,
  detailSaveSlot,
  detailSavesFor,
  minorToAmountInput,
  savedToast,
  settleDetailSave,
  startDetailSave,
  type DetailSaves,
} from "./detail-save";

describe("detailActionField — 진행 표시·오류를 띄울 줄", () => {
  it("상세 줄에서 고른 값은 그 줄이다", () => {
    expect(
      detailActionField({ kind: "update", body: { categoryId: "c" } })
    ).toBe("category");
    expect(
      detailActionField({
        kind: "update",
        body: { categoryId: "c", applyRule: true },
      })
    ).toBe("category");
    expect(detailActionField({ kind: "update", body: { cardId: null } })).toBe(
      "card"
    );
    expect(
      detailActionField({ kind: "update", body: { visibility: "private" } })
    ).toBe("visibility");
    expect(detailActionField({ kind: "update", body: { memo: "" } })).toBe(
      "memo"
    );
  });

  it("금액·날짜 수정과 확인·빼기·연결은 줄이 아니다", () => {
    expect(
      detailActionField({ kind: "update", body: { amount: 1000 } })
    ).toBeNull();
    expect(
      detailActionField({ kind: "update", body: { occurredAt: "x" } })
    ).toBeNull();
    for (const kind of [
      "markValid",
      "exclude",
      "include",
      "linkCancellation",
      "resolveCard",
    ]) {
      expect(detailActionField({ kind })).toBeNull();
    }
    expect(detailActionField(null)).toBeNull();
  });
});

describe("savedToast — 결과가 제자리에서 보이면 토스트를 띄우지 않는다", () => {
  it("값 고치기는 토스트가 없다", () => {
    expect(savedToast("update")).toBeNull();
  });

  it("결과가 바로 보이지 않는 동작은 한 일을 말한다", () => {
    expect(savedToast("markValid")).toBe("정상 결제로 확인했어요");
    expect(savedToast("markValid", "cancellation")).toBe("확인했어요");
    expect(savedToast("exclude")).toBe("합계에서 뺐어요");
    expect(savedToast("include")).toBe("합계에 다시 넣었어요");
    expect(savedToast("linkCancellation")).toBe("원래 결제와 연결했어요");
    expect(savedToast("resolveCard")).toBe("카드를 연결하고 확인했어요");
  });
});

describe("금액 칸 ↔ minor units", () => {
  it("원화는 그대로다", () => {
    expect(minorToAmountInput(13380, "KRW")).toBe("13380");
    expect(amountInputToMinor("13380", "KRW")).toBe("13380");
  });

  it("외화는 주 단위로 보여 주고 minor units로 되돌린다(100배 어긋나지 않는다)", () => {
    expect(minorToAmountInput(1234, "USD")).toBe("12.34");
    expect(minorToAmountInput(5, "USD")).toBe("0.05");
    expect(minorToAmountInput(1200, "USD")).toBe("12.00");
    expect(amountInputToMinor("12.34", "USD")).toBe("1234");
    expect(amountInputToMinor("12.3", "USD")).toBe("1230");
    expect(amountInputToMinor("12.", "USD")).toBe("1200");
    expect(amountInputToMinor("12", "USD")).toBe("1200");
    expect(amountInputToMinor("0.05", "USD")).toBe("5");
    expect(amountInputToMinor("1300", "JPY")).toBe("1300");
  });

  it("오간 값이 처음과 같다", () => {
    for (const amount of [1, 9, 10, 99, 100, 123456]) {
      expect(amountInputToMinor(minorToAmountInput(amount, "USD"), "USD")).toBe(
        String(amount)
      );
    }
  });

  it("빈 값·숫자 아님은 검사가 막도록 그대로 둔다", () => {
    expect(amountInputToMinor("", "USD")).toBe("");
    expect(amountInputToMinor("abc", "USD")).toBe("abc");
    expect(minorToAmountInput(-1, "USD")).toBe("");
  });
});

describe("거래·자리마다 따로 두는 저장 상태", () => {
  const category = {
    kind: "update" as const,
    id: "t1",
    body: { categoryId: "c-new" },
  };
  const visibility = {
    kind: "update" as const,
    id: "t1",
    body: { visibility: "private" as const },
  };

  it("줄은 그 줄 자리, 나머지 동작은 'action' 자리다", () => {
    expect(detailSaveSlot(category)).toBe("category");
    expect(detailSaveSlot({ kind: "markValid", id: "t1" })).toBe("action");
    expect(
      detailSaveSlot({ kind: "update", id: "t1", body: { amount: 1000 } })
    ).toBe("action");
  });

  it("카테고리 저장 중에 공개 범위를 골라도 카테고리 진행 표시와 고른 값이 남는다", () => {
    let saves: DetailSaves = {};
    saves = startDetailSave(saves, category, 1);
    saves = startDetailSave(saves, visibility, 2);
    const view = detailSavesFor(saves, "t1");
    expect(view.category?.status).toBe("pending");
    expect(view.category?.body?.categoryId).toBe("c-new");
    expect(view.visibility?.status).toBe("pending");
  });

  it("카테고리 저장이 나중에 실패해도 그 줄의 오류로 남는다(마지막 호출에 묶이지 않는다)", () => {
    let saves: DetailSaves = {};
    saves = startDetailSave(saves, category, 1);
    saves = startDetailSave(saves, visibility, 2);
    saves = settleDetailSave(saves, visibility, 2, null);
    saves = settleDetailSave(saves, category, 1, "분류를 바꾸지 못했어요");
    const view = detailSavesFor(saves, "t1");
    expect(view.visibility).toBeUndefined();
    expect(view.category).toMatchObject({
      status: "error",
      message: "분류를 바꾸지 못했어요",
      body: null,
    });
  });

  it("같은 자리를 다시 저장했으면 앞 호출의 결과가 뒤 호출의 표시를 지우지 않는다", () => {
    let saves: DetailSaves = {};
    saves = startDetailSave(saves, category, 1);
    saves = startDetailSave(
      saves,
      { ...category, body: { categoryId: "c-other" } },
      2
    );
    saves = settleDetailSave(saves, category, 1, "실패");
    expect(detailSavesFor(saves, "t1").category).toMatchObject({
      status: "pending",
      seq: 2,
      body: { categoryId: "c-other" },
    });
  });

  it("다시 저장하면 지난 실패 문구가 진행 표시로 바뀐다", () => {
    let saves: DetailSaves = {};
    saves = startDetailSave(saves, category, 1);
    saves = settleDetailSave(saves, category, 1, "실패");
    saves = startDetailSave(saves, category, 2);
    expect(detailSavesFor(saves, "t1").category?.status).toBe("pending");
    expect(detailSavesFor(saves, "t1").category?.message).toBeNull();
  });

  it("동작(확인·빼기)은 고른 값을 들고 있지 않다", () => {
    const saves = startDetailSave({}, { kind: "exclude", id: "t1" }, 1);
    expect(detailSavesFor(saves, "t1").action).toMatchObject({
      kind: "exclude",
      status: "pending",
      body: null,
    });
  });

  it("상세를 떠나면 그 거래의 실패 문구만 지우고 진행 중인 저장과 다른 거래는 그대로 둔다", () => {
    let saves: DetailSaves = {};
    saves = startDetailSave(saves, category, 1);
    saves = settleDetailSave(saves, category, 1, "실패");
    saves = startDetailSave(saves, visibility, 2);
    saves = startDetailSave(saves, { ...category, id: "t2" }, 3);
    saves = settleDetailSave(saves, { ...category, id: "t2" }, 3, "실패");
    saves = clearDetailErrors(saves, "t1");
    expect(detailSavesFor(saves, "t1").category).toBeUndefined();
    expect(detailSavesFor(saves, "t1").visibility?.status).toBe("pending");
    expect(detailSavesFor(saves, "t2").category?.status).toBe("error");
  });

  it("자리를 주면 그 자리의 실패 문구만 지운다", () => {
    let saves: DetailSaves = {};
    saves = startDetailSave(saves, { kind: "update", id: "t1", body: { memo: "m" } }, 1);
    saves = settleDetailSave(saves, { kind: "update", id: "t1", body: { memo: "m" } }, 1, "실패");
    saves = startDetailSave(saves, { kind: "markValid", id: "t1" }, 2);
    saves = settleDetailSave(saves, { kind: "markValid", id: "t1" }, 2, "실패");
    saves = clearDetailErrors(saves, "t1", "memo");
    expect(detailSavesFor(saves, "t1").memo).toBeUndefined();
    expect(detailSavesFor(saves, "t1").action?.status).toBe("error");
  });

  it("지울 것이 없으면 같은 객체를 돌려준다(쓸데없이 다시 그리지 않게)", () => {
    const saves = startDetailSave({}, category, 1);
    expect(clearDetailErrors(saves, "t1")).toBe(saves);
    expect(settleDetailSave({}, category, 1, null)).toEqual({});
  });
});
