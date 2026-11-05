import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectionCard } from "./connection-card";
import { ConnectionRegistrationForm } from "./registration-form";
import { connectionFixture as item } from "./fixtures.test-support";

/** 계좌 고르기 줄(⌃⌄) — ⋯ 메뉴 버튼도 aria-haspopup="menu"라 '조회할 계좌'를 품은 버튼만 고른다. */
const accountRow = (html: string) =>
  html.match(/<button(?=[^>]*aria-haspopup="menu")[^>]*>(?:(?!<\/button>).)*조회할 계좌(?:(?!<\/button>).)*<\/button>/)?.[0] ?? "";
const card = (patch: Partial<typeof item> = {}, canManage = true, unconfirmed = false, enabled = true) => renderToStaticMarkup(
  <ConnectionCard item={{ ...item, ...patch }} disabled={false} enabled={enabled} canManage={canManage} unconfirmed={unconfirmed} onSelect={() => {}} onRefresh={() => {}} onDisconnect={() => {}} />,
);
describe("connection screen presentation contract", () => {
  it("목록을 다시 읽는 동안(busy)에는 제출만 막고 입력칸은 그대로 둔다", () => {
    // 입력칸을 막으면 포커스가 빠져 키보드가 내려가고, 60초마다 그렇게 된다.
    const html = renderToStaticMarkup(<ConnectionRegistrationForm busy onSubmit={async () => {}} onClose={() => {}} />);
    for (const input of html.match(/<input[^>]*>/g) ?? []) expect(input).not.toMatch(/\sdisabled=""/);
    expect(html).not.toMatch(/<fieldset[^>]*\sdisabled=""/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
  it("renders empty password inputs, unselected consents, owner context and retention disclosure", () => {
    const html = renderToStaticMarkup(<ConnectionRegistrationForm busy={false} onSubmit={async () => {}} onClose={() => {}} />);
    expect((html.match(/type="password"/g) ?? [])).toHaveLength(2);
    expect((html.match(/type="checkbox"/g) ?? [])).toHaveLength(3);
    for (const checkbox of html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []) {
      expect(checkbox).toContain('required=""');
    }
    expect(html).not.toContain("checked=");
    expect(html).not.toContain("value=");
    // 누구 계정에 연결되는지와 두 키를 어디서 받는지를 폼 안에서 말한다(2026-11-05 HIG 검수).
    expect(html).toContain("가족 계좌는 그 가족이 자기 계정에서 연결해요");
    expect(html).toContain("developers.tossinvest.com");
    expect(html).not.toContain("API 키");
    expect(html).toContain("이전에 조회한 기록은 보관");
    expect(html).toContain("앱을 닫아 둔 동안에는 자동 조회하지 않아요");
    expect(html).toContain("자산 또는 연결 화면을 열 때 보유 주식을 새로 조회하는 데 동의해요");
    const steps = html.match(/<ol[^>]*aria-label="연결 순서"[^>]*>(.*?)<\/ol>/)?.[1] ?? "";
    expect(steps.indexOf("키 등록")).toBeLessThan(steps.indexOf("계좌 선택"));
    expect(steps.indexOf("계좌 선택")).toBeLessThan(steps.indexOf("조회"));
    expect((steps.match(/aria-current="step"/g) ?? [])).toHaveLength(1);
    expect(html.indexOf("<fieldset")).toBeLessThan(html.indexOf("<details"));
    // 흰 패널 위 입력칸은 기본 채움(bg-muted)으로 보인다. 흰 배경으로 덮으면 칸이 사라진다(2026-11-04 신고).
    for (const input of html.match(/<input[^>]*type="password"[^>]*>/g) ?? []) {
      expect(input).toContain("bg-muted");
      expect(input).not.toMatch(/bg-(background|card)\b/);
    }
  });
  it("separates KRW and USD rather than presenting a combined asset total", () => {
    const html = card();
    expect(html).toContain("123,456.75원");
    expect(html).toContain("$98.00");
    expect(html).toContain("국내 주식");
    expect(html).toContain("미국 주식");
    expect(html).not.toContain("총자산");
  });
  it("distinguishes missing values from provider-supplied zero", () => {
    const html = card({ snapshot: { ...item.snapshot!, totals: [{ currency: "KRW", marketValue: "0", afterCostValue: "0" }], items: [] } });
    expect(html).toContain(">0원<");
    expect(html).toContain("조회 내역 없음");
    expect(html).not.toContain("$0.00");
    expect(html).toContain("조회된 보유 주식이 없어요");
  });
  it("retains stale values with a clear label for provider failure and unknown HTTP results", () => {
    expect(card({ status: "error", errorCode: "provider_unavailable" })).toContain("이전 조회 내역");
    const html = card({}, true, true);
    expect(html).toContain("조회 확인 필요");
    expect(html).toContain("이전 조회 내역");
    expect(html).toContain("123,456.75원");
  });
  it("조회가 멈춘 이유는 회색 안내 줄이 아니라 오류 알림(role=alert)이다", () => {
    const html = card({ status: "error", errorCode: "provider_denied" });
    expect(html).toMatch(/<div[^>]*role="alert"[^>]*>[\s\S]*토스증권이 조회를 거절했어요/);
    expect(html).not.toMatch(/<p role="status"[^>]*>토스증권이 조회를 거절했어요/);
    expect(card({ errorCode: null })).not.toContain('role="alert"');
  });
  it("labels a disabled service's saved snapshot as previous data", () => {
    const html = card({}, true, false, false);
    expect(html).toContain("이전 조회 내역");
    expect(html).toContain("123,456.75원");
    expect(html).toContain("$98.00");
    expect(html).toContain("마지막 조회 성공");
  });
  it("requires explicit choice even when there is only one verified account", () => {
    const html = card({ status: "select_account", snapshot: null, selectedAccountId: null, canRefresh: false });
    expect(html).toContain("계좌를 선택해 주세요");
    // 하나뿐이어도 미리 고르지 않는다 — 빈 값('계좌 선택')이 보이고 제출은 막힌다.
    const row = accountRow(html);
    expect(row).toContain("조회할 계좌");
    expect(row).toMatch(/data-empty=""[^>]*>계좌 선택</);
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>이 계좌 조회하기/);
    expect(html).not.toContain(`value="${"a".repeat(64)}" selected`);
  });
  it("목록을 다시 읽는 동안(disabled)에도 계좌 고르는 줄은 막지 않고, 앱 공통 값 고르기 줄(⌃⌄ 드롭다운)을 쓴다", () => {
    // 줄을 막으면 열어 둔 목록이 닫힌다(60초마다). 모양이 다른 Select 상자(role="combobox")는 쓰지 않는다.
    const html = renderToStaticMarkup(
      <ConnectionCard item={{ ...item, status: "select_account", snapshot: null, selectedAccountId: null, canRefresh: false }} disabled enabled canManage onSelect={() => {}} onRefresh={() => {}} onDisconnect={() => {}} />,
    );
    const trigger = accountRow(html).match(/^<button[^>]*>/)?.[0] ?? "";
    expect(trigger).not.toBe("");
    expect(trigger).toContain('type="button"');
    expect(trigger).not.toMatch(/\sdisabled=""/);
    expect(html).not.toContain('role="combobox"');
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>이 계좌 조회하기/);
  });
  it("does not call account selection a successful holdings lookup", () => {
    const html = card({ snapshot: null, lastSuccessAt: null });
    expect(html).toContain("조회 전");
    expect(html).not.toContain("조회 완료");
  });
  it("offers no writes to a viewer", () => {
    const html = card({}, false);
    expect(html).not.toContain("새로 조회하기</button>");
    expect(html).not.toContain("연결 해제");
    expect(html).not.toContain('aria-label="토스증권 연결 메뉴"');
  });
  it("화면이 고른 카드 한 장만 다음 행동이 채움 버튼이고, 나머지는 약한 버튼이다", () => {
    const refresh = (html: string) => html.match(/<button[^>]*>새로 조회하기<\/button>/)?.[0] ?? "";
    const primary = refresh(card());
    expect(primary).toContain("bg-primary text-primary-foreground");
    const other = refresh(renderToStaticMarkup(
      <ConnectionCard item={item} disabled={false} enabled canManage primary={false} onSelect={() => {}} onRefresh={() => {}} onDisconnect={() => {}} />,
    ));
    expect(other).not.toBe("");
    expect(other).not.toContain("text-primary-foreground");
    expect(other).toContain("bg-primary/10");
  });
  it("마지막 조회 시각은 칩 크기가 아니라 본문 크기 정보 줄이고, 앱 공통 날짜 표기다", () => {
    const html = card({ lastSuccessAt: "2026-11-05T12:17:00Z" });
    expect(html).toMatch(/<span[^>]*text-body[^>]*>마지막 조회 성공<\/span>/);
    expect(html).not.toContain("text-micro");
    expect(html).not.toMatch(/\d{4}\. \d{2}\. \d{2}\./);
  });
});
