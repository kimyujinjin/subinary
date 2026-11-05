import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type NoticeTone = "error" | "success" | "info";

/**
 * 오류만 role="alert"(바로 읽어 줌)이고, 완료·안내는 role="status"(하던 말을 끊지 않음)다.
 * 색은 StatusChip과 같은 옅은 배경 + 진한 글자 조합이라 라이트·다크 모두 AA(4.5:1)를 넘는다.
 */
const TONES: Record<
  NoticeTone,
  { role: "alert" | "status"; icon: LucideIcon; box: string; iconClass: string }
> = {
  error: {
    role: "alert",
    icon: CircleAlert,
    box: "bg-destructive/10 text-destructive dark:bg-destructive/20",
    iconClass: "",
  },
  success: {
    role: "status",
    icon: CircleCheck,
    box: "bg-success/15 text-success-strong dark:bg-success/25",
    iconClass: "",
  },
  info: {
    role: "status",
    icon: Info,
    box: "bg-muted text-foreground",
    iconClass: "text-muted-foreground",
  },
};

interface InlineNoticeProps {
  /** 기본은 안내(info). */
  tone?: NoticeTone;
  /** 한 문장(docs/ux-renewal-2026-11.md §3.5). */
  children: ReactNode;
  /** 입력칸의 `aria-describedby`로 이을 때 쓴다. */
  id?: string;
  className?: string;
}

/**
 * 화면 안에 붙는 한 줄 알림 — 저장 실패, 완료, 참고 안내.
 *
 * 화면마다 `<p role="alert" className="text-destructive text-sm">`를 따로 쓰면서 글자 크기·여백·역할이
 * 제각각이었다. 예상 못 한 문제로 흐름을 멈춰야 할 때만 얼럿(AlertDialogContent의 alert 변형)을 쓰고,
 * 나머지는 이 줄로 그 자리에서 알린다.
 */
export function InlineNotice({
  tone = "info",
  children,
  id,
  className,
}: InlineNoticeProps) {
  const { role, icon: Icon, box, iconClass } = TONES[tone];
  return (
    <div
      id={id}
      role={role}
      className={cn(
        "text-body rounded-control flex min-w-0 items-start gap-2 px-3 py-2.5",
        box,
        className
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-px size-5 shrink-0", iconClass)}
      />
      <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}
