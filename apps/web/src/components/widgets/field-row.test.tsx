/**
 * 설정 앱 스타일 '이름 · 값' 줄(`FieldList`·`FieldRow`) — 거래 상세에서 공용 위젯으로 옮겼다(2026-11-05 HIG 검수 3·4단계).
 *
 * 값이 비었을 때(muted) 쓰던 `text-muted-foreground/60`은 흰 바탕 대비 약 2.5:1이라 AA(4.5:1)에 못 미쳤다.
 * 렌더한 클래스와 `globals.css` 토큰으로 직접 잰다. WCAG 식은 `widget-contrast.test.tsx`와 같다
 * (그쪽 헬퍼는 테스트 파일이라 내보내지 않아 짧게 다시 둔다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as legacy from "@/app/(app)/transactions/detail-fields";

import { FieldList, FieldRow } from "./field-row";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

type Scope = ":root" | ".dark";
type Rgb = [number, number, number];

function token(scope: Scope, name: string): Rgb {
  const escaped = scope.replace(/[.:]/g, "\\$&");
  const open = new RegExp(`^${escaped}\\s*\\{`, "m").exec(css);
  if (!open) throw new Error(`globals.css에 ${scope} 블록이 없다`);
  const from = open.index + open[0].length;
  const body = css.slice(from, css.indexOf("\n}", from));
  const m = new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`).exec(body);
  if (!m) throw new Error(`${scope}에서 --${name}을 찾지 못했다`);
  return [0, 2, 4].map((i) => parseInt(m[1]!.slice(i, i + 2), 16)) as Rgb;
}

function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return top.map((c, i) => c * alpha + bottom[i]! * (1 - alpha)) as Rgb;
}

function luminance(color: Rgb): number {
  const [r, g, b] = color.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number
  ];
  return (hi + 0.05) / (lo + 0.05);
}

/** `text-muted-foreground/70` → 토큰 이름과 농도. 글자 크기 토큰(text-body 등)은 색이 아니라 건너뛴다. */
function textColor(classes: string[]): { name: string; alpha: number } {
  const found = classes
    .filter(
      (c) =>
        c.startsWith("text-") &&
        !/^text-(display|title|heading|body|caption|micro|left|right|center)$/.test(
          c
        )
    )
    .map((c) => {
      const [name, pct] = c.slice("text-".length).split("/");
      return { name: name!, alpha: pct ? Number(pct) / 100 : 1 };
    });
  if (found.length !== 1)
    throw new Error(`글자 색 클래스가 하나가 아니다: ${classes.join(" ")}`);
  return found[0]!;
}

function ratioOn(
  classes: string[],
  scope: Scope,
  surface: "background" | "card"
) {
  const { name, alpha } = textColor(classes);
  const base = token(scope, surface);
  return contrast(over(token(scope, name), alpha, base), base);
}

const SCOPES: Scope[] = [":root", ".dark"];
const SURFACES = ["background", "card"] as const;

const options = [
  { value: "a", label: "카페" },
  { value: "b", label: "식비" },
];

describe("FieldRow — 위치 이동", () => {
  it("거래 상세의 옛 경로는 같은 부품을 다시 내보낸다(기존 import가 그대로 동작)", () => {
    expect(legacy.FieldRow).toBe(FieldRow);
    expect(legacy.FieldList).toBe(FieldList);
  });

  it("공용 위젯 목록(`@/components/widgets`)에서 달 이동·설정 줄을 내보낸다", () => {
    // 위젯 묶음을 통째로 불러오면 다른 위젯의 브라우저 의존까지 따라와서 원문으로 확인한다.
    const index = readFileSync(
      join(process.cwd(), "src/components/widgets/index.ts"),
      "utf8"
    );
    expect(index).toMatch(
      /export \{ MonthNav, type MonthNavProps \} from "\.\/month-nav";/
    );
    expect(index).toMatch(
      /export \{ FieldList, FieldRow, type FieldRowProps \} from "\.\/field-row";/
    );
  });
});

