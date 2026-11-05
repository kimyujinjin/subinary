/**
 * 달 이동(`2026년 11월 ▾  ‹ ›`) — 가계부 세 탭이 같은 부품을 쓰도록 거래 탭 디자인을 공용으로 옮겼다
 * (2026-11-05 HIG 검수 3·4단계). 화살표는 고를 수 있는 달 안에서만, 전체 기간이면 화살표 없음.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MonthNav, monthNavState } from "./month-nav";

const TODAY = "2026-11";

describe("monthNavState — 메뉴 목록과 화살표 경계", () => {
  it("목록 끝에서는 그쪽 화살표가 없고, 가운데서는 양쪽으로 한 달씩 간다", () => {
    const months = ["2026-09", "2026-10", "2026-11"];
    expect(
      monthNavState({ month: "2026-09", months, today: TODAY })
    ).toMatchObject({
      prev: null,
      next: "2026-10",
    });
    expect(
      monthNavState({ month: "2026-10", months, today: TODAY })
    ).toMatchObject({
      prev: "2026-09",
      next: "2026-11",
    });
    expect(
      monthNavState({ month: "2026-11", months, today: TODAY })
    ).toMatchObject({
      prev: "2026-10",
      next: null,
    });
  });

  it("빈 달은 건너뛴다 — 고를 수 있는 달 안에서만 움직인다", () => {
    const state = monthNavState({
      month: "2026-07",
      months: ["2026-03", "2026-07"],
      today: "2026-07",
    });
    expect(state.prev).toBe("2026-03");
    expect(state.next).toBeNull();
  });

  it("달 목록은 순서·중복과 상관없이 받고, 메뉴는 최근 달이 위다", () => {
    const state = monthNavState({
      month: "2026-10",
      months: ["2026-10", "2026-08", "2026-11", "2026-10", "2025-12"],
      today: TODAY,
    });
    expect(state.options.map((o) => o.value)).toEqual([
      "2026-11",
      "2026-10",
      "2026-08",
      "2025-12",
    ]);
    expect(state.options[0]!.label).toBe("2026년 11월");
    expect(state.options.at(-1)!.label).toBe("2025년 12월");
    expect(state.prev).toBe("2026-08");
    expect(state.next).toBe("2026-11");
  });

  it("이번 달은 목록에 없어도(거래 0건) 고를 수 있고 화살표로 돌아올 수 있다", () => {
    const state = monthNavState({
      month: "2026-09",
      months: ["2026-08", "2026-09"],
      today: TODAY,
    });
    expect(state.options[0]).toEqual({
      value: "2026-11",
      label: "2026년 11월",
    });
    expect(state.next).toBe("2026-11");
  });

  it("보고 있는 달이 목록 밖이어도(오래된 딥링크) 메뉴에 있고 경계를 잡는다", () => {
    const state = monthNavState({
      month: "2024-05",
      months: ["2026-10", "2026-11"],
      today: TODAY,
    });
    expect(state.label).toBe("2024년 5월");
    expect(state.options.map((o) => o.value)).toContain("2024-05");
    expect(state.prev).toBeNull();
    expect(state.next).toBe("2026-10");
  });

  it("불러오는 중(months 없음)에는 두 화살표 모두 잠긴다", () => {
    const state = monthNavState({
      month: "2026-10",
      months: undefined,
      today: TODAY,
    });
    expect(state.prev).toBeNull();
    expect(state.next).toBeNull();
    expect(state.showArrows).toBe(true);
    expect(state.options.map((o) => o.value)).toEqual(["2026-11", "2026-10"]);
  });

  it("allowAll이면 메뉴 맨 위가 '전체 기간'이고, 전체 기간이면 화살표를 숨긴다", () => {
    const all = monthNavState({
      month: "",
      months: ["2026-10"],
      allowAll: true,
      today: TODAY,
    });
    expect(all.label).toBe("전체 기간");
    expect(all.options[0]!.label).toBe("전체 기간");
    expect(all.showArrows).toBe(false);
    expect(all.prev).toBeNull();
    expect(all.next).toBeNull();

    const withoutAll = monthNavState({
      month: "2026-10",
      months: ["2026-10"],
      today: TODAY,
    });
    expect(withoutAll.options.map((o) => o.label)).not.toContain("전체 기간");
  });

  it("달 형식이 아닌 값은 목록에서 뺀다", () => {
    const state = monthNavState({
      month: "2026-10",
      months: ["2026-10", "2026-13", "", "bad"],
      today: TODAY,
    });
    expect(state.options.map((o) => o.value)).toEqual(["2026-11", "2026-10"]);
  });
});

/** aria-label로 버튼 시작 태그를 찾는다(속성 순서와 상관없이). */
function buttonTag(html: string, label: string): string | null {
  const tags = html.match(/<button[^>]*>/g) ?? [];
  return tags.find((tag) => tag.includes(`aria-label="${label}"`)) ?? null;
}

