"use client";

import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface OverflowAction {
  label: string;
  onSelect: () => void;
  /** 연결 해제·삭제처럼 되돌리기 어려운 행동. 위험 행동은 이 메뉴 안에만 둔다(§3.3). */
  destructive?: boolean;
  disabled?: boolean;
}

/** 자주 쓰지 않는 행동을 화면에서 걷어내 ⋯ 하나로 모은다. */
export function OverflowMenu({
  actions,
  label = "더보기",
  className,
}: {
  actions: OverflowAction[];
  label?: string;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn("text-muted-foreground", className)}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {actions.map((action) => (
          <DropdownMenuItem
            key={action.label}
            disabled={action.disabled}
            onSelect={action.onSelect}
            className={cn(
              "text-body min-h-11",
              action.destructive && "text-destructive focus:text-destructive"
            )}
          >
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
