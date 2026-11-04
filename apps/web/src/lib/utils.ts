import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * 리뉴얼 타이포 6단계(globals.css `--text-*`)를 tailwind-merge에 알려 준다.
 * 기본 설정은 `text-caption` 같은 이름을 **글자 색**으로 오인해, `cn("text-muted-foreground",
 * "text-caption")`이 회색을 지우고 `text-lg`와 `text-heading`을 둘 다 남겼다(2026-11-05 발견).
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: { text: ["display", "title", "heading", "body", "caption", "micro"] },
  },
});

/** Tailwind 클래스 병합 유틸(shadcn 표준). 조건부 클래스 + 충돌 해소. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
