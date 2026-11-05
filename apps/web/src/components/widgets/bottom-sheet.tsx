"use client";

import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { SHEET_POSITION } from "@/components/ui/sheet-layout";
import { cn } from "@/lib/utils";

/**
 * 아래에서 올라오는 선택 시트. 본문 중간에 선택지를 펼쳐 내용을 밀어내는 대신 쓴다(§5 자산).
 * 제목은 한 줄, 설명은 받지 않는다. 화면 폭과 상관없이 하단 시트다(넓은 화면은 가운데 정렬·최대 폭 md).
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // 첫 입력칸·접힘 요소에 포커스 테두리가 튀지 않게 시트 자체로 포커스를 옮긴다(스크린리더는 제목부터 읽는다).
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
          className={cn(
            "bg-card text-card-foreground fixed z-50 flex flex-col gap-2 outline-none",
            "data-[state=open]:animate-in data-[state=closed]:animate-out duration-200",
            SHEET_POSITION,
            "px-5 pt-3 pb-[calc(1.25rem+var(--safe-bottom))] sm:w-full sm:max-w-md sm:px-6"
          )}
        >
          <span
            aria-hidden="true"
            className="bg-muted mx-auto mb-2 h-1 w-9 rounded-full"
          />
          <DialogPrimitive.Title className="text-heading py-1">
            {title}
          </DialogPrimitive.Title>
          <div className="flex flex-col">{children}</div>
          <DialogPrimitive.Close className="text-body text-muted-foreground mt-1 min-h-11 rounded-control font-medium">
            닫기
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** 시트 안의 선택지 한 줄: 아이콘 · 제목 · 한 줄 설명 · 화살표. */
export function SheetOption({
  icon,
  title,
  description,
  href,
  onSelect,
  disabled,
  trailing,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  const body = (
    <>
      {icon ? (
        <span className="text-primary flex size-10 shrink-0 items-center justify-center [&_svg]:size-6">
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body font-semibold">{title}</span>
        {description ? (
          <span className="text-caption text-muted-foreground truncate">
            {description}
          </span>
        ) : null}
      </span>
      {trailing ??
        (disabled ? null : (
          <ChevronRight
            className="text-muted-foreground/60 size-5 shrink-0"
            aria-hidden="true"
          />
        ))}
    </>
  );
  const cls = cn(
    "-mx-2 flex min-h-16 items-center gap-3 rounded-control px-2 text-left",
    disabled ? "opacity-50" : "hover:bg-muted active:bg-muted"
  );
  if (href && !disabled) {
    return (
      <DialogPrimitive.Close asChild>
        <Link href={href} className={cls}>
          {body}
        </Link>
      </DialogPrimitive.Close>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={onSelect}
      disabled={disabled}
    >
      {body}
    </button>
  );
}
