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
const MAX_ARBITRARY_TEXT_SIZE = 49; // 2026-11-05 동의 절차 제거 뒤 52 → 49
const MAX_ARBITRARY_RADIUS = 1;

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
});
