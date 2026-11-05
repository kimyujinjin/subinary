"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * 비밀번호 칸 + 오른쪽 보기/숨기기 아이콘 버튼(배경 없음, 터치 44).
 *
 * 로그인·가입·비밀번호 변경이 같은 칸을 쓴다 — 휴대폰에서 긴 비밀번호를 가린 채 맞추기 어렵고,
 * 가입 화면에는 확인 칸이 없어 오타가 그대로 저장된다(2026-11-05 HIG 검수). 값은 바꾸지 않고 `type`만 바꾼다.
 * 보이는 동안 자동 고침·대문자 바꿈이 값을 건드리지 않게 끈다(호출부가 덮어쓸 수 있다).
 * 은행 비밀번호 칸에는 쓰지 않는다 — 글자로 보이는 동안 키보드가 단어로 배울 수 있다.
 */
export function PasswordInput(
  props: Readonly<Omit<ComponentProps<typeof Input>, "type">>
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...props}
        type={visible ? "text" : "password"}
        className={cn("pr-12", props.className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"}
        aria-pressed={visible}
        aria-controls={props.id}
        onClick={() => setVisible((value) => !value)}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0.5 my-auto hover:bg-transparent [&_svg:not([class*='size-'])]:size-5 active:text-foreground"
      >
        {visible ? <EyeOff /> : <Eye />}
      </Button>
    </div>
  );
}
