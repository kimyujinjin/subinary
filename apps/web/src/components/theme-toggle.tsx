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
    <label className="flex min-h-16 items-center gap-3 border-t px-4 py-3">
      <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl"><Monitor className="size-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1 text-[15px] font-medium">화면 모드</span>
      <select aria-label="화면 모드" className="border-input bg-card min-h-11 min-w-0 max-w-[48%] rounded-lg border px-2 text-sm" value={mounted ? theme ?? "system" : "system"} disabled={!mounted} onChange={(event) => setTheme(event.target.value)}>
        <option value="system">기기 설정</option>
        <option value="light">밝게</option>
        <option value="dark">어둡게</option>
      </select>
    </label>
  );
}
