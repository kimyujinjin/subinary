import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConnectionCard } from "./connection-card";
import { ConnectionRegistrationForm } from "./registration-form";
import { connectionFixture as item } from "./fixtures.test-support";

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
    expect(html).toContain("다른 가족은 본인 앱 계정");
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
    // 하나뿐이어도 미리 고르지 않는다 — 자리표시자가 보이고 제출은 막힌다.
    expect(html).toMatch(/<button[^>]*role="combobox"[^>]*data-placeholder=""[^>]*>/);
    expect(html).toContain("계좌 선택");
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>이 계좌 조회하기/);
    expect(html).not.toContain(`value="${"a".repeat(64)}" selected`);
  });
  it("목록을 다시 읽는 동안(disabled)에도 계좌 선택 칸은 막지 않고 공용 채움형 칸을 쓴다", () => {
    // 칸을 막으면 열어 둔 목록이 닫힌다(60초마다). 흰 패널 위에서는 흰 배경·테두리로 덮은 칸이 보이지 않는다.
    const html = renderToStaticMarkup(
      <ConnectionCard item={{ ...item, status: "select_account", snapshot: null, selectedAccountId: null, canRefresh: false }} disabled enabled canManage onSelect={() => {}} onRefresh={() => {}} onDisconnect={() => {}} />,
    );
    const trigger = html.match(/<button[^>]*role="combobox"[^>]*>/)?.[0] ?? "";
    expect(trigger).not.toBe("");
    expect(trigger).not.toMatch(/\sdisabled=""/);
    expect(trigger).toContain("bg-muted");
    expect(trigger).not.toMatch(/bg-(background|card)\b/);
    expect(html).toMatch(/<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>이 계좌 조회하기/);
  });
  it("does not call account selection a successful holdings lookup", () => {
    const html = card({ snapshot: null, lastSuccessAt: null });
    expect(html).toContain("조회 전");
    expect(html).not.toContain("조회 완료");
  });
  it("offers no writes to a viewer", () => {
    const html = card({}, false);
    expect(html).not.toContain("새로 조회</button>");
    expect(html).not.toContain("연결 해제</button>");
  });
});
