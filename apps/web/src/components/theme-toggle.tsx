"use client";

import { Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/** Appearance is an occasional setting, not a global header action. */
export function ThemeSettingRow() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <label className="flex min-h-14 items-center gap-4 px-5 py-3">
      <span className="text-muted-foreground flex shrink-0 items-center justify-center"><Monitor className="size-[22px]" strokeWidth={1.7} aria-hidden="true" /></span>
      <span className="text-body min-w-0 flex-1">화면 모드</span>
      <select aria-label="화면 모드" className="text-caption text-muted-foreground min-h-11 min-w-0 max-w-[48%] rounded-control bg-transparent px-2 text-right" value={mounted ? theme ?? "system" : "system"} disabled={!mounted} onChange={(event) => setTheme(event.target.value)}>
        <option value="system">기기 설정</option>
        <option value="light">밝게</option>
        <option value="dark">어둡게</option>
      </select>
    </label>
  );
}
