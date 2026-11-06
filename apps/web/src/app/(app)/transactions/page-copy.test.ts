/**
 * 거래 목록·상세 시트의 문구와 모양 규칙(2026-11-05 HIG 검수 3·4단계).
 * page.tsx는 훅이 많아 node 환경에서 그리기 어렵다 — sheet-layout.test.ts처럼 소스를 직접 확인한다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const page = readFileSync(
  join(process.cwd(), "src/app/(app)/transactions/page.tsx"),
  "utf8"
);
/** 주석을 뺀 코드 — 예전 문구를 설명하는 주석은 검사하지 않는다. */
const code = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("거래 상세 시트", () => {
  it("닫는 길은 손잡이와 X뿐이다 — 맨 아래 전체 폭 '닫기' 버튼이 없다", () => {
    const start = code.indexOf("function TransactionDetailDialog(");
    const end = code.indexOf("function useTransactionModalBack(");
    const detail = code.slice(start, end);
    expect(detail).toContain('layout="sheet"');
    expect(detail).not.toMatch(/<DialogFooter\b/);
    // 예전 맨 아래 버튼은 requestClose를 불렀다. 지금은 손잡이·X(Dialog onOpenChange)만 시트를 닫는다.
    expect(detail).not.toContain("onClick={requestClose}");
  });

  it("값을 고를 때 목록을 미는 '처리하고 있어요' 문장이 없다", () => {
    expect(code).not.toContain("변경 내용을 처리하고 있어요");
  });

  it("버튼에 '취소'를 쓰지 않는다 — 결제 취소와 헷갈린다", () => {
    expect(code).not.toMatch(/>\s*취소\s*</);
    expect(code).not.toContain("버리고 닫기");
  });

  it("버리기 확인에서 남는 쪽은 '닫기'가 아니라 '계속 수정하기'다 — 닫을지 묻는 창의 '닫기'는 뜻이 거꾸로 읽힌다", () => {
    expect(code).toContain("<AlertDialogCancel>계속 수정하기</AlertDialogCancel>");
  });

  it("없는 메뉴('⋯ 메뉴의 합계에서 빼기')를 가리키지 않는다", () => {
    expect(code).not.toContain("⋯ 메뉴");
  });

  it("내부 용어·옛 이름을 화면에 쓰지 않는다", () => {
    for (const old of [
      "날짜/시각",
      "이 기기의 시간",
      "합계에서 제외됨",
      "제외됨",
      "취소 거래",
      "해외 결제</StatusChip>",
      "순지출",
      "다시 합계에 포함하기",
      // 취소로 생긴 기록은 '환불'이다(이름 규칙).
      "취소가 연결된 거래",
    ]) {
      expect(code).not.toContain(old);
    }
  });

  it("날짜는 lib/format 표기를 쓴다('2026. 11. 05. 14:31' 금지)", () => {
    expect(code).not.toMatch(/\bformatDate\(/);
  });

  it("저장 상태를 마지막 호출에 묶지 않는다 — 한 줄 저장 중에 다른 줄을 골라도 앞 줄의 값·실패가 남는다", () => {
    // useMutation의 variables·status는 마지막 호출만 기억한다. 상세·메모·연결 창은 거래·자리별 상태(detail-save.ts)를 읽는다.
    expect(code).not.toMatch(
      /mutation\.variables\??\.id === (detailTxn|memoTarget|linkTarget)\.id/
    );
    expect(code).toContain("saves={detailSavesFor(detailSaves, detailTxn.id)}");
  });

  it("저장 중인 줄은 다시 고를 수 없다 — 원래 값으로 되돌려도 먼저 보낸 저장이 남지 않게", () => {
    const locks = [
      ["categoryLocked", 'deleting || isSaving("category")', "selectCategory"],
      ["cardLocked", 'deleting || isSaving("card") || resolvingCard', "onChangeCard"],
      ["visibilityLocked", 'deleting || isSaving("visibility")', "onChangeVisibility"],
      ["pickCardLocked", 'busy || isSaving("card")', "onResolveCard"],
    ] as const;
    for (const [lock, condition, handler] of locks) {
      expect(code).toContain(`const ${lock} = ${condition};`);
      expect(code).toContain(`disabled={${lock}}`);
      // 흐린 줄도 폰(Chromium)에서는 Radix 메뉴가 열린다 — 잠긴 동안 고른 값은 저장하지 않는다.
      expect(code).toMatch(
        new RegExp(`if \\(!${lock}\\) ${handler}\\((value|cardId)\\);`)
      );
      // 잠금 없이 고른 값을 그대로 저장하는 연결이 남지 않는다.
      expect(code).not.toMatch(new RegExp(`onSelect(:|=\\{) ?${handler}\\b`));
    }
    // 메모 줄은 창을 여는 버튼이라 disabled가 클릭을 막는다.
    expect(code).toMatch(/disabled=\{deleting \|\| isSaving\("memo"\)/);
  });

  it("금액 수정은 AmountInput, 메모는 Textarea다", () => {
    expect(code).toContain("<AmountInput");
    expect(code).toContain("<Textarea");
    expect(code).not.toContain("<textarea");
  });
});

describe("원래 결제를 못 찾은 환불(2026-11-06 결정 5)", () => {
  const start = code.indexOf("function TransactionDetailDialog(");
  const end = code.indexOf("function useTransactionModalBack(");
  const detail = code.slice(start, end);

  it("결정 블록의 '합계에서 빼기'는 서버 빼기(exclude)로 이어진다", () => {
    expect(detail).toMatch(/exclude: onExclude,/);
    expect(detail).toMatch(/linkCancellation: onOpenLink,/);
    expect(code).toMatch(
      /onExclude=\{\(\) =>\s*mutation\.mutate\(\{ kind: "exclude", id: detailTxn\.id \}\)/
    );
  });

  it("⋯ 메뉴는 그대로다 — 환불에는 빼기를 두지 않고 삭제는 남는다", () => {
    expect(detail).toMatch(
      /const menuOffersExclude =\s*!isCancellation && !excluded && !decisionOffersExclude\(decision\);/
    );
    expect(detail).toContain('label: "거래 삭제"');
    // 삭제 확인의 '합계에서 빼기' 대안은 결정 블록이 빼기를 물을 때도 켜진다.
    expect(detail).toContain(
      "const canExclude = menuOffersExclude || decisionOffersExclude(decision);"
    );
  });

  it("뺀 환불은 되돌릴 수 있고, 뺀 채로는 원래 결제에 연결하지 않는다", () => {
    // 예전에는 '합계에 다시 넣기'가 승인에만 있어 환불을 빼면 되돌릴 길이 없었다.
    expect(detail).toContain("{(!isCancellation || canLink) && excluded ? (");
    expect(detail).not.toContain("{!isCancellation && excluded ? (");
    // 뺀 환불을 연결하면 원래 결제 금액에 반영되는데 기록은 '합계 제외'로 남아 화면이 어긋난다.
    expect(detail).toContain("{canLink && decision == null && !excluded ? (");
  });
});

describe("거래 목록", () => {
  it("검색칸은 기본 Input 모양이다 — 회색 채움을 bg-card로 덮지 않는다", () => {
    expect(code).not.toContain("border-transparent bg-card");
  });

  it("소계 설명을 마우스를 올려야 보이는 title에만 두지 않는다", () => {
    expect(code).not.toContain('title="원화 승인 소계');
  });

  it("취소 연결은 고르기 창(Select) 대신 한 줄씩 누르는 목록이다", () => {
    expect(code).not.toContain("<Select");
    expect(code).toContain('role="radiogroup"');
  });
});

describe("거래 상세 시트 — 끊기지 않게 열고, 스크롤 터치에 메뉴가 열리지 않게(2026-11-06)", () => {
  const start = code.indexOf("function TransactionDetailDialog(");
  const end = code.indexOf("function useTransactionModalBack(");
  const detail = code.slice(start, end);
  const src = (file: string) =>
    readFileSync(join(process.cwd(), "src", file), "utf8");

  it("시트 안의 값 고르기는 공용 드롭다운 그대로 연다 — 거래 상세만 따로 켜는 여는 순간 옵션이 없다", () => {
    expect(detail.match(/menu=\{\{/g) ?? []).toHaveLength(3);
    // 결정 블록의 카드 고르기도 Radix 트리거까지 잠근다(버튼 disabled만으로는 폰에서 열렸다).
    expect(detail).toMatch(/<PickerMenu\b[\s\S]{0,300}?disabled=\{pickCardLocked\}/);
    // 예전에는 상세의 메뉴마다 openOn="release"를 넘겼다. 이제 터치는 어디서나 손을 뗄 때 연다.
    expect(page).not.toMatch(/\bopenOn\b/);
    expect(src("components/review-request-action.tsx")).not.toMatch(/\bopenOn\b/);
  });

  it("앱 전체 드롭다운은 터치에서 뗄 때 연다 — 화면마다 켜는 옵션이 없고, 모든 메뉴가 공용 부품을 거친다", () => {
    const root = join(process.cwd(), "src");
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return files(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
      });
    const sources = files(root).map((file) => ({
      file: file.slice(root.length + 1),
      text: readFileSync(file, "utf8"),
    }));
    // 화면마다 켜는 옵션을 두면 다시 '이 화면만 그래'가 된다(2026-11-06 "거래 상세만이 아니고 전체적으로 다 그래").
    expect(
      sources.filter(({ text }) => /\bopenOn\b/.test(text)).map(({ file }) => file)
    ).toEqual([]);
    // '뗄 때 열기'는 components/ui/dropdown-menu.tsx의 DropdownMenu·DropdownMenuTrigger에 있다. Radix 드롭다운을
    // 화면에서 직접 가져오는 곳은 메뉴 안 항목만 쓴다 — Root·Trigger를 직접 쓰면 그 처리를 건너뛴다.
    const contentParts = new Set([
      "RadioGroup",
      "RadioItem",
      "ItemIndicator",
      "Item",
      "CheckboxItem",
      "Group",
      "Label",
      "Separator",
    ]);
    for (const { file, text } of sources) {
      if (file.startsWith("components/ui/")) continue;
      expect(text, file).not.toMatch(
        /import\s*(type\s*)?\{[^}]*\}\s*from\s*"@radix-ui\/react-dropdown-menu"/
      );
      const ns = text.match(
        /import \* as (\w+) from "@radix-ui\/react-dropdown-menu"/
      )?.[1];
      if (!ns) continue;
      const parts = [...text.matchAll(new RegExp(`\\b${ns}\\.(\\w+)`, "g"))].map(
        (match) => match[1]
      );
      expect(
        parts.filter((part) => !contentParts.has(part)),
        file
      ).toEqual([]);
    }
  });

  it("목록 줄·최근 결제 줄·'그 결제 보기'는 누르려는 손가락에만 미리 받고, 열 때는 잠깐 기다린다", () => {
    const history = src("app/(app)/transactions/merchant-history.tsx");
    // 셋 다 같은 누름 판별(press-prefetch.ts)을 거친다 — 스크롤하려고 댄 손가락에는 요청을 보내지 않는다.
    expect(code).toMatch(
      /pressPrefetchHandlers\(press, \(\) => onPrefetch\(txn\)\)/
    );
    expect(code).toMatch(/press=\{rowPress\}/);
    expect(detail).toMatch(
      /pressPrefetchHandlers\(pairPress, \(\) =>\s+onPrefetchTransaction\(duplicatePair\)/
    );
    expect(history).toMatch(
      /pressPrefetchHandlers\(press, \(\) => onPrefetch\(item\)\)/
    );
    // pointerdown에서 바로 미리 받지 않는다(예전: 플릭마다 가맹점 검색·확인 요청·짝 결제가 나갔다).
    for (const source of [code, history]) {
      expect(source).not.toMatch(/onPointerDown=\{[^}]*onPrefetch/);
    }
    // 목록과 시트 안 열기는 모두 같은 대기(openGate)를 지난다. 딥링크는 setDetailId로 바로 연다.
    expect(code).toContain("openWhenReady(txn, viaKeyboard, () => openDetail(txn.id))");
    expect(code).toContain("openWhenReady(target, viaKeyboard, () => {");
    expect(code).toMatch(/onOpenTransaction=\{\(target, viaKeyboard\) =>\s+openFromDetail\(/);
  });

  it("목록 밖 거래의 단건 조회가 실패하면 시트와 얼럿 중 하나만 보인다(resolveDetailFallback)", () => {
    expect(code).toMatch(/\?\? detailFallback\.txn\b/);
    expect(code).toContain("detailFallbackCopy(detailFallback.failure)");
    // 미리 넣은 요약이 실패 뒤에도 남아, 캐시 값을 그대로 쓰면 시트 위에 얼럿이 겹쳤다.
    expect(code).not.toContain("detailFallbackQuery.data ??");
    expect(code).not.toMatch(/!inList && detailFallbackQuery\.isError/);
  });

  it("짝 결제를 찾는 동안 안내 줄과 '그 결제 보기' 자리를 잡아 둔다", () => {
    expect(detail).toContain(") : duplicatePairLoading ? (");
    expect(detail).toContain('className="flex h-11 items-center"');
  });

  it("시트 높이 규칙은 그대로다 — 내용만큼, 최대 85%(고정 높이로 바꾸지 않는다)", () => {
    expect(detail).toContain('layout="sheet"');
    expect(detail).not.toMatch(/<DialogContent[^>]*\bh-\[/);
  });
});
