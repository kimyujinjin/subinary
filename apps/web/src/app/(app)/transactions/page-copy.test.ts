/**
 * 거래 목록·상세 시트의 문구와 모양 규칙(2026-11-05 HIG 검수 3·4단계).
 * page.tsx는 훅이 많아 node 환경에서 그리기 어렵다 — sheet-layout.test.ts처럼 소스를 직접 확인한다.
 */
import { readFileSync } from "node:fs";
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
