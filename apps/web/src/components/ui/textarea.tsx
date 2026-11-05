import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * 여러 줄 입력 — Input과 같은 모양(회색 채움, 포커스는 1px 테두리 색만, text-body, rounded-control).
 * 2026-11-05 HIG 검수: 메모·문자 붙여넣기 칸만 테두리·3px 링·옛 글자 크기(sm)를 써서 한 폼 안에서 칸 모양이 달랐다.
 *
 * 높이는 내용만큼 늘어난다(field-sizing). 지원하지 않는 브라우저는 `rows`를 따르고,
 * 어느 쪽이든 최소 세 줄 · 최대 240px에서 칸 안 스크롤로 넘어간다.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        // Input과 달리 disabled에 pointer-events-none을 두지 않는다 — 긴 글은 꺼져 있어도 스크롤로 읽어야 한다.
        "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-muted text-body field-sizing-content block min-h-24 max-h-60 w-full min-w-0 resize-none rounded-control border border-transparent px-4 py-3 transition-colors outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "focus-visible:border-primary",
        "aria-invalid:ring-destructive/20 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
