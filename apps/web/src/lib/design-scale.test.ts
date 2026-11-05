/**
 * 리뉴얼 디자인 시스템의 래칫(docs/ux-renewal-2026-11.md §3.1·§3.2).
 *
 * 임의 글자 크기(`text-[13px]`)와 임의 모서리(`rounded-[…]`)는 화면마다 조금씩 다른 크기를
 * 만들어 "통일감 없음"의 직접 원인이 됐다. 한 번에 다 지울 수 없으므로 현재 개수를 상한으로
 * 고정하고, 화면을 고칠 때마다 상한을 **내린다**. 늘어나면 실패한다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function count(pattern: RegExp): number {
  return sourceFiles(SRC).reduce(
    (sum, file) =>
      sum + (readFileSync(file, "utf8").match(pattern)?.length ?? 0),
    0
  );
}

// 상한은 내리기만 한다. 화면 개편 PR에서 실제 개수에 맞춰 갱신한다.
// 2026-11-06 HIG 3·4단계로 모든 화면을 토큰으로 옮겨 0이 됐다(48 → 45 → 0). 이제 새로 쓰면 바로 실패한다.
const MAX_ARBITRARY_TEXT_SIZE = 0;
// 체크박스 rounded-[4px] 하나(components/ui/checkbox.tsx)만 남았다 — 예외로 둘지는 사용자 결정 대기.
const MAX_ARBITRARY_RADIUS = 1;
// 이름 붙은 옛 크기(text-sm·rounded-xl 등)도 토큰 밖 값이다. 2026-11-05 처음 잴 때 239·54 → 2026-11-06 0.
const MAX_NAMED_TEXT_SIZE = 0;
const MAX_NAMED_RADIUS = 0;

describe("디자인 스케일 래칫", () => {
  it("임의 글자 크기(text-[Npx])가 늘지 않는다 — text-display/title/heading/body/caption/micro를 쓴다", () => {
    expect(count(/text-\[[0-9.]+(px|rem)\]/g)).toBeLessThanOrEqual(
      MAX_ARBITRARY_TEXT_SIZE
    );
  });

  it("임의 모서리(rounded-[…])가 늘지 않는다 — rounded-card/control/full을 쓴다", () => {
    expect(count(/rounded-(?:t-|b-)?\[[^\]]+\]/g)).toBeLessThanOrEqual(
      MAX_ARBITRARY_RADIUS
    );
  });

  // 임의 값만 세면 text-sm·rounded-xl 같은 옛 값이 새 코드에 다시 들어와도 걸리지 않았다(2026-11-05 HIG 검수).
  it("이름 붙은 옛 글자 크기(text-xs·sm·lg·xl…)가 늘지 않는다", () => {
    expect(
      count(/(?<![\w-])text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl)(?![\w-])/g)
    ).toBeLessThanOrEqual(MAX_NAMED_TEXT_SIZE);
  });

  // Tailwind v4의 hover:는 마우스가 있는 기기에서만 켜지고, 웹뷰 기본 탭 하이라이트는 globals.css에서 껐다.
  // 그래서 hover 색만 있는 누름 요소는 폰에서 눌러도 아무 반응이 없다(2026-11-05 최종 검토).
  it("hover 색이 있는 클래스에는 눌림(active:) 표시도 있다 — 폰에는 hover가 없다", () => {
    const offenders = sourceFiles(SRC).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return [...text.matchAll(/(["`])((?:(?!\1)[^\\\n]|\\.)*?)\1/g)].flatMap((m) => {
        const tokens = m[2].split(/\s+/);
        const hover = tokens.some((t) => /^hover:(bg|text)-/.test(t) && t !== "hover:bg-transparent");
        const active = tokens.some((t) => /(^|:)active:/.test(t));
        return hover && !active ? [`${file.slice(SRC.length + 1)}: ${m[2].slice(0, 60)}`] : [];
      });
    });
    expect(offenders).toEqual([]);
  });

  it("이름 붙은 옛 모서리(rounded-sm·md·lg·xl…)가 늘지 않는다", () => {
    expect(
      count(
        /(?<![\w-])rounded-(?:t-|b-|l-|r-|tl-|tr-|bl-|br-)?(?:xs|sm|md|lg|xl|2xl|3xl)(?![\w-])/g
      )
    ).toBeLessThanOrEqual(MAX_NAMED_RADIUS);
  });
});