function classesOf(tag: string): string[] {
  const m = /class="([^"]*)"/.exec(tag);
  return m ? m[1]!.split(/\s+/) : [];
}

describe("MonthNav 화면", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 서울 기준 2026년 11월 5일 낮 — 이번 달은 2026-11.
    vi.setSystemTime(new Date("2026-11-05T03:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function render(props: Partial<Parameters<typeof MonthNav>[0]> = {}) {
    return renderToStaticMarkup(
      <MonthNav
        month="2026-11"
        months={["2026-09", "2026-10", "2026-11"]}
        onChange={() => undefined}
        {...props}
      />
    );
  }

  it("달 이름은 굵은 heading 글자의 메뉴 버튼이고, 화면 읽기용 이름은 '기간: 2026년 11월'이다", () => {
    const html = render();
    const tag = buttonTag(html, "기간: 2026년 11월");
    expect(tag).not.toBeNull();
    expect(tag).toContain('aria-haspopup="menu"');
    const cls = classesOf(tag!);
    expect(cls).toEqual(
      expect.arrayContaining([
        "text-heading",
        "font-bold",
        "tabular-nums",
        "min-h-11",
        "rounded-control",
      ])
    );
    // 폰에는 hover가 없다 — 눌렀을 때 반응이 보여야 한다.
    expect(cls.some((c) => c.startsWith("active:"))).toBe(true);
    expect(html).toContain("lucide-chevron-down");
    expect(html).toMatch(/<span aria-live="polite"[^>]*>2026년 11월<\/span>/);
  });

  it("화살표는 '이전 달'·'다음 달', 누르는 영역 44px에 아이콘 20px이다", () => {
    const html = render({ month: "2026-10" });
    for (const label of ["이전 달", "다음 달"]) {
      const tag = buttonTag(html, label);
      expect(tag, label).not.toBeNull();
      expect(classesOf(tag!)).toContain("size-11");
      expect(tag).not.toContain('disabled=""');
    }
    expect(
      html.match(/<svg[^>]*class="[^"]*lucide-chevron-(left|right)[^"]*size-5/g)
    ).toHaveLength(2);
  });

  it("고를 수 있는 달의 끝에서는 그쪽 화살표가 잠긴다", () => {
    const last = render({ month: "2026-11" });
    expect(buttonTag(last, "다음 달")).toContain('disabled=""');
    expect(buttonTag(last, "이전 달")).not.toContain('disabled=""');

    const first = render({ month: "2026-09" });
    expect(buttonTag(first, "이전 달")).toContain('disabled=""');
    expect(buttonTag(first, "다음 달")).not.toContain('disabled=""');
  });

  it("이번 달이 목록에 없어도 다음 달 화살표로 이번 달까지 갈 수 있다", () => {
    const html = render({ month: "2026-10", months: ["2026-09", "2026-10"] });
    expect(buttonTag(html, "다음 달")).not.toContain('disabled=""');
  });

  it("불러오는 중이면 두 화살표 모두 잠긴다", () => {
    const html = render({ month: "2026-10", months: undefined });
    expect(buttonTag(html, "이전 달")).toContain('disabled=""');
    expect(buttonTag(html, "다음 달")).toContain('disabled=""');
  });

  it("전체 기간이면 '기간: 전체 기간'이고 화살표가 없다", () => {
    const html = render({ month: "", allowAll: true });
    expect(buttonTag(html, "기간: 전체 기간")).not.toBeNull();
    expect(buttonTag(html, "이전 달")).toBeNull();
    expect(buttonTag(html, "다음 달")).toBeNull();
  });

  it("토큰 밖 글자 크기·모서리를 쓰지 않는다", () => {
    const html = render({ month: "2026-10" });
    expect(html).not.toMatch(
      /(?<![\w-])text-(?:xs|sm|base|lg|xl|2xl)(?![\w-])/
    );
    expect(html).not.toMatch(/text-\[/);
    expect(html).not.toMatch(
      /(?<![\w-])rounded-(?:sm|md|lg|xl|2xl)(?![\w-])|rounded-\[/
    );
  });
});
