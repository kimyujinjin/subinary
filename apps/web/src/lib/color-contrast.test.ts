/**
 * 상태색 토큰의 대비를 `globals.css`에서 직접 읽어 고정한다.
 *
 * 왜 CSS를 파싱하나: 값을 테스트에 복사해 두면 CSS만 바뀌었을 때 테스트가 통과하며
 * 거짓 안전을 준다. 대비 결함은 눈에 잘 띄지 않아 그렇게 조용히 되돌아온다 —
 * 실제로 `--warning`은 라이트에서 2.20:1(AA 미달)로 오래 있었고, 아무도 못 봤다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * `:root { … }`(라이트)와 `.dark { … }`(다크) 블록을 각각 떼어낸다.
 *
 * 셀렉터를 **줄 시작에 고정**해야 한다. 단순 문자열 검색을 쓰면 13행의
 * `@custom-variant dark (&:is(.dark *));`가 먼저 잡히고, 그 뒤의 첫 `{`가
 * `:root`의 것이라 **다크 테스트가 라이트 값을 검사한다** — 통과하는데 아무것도
 * 검증하지 않는 상태가 된다(실제로 그렇게 만들었다가 회귀 주입 실험에서 드러났다).
 */
function block(selector: string): string {
  const escaped = selector.replace(/[.:]/g, "\\$&");
  const open = new RegExp(`^${escaped}\\s*\\{`, "m").exec(css);
  if (!open) throw new Error(`globals.css에 ${selector} 블록이 없다`);
  const from = open.index + open[0].length;
  const end = css.indexOf("\n}", from);
  if (end < 0) throw new Error(`${selector} 블록이 닫히지 않았다`);
  return css.slice(from, end);
}

function token(scope: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block(scope));
  if (!m) throw new Error(`${scope}에서 --${name}(6자리 hex)을 찾지 못했다`);
  return m[1]!.toLowerCase();
}

/** WCAG 2.x 상대 휘도. sRGB 감마를 역보정한 뒤 가중합한다. */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number
  ];
  return (hi + 0.05) / (lo + 0.05);
}

const AA_TEXT = 4.5;