describe("FieldRow — 대비", () => {
  const emptyRow = renderToStaticMarkup(
    <FieldRow
      label="카드"
      value="카드 미연결"
      muted
      menu={{ label: "카드", options, value: null, onSelect: () => undefined }}
    />
  );
  const emptyValue = /<span[^>]*class="([^"]*)"[^>]*>카드 미연결<\/span>/.exec(
    emptyRow
  );

  it("비어 있는 값도 다른 값과 같은 회색이다 — 더 흐리게(/60) 하지 않는다", () => {
    expect(emptyValue).not.toBeNull();
    const cls = emptyValue![1]!.split(/\s+/);
    expect(cls).toContain("text-muted-foreground");
    expect(cls.some((c) => c.startsWith("text-muted-foreground/"))).toBe(false);
    expect(emptyValue![0]).toContain('data-empty=""');
  });

  for (const scope of SCOPES) {
    for (const surface of SURFACES) {
      it(`${scope} ${surface} 위 비어 있는 값 글자는 AA(4.5:1) 이상`, () => {
        const ratio = ratioOn(emptyValue![1]!.split(/\s+/), scope, surface);
        expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  const rows = renderToStaticMarkup(
    <FieldList>
      <FieldRow
        label="카테고리"
        value="카페"
        menu={{
          label: "카테고리",
          options,
          value: "a",
          onSelect: () => undefined,
        }}
      />
      <FieldRow label="메모" value="남기기" muted onClick={() => undefined} />
    </FieldList>
  );

  for (const icon of ["lucide-chevrons-up-down", "lucide-chevron-right"]) {
    for (const scope of SCOPES) {
      it(`${scope} 바탕 위 ${icon} 표시는 그래픽 대비(3:1) 이상 — 눌리는 줄임을 알아볼 수 있다`, () => {
        const m = new RegExp(
          `<svg[^>]*class="([^"]*${icon}[^"]*)"`
        ).exec(rows);
        expect(m, icon).not.toBeNull();
        const ratio = ratioOn(
          m![1]!.split(/\s+/).filter((c) => !c.startsWith("lucide")),
          scope,
          "background"
        );
        expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe("FieldRow — 구분", () => {
  it("값 고르기 줄은 ⌃⌄와 menu 팝업, 창 여는 줄은 ›와 dialog 팝업, 읽기 전용은 버튼이 아니다", () => {
    const html = renderToStaticMarkup(
      <FieldList>
        <FieldRow label="결제자" value="수빈" />
        <FieldRow
          label="카테고리"
          value="카페"
          menu={{
            label: "카테고리",
            options,
            value: "a",
            onSelect: () => undefined,
          }}
        />
        <FieldRow label="메모" value="남기기" onClick={() => undefined} />
      </FieldList>
    );
    const buttons = html.match(/<button[\s\S]*?<\/button>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toContain('aria-haspopup="menu"');
    expect(buttons[0]).not.toContain('aria-haspopup="dialog"');
    expect(buttons[0]).toContain("lucide-chevrons-up-down");
    expect(buttons[1]).toContain('aria-haspopup="dialog"');
    expect(buttons[1]).toContain("lucide-chevron-right");
    // 읽기 전용 줄에는 표시가 없다.
    expect(html.match(/<svg/g)).toHaveLength(2);
  });

  it("이름 칸은 최소 80px이고, 긴 이름은 값 자리를 다 먹지 않게 줄을 바꾼다", () => {
    const html = renderToStaticMarkup(
      <FieldRow label="카드 번호 끝 네 자리" value="9908" />
    );
    const label =
      /<span[^>]*class="([^"]*)"[^>]*>카드 번호 끝 네 자리<\/span>/.exec(html);
    expect(label).not.toBeNull();
    const cls = label![1]!.split(/\s+/);
    expect(cls).toEqual(
      expect.arrayContaining([
        "text-body",
        "text-foreground",
        "min-w-20",
        "shrink-0",
        "break-words",
      ])
    );
    expect(cls).not.toContain("w-20");
  });
});
