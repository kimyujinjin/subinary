import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * 목록·카드가 들어올 자리의 로딩 표현.
 *
 * **로딩 표현 기준** — 화면마다 고르지 말고 이 둘 중 하나를 쓴다:
 *  · 골격이 예측 가능한 목록·카드 → 이 컴포넌트(행 모양 스켈레톤)
 *  · 단일 숫자·상태 한 줄 → 그 자리의 `role="status"` 텍스트
 *
 * 왜 모았나: 같은 "불러오는 중"을 세 가지로 그리고 있었다 — 행 모양 스켈레톤(8화면),
 * 글자 + 일반 블록 하나(`FinanceLoading`), 스피너 + 글자(6화면). 셋은 체감 속도가
 * 다르고, 특히 마지막은 들어올 내용의 크기를 예고하지 못해 목록이 뜨는 순간 화면이
 * 튄다. 여기 없는 변형이 필요하면 **이 컴포넌트에 넣고** 쓸 것.
 */
export function ListLoading({
  rows = 3,
  label = "불러오는 중이에요.",
  className,
}: Readonly<{
  /** 들어올 항목 수의 대략치. 실제보다 많이 그리면 뜬 뒤에 화면이 줄어 보인다. */
  rows?: number;
  /** 스크린 리더용. 화면에는 보이지 않는다 — 스켈레톤이 이미 상태를 말한다. */
  label?: string;
  className?: string;
}>) {
  return (
    <div role="status" aria-busy="true" className={cn("space-y-3", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full rounded-2xl" />
      ))}
    </div>
  );
}
