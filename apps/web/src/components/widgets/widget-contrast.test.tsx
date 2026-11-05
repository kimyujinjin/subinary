/**
 * 공용 위젯 색 대비 — 실제로 그려진 클래스(배경 농도 포함)와 `globals.css` 토큰으로 계산한다.
 *
 * 토큰 하나하나는 `lib/color-contrast.test.ts`가 지키지만, 칩·알림 줄은 `bg-warning/10`처럼 옅게 깐
 * 배경 위에 글자를 얹는다. 배경 농도만 바꿔도 대비가 AA 아래로 내려간다 — 라이트 '주의' 칩이
 * /15에서 4.45:1이었다(2026-11-05 HIG 검수). 그래서 렌더한 클래스를 읽어 합성한 색으로 잰다.
 *
 * WCAG 계산은 `lib/color-contrast.test.ts`와 같은 식이다. 그 파일은 헬퍼를 내보내지 않아(테스트 파일)
 * 여기 같은 식을 둔다 — 공용 모듈로 옮기면 이 사본은 import로 바꾼다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InlineNotice, type NoticeTone } from "./inline-notice";
import { ListRow } from "./list-row";
import { StatusChip, type ChipTone } from "./status-chip";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/** `:root {`·`.dark {` 블록 — 셀렉터를 줄 시작에 고정해야 `@custom-variant dark`를 잘못 잡지 않는다. */
function block(selector: string): string {
  const escaped = selector.replace(/[.:]/g, "\\$&");
  const open = new RegExp(`^${escaped}\\s*\\{`, "m").exec(css);
  if (!open) throw new Error(`globals.css에 ${selector} 블록이 없다`);
  const from = open.index + open[0].length;
  const end = css.indexOf("\n}", from);
  if (end < 0) throw new Error(`${selector} 블록이 닫히지 않았다`);
  return css.slice(from, end);
}

type Scope = ":root" | ".dark";

function token(scope: Scope, name: string): string | null {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block(scope));
  return m ? m[1]!.toLowerCase() : null;
}

function mustToken(scope: Scope, name: string): string {
  const hex = token(scope, name);
  if (!hex) throw new Error(`${scope}에서 --${name}(6자리 hex)을 찾지 못했다`);
  return hex;
}

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

/** 반투명 색을 아래 색 위에 합성한다(브라우저의 알파 합성은 sRGB에서 일어난다). */
function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  return top.map((c, i) => c * alpha + bottom[i]! * (1 - alpha)) as Rgb;
}

/** WCAG 2.x 상대 휘도. */
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

/** 렌더한 첫 요소(또는 `pick`으로 고른 요소)의 class 목록. */
function classesOf(html: string, pick: RegExp = /class="([^"]*)"/): string[] {
  const m = pick.exec(html);
  if (!m) throw new Error(`class를 찾지 못했다: ${html}`);
  return m[1]!.split(/\s+/);
}

/**
 * `bg-warning/10`·`dark:bg-warning/25`·`text-success-strong`에서 색 토큰과 농도를 읽는다.
 * 다크 전용 클래스가 없으면 라이트 클래스가 그대로 쓰인다. 글자 크기 토큰(`text-micro` 등)은
 * globals.css에 같은 이름의 색이 없어 저절로 걸러진다.
 */
function colorOf(
  classes: string[],
  kind: "bg" | "text",
  scope: Scope
): { name: string; alpha: number } {
  const parse = (prefix: string) =>
    classes
      .filter((c) => c.startsWith(`${prefix}${kind}-`))
      .map((c) => {
        const [name, pct] = c.slice(prefix.length + kind.length + 1).split("/");
        return { name: name!, alpha: pct ? Number(pct) / 100 : 1 };
      })
      .filter(({ name }) => token(":root", name) != null);
  const found =
    (scope === ".dark" ? parse("dark:")[0] : undefined) ?? parse("")[0];
  if (!found) throw new Error(`${kind} 색 클래스가 없다: ${classes.join(" ")}`);
  return found;
}

const AA_TEXT = 4.5;
/** 아이콘 같은 그래픽 요소(WCAG 1.4.11). */
const AA_GRAPHIC = 3;
const SCOPES: Scope[] = [":root", ".dark"];
/** 칩·알림 줄이 놓이는 바탕 — 모바일은 흰 바탕, 넓은 화면은 카드 안. */
const SURFACES = ["background", "card"] as const;

function chipLikeRatio(classes: string[], scope: Scope, surface: string) {
  const bg = colorOf(classes, "bg", scope);
  const text = colorOf(classes, "text", scope);
  const base = rgb(mustToken(scope, surface));
  const fill = over(rgb(mustToken(scope, bg.name)), bg.alpha, base);
  const ink = over(rgb(mustToken(scope, text.name)), text.alpha, fill);
  return contrast(ink, fill);
}

describe("상태 칩 글자 대비", () => {
  const tones: ChipTone[] = ["neutral", "ok", "attention", "error", "pending"];
  for (const scope of SCOPES) {
    for (const surface of SURFACES) {
      for (const tone of tones) {
        it(`${scope} ${surface} 위 '${tone}' 칩은 AA(${AA_TEXT}:1) 이상`, () => {
          const classes = classesOf(
            renderToStaticMarkup(<StatusChip tone={tone}>확인 필요</StatusChip>)
          );
          const ratio = chipLikeRatio(classes, scope, surface);
          expect(ratio, `${tone} ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
            AA_TEXT
          );
        });
      }
    }
  }
});

describe("알림 줄 글자 대비", () => {
  const tones: NoticeTone[] = ["error", "success", "info"];
  for (const scope of SCOPES) {
    for (const surface of SURFACES) {
      for (const tone of tones) {
        it(`${scope} ${surface} 위 '${tone}' 알림 줄은 AA(${AA_TEXT}:1) 이상`, () => {
          const classes = classesOf(
            renderToStaticMarkup(
              <InlineNotice tone={tone}>저장했어요</InlineNotice>
            )
          );
          const ratio = chipLikeRatio(classes, scope, surface);
          expect(ratio, `${tone} ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
            AA_TEXT
          );
        });
      }
    }
  }
});

describe("목록 줄의 › 표시", () => {
  for (const scope of SCOPES) {
    it(`${scope} 바탕 위에서 그래픽 대비(${AA_GRAPHIC}:1) 이상 — 눌리는 줄임을 알아볼 수 있다`, () => {
      const html = renderToStaticMarkup(
        <ListRow title="식비" href="/transactions" chevron />
      );
      const classes = classesOf(
        html,
        /<svg[^>]*class="([^"]*lucide-chevron-right[^"]*)"/
      );
      const ink = colorOf(classes, "text", scope);
      const base = rgb(mustToken(scope, "background"));
      const ratio = contrast(
        over(rgb(mustToken(scope, ink.name)), ink.alpha, base),
        base
      );
      expect(ratio, `${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_GRAPHIC);
    });
  }
});
