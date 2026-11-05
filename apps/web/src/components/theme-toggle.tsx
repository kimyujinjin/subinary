"use client";
/**
 * 화면 모드 — 전체 탭 '알림 · 화면' 묶음의 한 줄. 헤더 버튼이 아니라 가끔 바꾸는 설정이다.
 *
 * 줄 전체가 값 고르기 메뉴(PickerMenu)를 연다: 이름 · 회색 값 · ⌃⌄. 예전에는 OS 기본 select라
 * 폰마다 모양이 달랐고 다른 설정 줄과 어긋났다(2026-11 HIG 검수).
 */
import { ChevronsUpDown, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { PickerMenu } from "@/components/ui/picker-menu";

export const THEME_OPTIONS = [
  { value: "system", label: "기기 설정" },
  { value: "light", label: "밝게" },
  { value: "dark", label: "어둡게" },
] as const;

export function themeLabel(theme: string | undefined): string {
  return (
    THEME_OPTIONS.find((option) => option.value === theme)?.label ??
    THEME_OPTIONS[0].label
  );
}

export function ThemeSettingRow() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // 저장된 값은 브라우저에서만 안다 — 마운트 전에는 '기기 설정'으로 그려 첫 화면이 서버 렌더와 같게 둔다.
  const current = mounted ? (theme ?? "system") : "system";
  return (
    <PickerMenu
      label="화면 모드"
      options={THEME_OPTIONS}
      value={current}
      onSelect={setTheme}
      align="end"
      trigger={
        <button
          type="button"
          disabled={!mounted}
          className="hover:bg-muted/60 active:bg-muted data-[state=open]:bg-muted focus-visible:ring-ring flex min-h-14 w-full items-center gap-4 px-5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <Monitor
            className="text-muted-foreground size-6 shrink-0"
            strokeWidth={1.7}
            aria-hidden="true"
          />
          <span className="text-body min-w-0 flex-1">화면 모드</span>
          <span className="text-body text-muted-foreground shrink-0">
            {themeLabel(current)}
          </span>
          <ChevronsUpDown
            className="text-muted-foreground/70 size-4 shrink-0"
            aria-hidden="true"
          />
        </button>
      }
    />
  );
}