describe("상태색 대비 (globals.css에서 직접 읽음)", () => {
  const modes = [
    { scope: ":root", bg: "background", label: "라이트" },
    { scope: ".dark", bg: "background", label: "다크" },
  ] as const;

  for (const { scope, bg, label } of modes) {
    for (const name of ["warning-strong", "success-strong"] as const) {
      it(`${label}: --${name}는 배경 위에서 AA(${AA_TEXT}:1) 이상`, () => {
        const ratio = contrast(token(scope, name), token(scope, bg));
        // 실패 시 실제 비율이 메시지에 남아야 얼마나 모자란지 바로 안다.
        expect(
          ratio,
          `--${name} 대비 ${ratio.toFixed(2)}:1 (필요 ${AA_TEXT}:1)`
        ).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }

  it("표면색과 텍스트색은 별개 토큰이다", () => {
    // 라이트에서 둘이 같아지면 누군가 -strong을 표면색으로 되돌린 것이다.
    // 그 순간 본문 대비가 조용히 AA 아래로 내려간다.
    expect(token(":root", "warning-strong")).not.toBe(
      token(":root", "warning")
    );
    expect(token(":root", "success-strong")).not.toBe(
      token(":root", "success")
    );
  });
});

// Navigation, quiet labels and financial actions must remain readable in both modes.
describe("핵심 화면 색 대비", () => {
  for (const scope of [":root", ".dark"]) {
    for (const [foreground, background] of [
      ["foreground", "background"],
      ["muted-foreground", "background"],
      ["muted-foreground", "card"],
      ["primary", "card"],
      ["primary-foreground", "primary"],
      ["accent-foreground", "accent"],
      ["destructive", "card"],
      ["destructive-foreground", "destructive"],
      ["finance-hero-foreground", "finance-hero"],
      ["finance-hero-muted", "finance-hero"],
      ["finance-highlight", "finance-hero"],
      ["finance-highlight-foreground", "finance-highlight"],
      // 흰 카드 위에서 실제로 쓰이는 조합들 — 배경(`background`)만 검사하면 카드 위
      // 대비가 비어 있고, 금융 화면의 본문은 거의 전부 카드 안에 있다.
      ["card-foreground", "card"],
      ["success-strong", "card"],
      ["warning-strong", "card"],
      ["secondary-foreground", "secondary"],
    ]) {
      it(`${scope} ${foreground}/${background}: AA 본문 대비`, () => {
        expect(
          contrast(token(scope, foreground!), token(scope, background!))
        ).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }
});

/** 반투명 hex면 `token()`이 앞 6자리만 읽어 거짓 통과한다 — 대비를 고정할 토큰은 불투명이어야 한다. */
function opaqueToken(scope: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]+)\\s*;`).exec(block(scope));
  if (!m || m[1]!.length !== 7) {
    throw new Error(`${scope}의 --${name}은 불투명 6자리 hex여야 한다 — 반투명이면 바탕마다 대비가 달라진다`);
  }
  return token(scope, name);
}

/** `fg`를 `alpha` 비율로 `bg` 위에 겹친 색(뒤 덮개 bg-black/40·50 계산용). */
function over(fg: string, bg: string, alpha: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) =>
      Math.round(ch(fg, i) * alpha + ch(bg, i) * (1 - alpha))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

/** 부품 소스에서 실제로 쓰는 색 토큰 이름을 읽는다 — 부품이 다른 토큰으로 돌아가면 이 검사가 그 토큰을 잰다. */
function usedToken(file: string, pattern: RegExp): string {
  const source = readFileSync(join(process.cwd(), "src/components/ui", file), "utf8");
  const m = pattern.exec(source);
  if (!m) throw new Error(`${file}에서 ${pattern}을 찾지 못했다`);
  return m[1]!;
}

// 비텍스트 대비(WCAG 1.4.11): 꺼진 스위치 트랙·빈 체크박스 테두리는 모양이 곧 정보라 바탕 대비 3:1이 필요하다.
// --input(#e5e8eb)을 쓰던 때 흰 바탕 대비 1.23:1(다크 1.44:1)이라 꺼진 스위치가 보이지 않았다.
const NON_TEXT = 3;

describe("꺼진 컨트롤 비텍스트 대비 (3:1, globals.css·부품 소스에서 직접 읽음)", () => {
  const controls = [
    {
      label: "스위치 꺼짐 트랙",
      name: usedToken("switch.tsx", /data-\[state=unchecked\]:bg-([a-z-]+)/),
    },
    {
      label: "체크박스 테두리",
      name: usedToken("checkbox.tsx", /\bpeer border-([a-z-]+)/),
    },
  ];
  // 스위치·체크박스가 놓이는 바탕: 페이지·카드·떠 있는 면(Dialog·시트).
  for (const scope of [":root", ".dark"]) {
    for (const { label, name } of controls) {
      for (const surface of ["background", "card", "elevated"]) {
        it(`${scope} ${label}(--${name}) / ${surface}`, () => {
          const ratio = contrast(opaqueToken(scope, name), token(scope, surface));
          expect(
            ratio,
            `${label} 대비 ${ratio.toFixed(2)}:1 (필요 ${NON_TEXT}:1)`
          ).toBeGreaterThanOrEqual(NON_TEXT);
        });
      }
    }
    it(`${scope} 스위치 손잡이(--background) / 꺼짐 트랙`, () => {
      const track = opaqueToken(scope, controls[0]!.name);
      expect(contrast(token(scope, "background"), track)).toBeGreaterThanOrEqual(
        NON_TEXT
      );
    });
  }
});

describe("떠 있는 면(--elevated: Dialog·AlertDialog·BottomSheet 바탕)", () => {
  it("라이트는 페이지 배경과 같은 색 그대로다", () => {
    expect(token(":root", "elevated")).toBe(token(":root", "background"));
  });

  it("다크는 뒤 덮개(bg-black/40·50)로 어두워진 페이지와 구분된다", () => {
    // 페이지 배경을 그대로 쓰던 때 1.09~1.11:1이라 창 가장자리가 보이지 않았다.
    for (const alpha of [0.4, 0.5]) {
      const dimmed = over("#000000", token(".dark", "background"), alpha);
      const ratio = contrast(token(".dark", "elevated"), dimmed);
      expect(ratio, `덮개 ${alpha}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(1.25);
    }
  });

  for (const scope of [":root", ".dark"]) {
    it(`${scope} 입력칸(--muted)이 떠 있는 면 위에서 묻히지 않는다`, () => {
      // 다크 --popover(#25344b)처럼 --muted와 같은 밝기로 올리면 창 안의 입력칸이 사라진다.
      expect(
        contrast(token(scope, "muted"), token(scope, "elevated"))
      ).toBeGreaterThanOrEqual(1.1);
    });
    for (const foreground of [
      "foreground",
      "card-foreground",
      "muted-foreground",
      "primary",
      "destructive",
    ]) {
      it(`${scope} ${foreground}/elevated: AA 본문 대비`, () => {
        expect(
          contrast(token(scope, foreground), token(scope, "elevated"))
        ).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }
});
