import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  BILLING_DAY_OPTIONS,
  CardEditFields,
  CardRegisterFields,
} from "./card-fields";

/*
 * 결제 카드 등록·수정 창의 설정 줄 — 2026-11-05 HIG 검수 4단계.
 * 라벨 붙은 드롭다운(Select) 3개 + 스위치 + 설명 4줄을 쌓던 수정 창을 '이름 · 회색 값 · ⌃⌄' 한 목록으로 바꿨다
 * (.claude/rules/web-ui.md 3번). 값은 누른 자리 아래 드롭다운(PickerMenu)으로 고르고, 켜고 끄는 값은 같은 줄의
 * 스위치다. 설명은 값을 바꿔 알아야 할 것이 생길 때만 붙는다. 이름은 모두 합성값이다.
 */

const owners = [
  { memberId: "m-me", name: "수빈 (나)" },
  { memberId: "m-other", name: "지은" },
  { memberId: "m-left", name: "민수 (나간 구성원)", disabled: true },
];

type EditProps = ComponentProps<typeof CardEditFields>;

function renderEdit(changes: Partial<EditProps> = {}): string {
  return renderToStaticMarkup(
    <CardEditFields
      original={{ ownerMemberId: "m-me", visibility: "household" }}
      owners={owners}
      ownerId="m-me"
      onOwnerChange={vi.fn()}
      colorClassOf={() => "bg-accent"}
      visibility="household"
      onVisibilityChange={vi.fn()}
      billingDay="15"
      onBillingDayChange={vi.fn()}
      isShared={false}
      onSharedChange={vi.fn()}
      {...changes}
    />
  );
}

/** 드롭다운으로 여는 줄(⌃⌄)의 버튼 수 — Radix 트리거가 aria-haspopup="menu"를 단다. */
function menuRows(html: string): number {
  return html.split('aria-haspopup="menu"').length - 1;
}

describe("카드 수정 창 설정 줄", () => {
  it("소유자·공개 범위·결제일은 값 고르기 줄, 공용 카드는 스위치 줄이다(Select 없음)", () => {
    const html = renderEdit();
    for (const label of ["소유자", "공개 범위", "결제일", "공용 카드"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(menuRows(html)).toBe(3);
    expect(html).toContain('role="switch"');
    expect(html).toContain("수빈 (나)");
    expect(html).toContain("가족 공개");
    expect(html).toContain("매월 15일");
    expect(html).not.toContain('data-slot="select-trigger"');
    // '정정'은 행 ⋯ 메뉴에서만 연다 — 수정 창 위에 겹쳐 열던 링크가 없다.
    expect(html).not.toContain(">정정<");
  });

  it("바꾸지 않은 값에는 설명을 붙이지 않는다 — 기본 상태의 설명은 '공용 카드' 한 줄뿐", () => {
    const html = renderEdit();
    expect(html).not.toContain("앞으로 들어올 거래부터 적용돼요");
    expect(html).not.toContain("거래에 이미 기록된 구성원은 그대로예요");
    expect(html).toContain("지난 기록까지 &#x27;공용&#x27;으로 묶어요");
  });

  it("공개 범위·소유자를 바꾸면 소급되지 않는다는 설명이 그 줄 아래에 붙는다", () => {
    const html = renderEdit({ visibility: "summary_only", ownerId: "m-other" });
    expect(html).toContain("앞으로 들어올 거래부터 적용돼요");
    expect(html).toContain("거래에 이미 기록된 구성원은 그대로예요");
  });

  it("결제일이 없으면 '선택 안 함'을 빈 값으로 보이고, 선택지는 선택 안 함 + 1~31일이다", () => {
    const html = renderEdit({ billingDay: "" });
    expect(html).toMatch(/data-empty=""[^>]*>선택 안 함</);
    expect(BILLING_DAY_OPTIONS).toHaveLength(32);
    expect(BILLING_DAY_OPTIONS[0]?.label).toBe("선택 안 함");
    expect(BILLING_DAY_OPTIONS[31]?.label).toBe("매월 31일");
  });

  it("나만 보기에서는 공용 카드를 켤 수 없지만, 이미 켜져 있으면 끌 수 있다", () => {
    const off = renderEdit({ visibility: "private", isShared: false });
    expect(off).toMatch(/role="switch"[^>]*disabled=""/);
    const on = renderEdit({ visibility: "private", isShared: true });
    expect(on).not.toMatch(/role="switch"[^>]*disabled=""/);
    expect(on).toContain("이 설정을 꺼 주세요");
  });

  it("저장할 때 막힌 이유는 그 줄 아래에 오류로 보인다", () => {
    const html = renderEdit({
      visibility: "private",
      isShared: true,
      sharedError:
        "나만 보기 카드는 공용 카드로 둘 수 없어요. 이 설정을 꺼 주세요.",
    });
    expect(html).toMatch(
      /role="alert" class="text-destructive">나만 보기 카드는/
    );
  });
});

describe("카드 등록 창 설정 줄", () => {
  function renderRegister(issuerError: string | null = null): string {
    return renderToStaticMarkup(
      <CardRegisterFields
        issuer=""
        onIssuerChange={vi.fn()}
        issuerError={issuerError}
        owners={owners}
        ownerId="m-me"
        onOwnerChange={vi.fn()}
        colorClassOf={() => "bg-accent"}
        visibility="household"
        onVisibilityChange={vi.fn()}
      />
    );
  }

  it("카드사·소유자·공개 범위를 값 고르기 줄로 보이고, 고르지 않은 카드사는 빈 값이다", () => {
    const html = renderRegister();
    expect(menuRows(html)).toBe(3);
    expect(html).toMatch(/data-empty=""[^>]*>고르기</);
    expect(html).toContain("가맹점과 금액을 가족과 모두 공유해요.");
  });

  it("카드사 오류는 폼 맨 아래가 아니라 카드사 줄 아래에 보인다", () => {
    const html = renderRegister("카드사를 골라 주세요.");
    const issuerAt = html.indexOf(">카드사<");
    const errorAt = html.indexOf("카드사를 골라 주세요.");
    const ownerAt = html.indexOf(">소유자<");
    expect(issuerAt).toBeGreaterThan(-1);
    expect(errorAt).toBeGreaterThan(issuerAt);
    expect(errorAt).toBeLessThan(ownerAt);
  });
});
