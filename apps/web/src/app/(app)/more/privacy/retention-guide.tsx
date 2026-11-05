/* ---------------------------------------------------------------------------
 * 개인정보 › '자세히' 시트의 보관 안내.
 *
 * 수집을 멈추는 방법은 실제 버튼 이름과 위치로 쓴다. 예전 문구 '기기를 폐기하면 돼요'는 문자 연동
 * 화면 어디에도 없는 말이었다(실제는 기기 ⋯ 메뉴의 '연결 해제', devices/page.tsx). 연락할 창구가
 * 없으므로 '알려 주세요'처럼 갈 곳 없는 부탁은 하지 않는다.
 * ------------------------------------------------------------------------- */
import { ChevronRight } from "lucide-react";
import Link from "next/link";

export function RetentionGuide({
  onNavigate,
}: Readonly<{
  /** 문자 연동으로 넘어가기 전에 시트를 닫는다. */
  onNavigate?: () => void;
}>) {
  return (
    <div className="text-body text-muted-foreground flex max-h-[60dvh] flex-col gap-3 overflow-y-auto pb-2">
      <p>
        새 문자를 그만 받으려면{" "}
        <strong className="text-foreground font-medium">
          문자 연동 › 기기 ⋯ › 연결 해제
        </strong>
        를 눌러 주세요.
      </p>
      <p>
        다만{" "}
        <strong className="text-foreground font-medium">
          이미 보관된 문자는 그대로 남아요.
        </strong>{" "}
        자동 삭제와 보관 기간 설정은 만들지 않기로 했어요.
      </p>
      <p>
        받은 문자는 금액이 틀렸을 때 다시 읽어 바로잡는 유일한 근거라서, 지우면
        과거 지출이 맞는지 확인할 방법이 함께 사라지거든요.
      </p>
      <Link
        href="/devices"
        onClick={onNavigate}
        className="text-primary -mx-1 inline-flex min-h-11 items-center gap-0.5 self-start px-1 font-semibold active:opacity-60"
      >
        문자 연동 열기
        <ChevronRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
