"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>
) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(
  props: React.ComponentProps<typeof DialogPrimitive.Portal>
) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(
  props: React.ComponentProps<typeof DialogPrimitive.Close>
) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  );
}

/** 하단 시트 — 아래에 붙고 위 모서리만 둥글다. 위쪽 안전 영역을 비우고 시트 안만 스크롤한다. */
const SHEET_BASE =
  "inset-x-0 bottom-0 max-h-[calc(100dvh-var(--safe-top)-1.5rem)] rounded-t-card data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom";

/** sm 이상 배치. 640px 미만은 두 배치 모두 하단 시트다. */
const WIDE_LAYOUT = {
  /** 가운데 대화상자. */
  auto: "sm:inset-x-auto sm:bottom-auto sm:top-[50%] sm:left-[50%] sm:max-h-[calc(100dvh-4rem)] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-card sm:p-6 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
  /** 아래에 붙은 채 가운데 정렬·최대 폭 lg. PC·태블릿·펼친 폴드폰에서도 시트로 보인다. */
  sheet:
    "sm:inset-x-auto sm:left-[50%] sm:max-h-[calc(100dvh-4rem)] sm:max-w-lg sm:translate-x-[-50%] sm:p-6",
} as const;

type DialogLayout = keyof typeof WIDE_LAYOUT;

/** DialogContent의 위치·모양 클래스. 배치 회귀 테스트가 직접 확인한다. */
function dialogContentLayoutClassName(layout: DialogLayout): string {
  return cn(SHEET_BASE, WIDE_LAYOUT[layout]);
}

/**
 * 모바일: 아래에서 올라오는 시트(화면 하단 안전 영역을 비우고 시트 안만 스크롤).
 * sm 이상: `layout="auto"`(기본)는 가운데 대화상자, `layout="sheet"`는 계속 하단 시트.
 * 열 때는 시트 자체에 포커스를 둬 첫 버튼에 포커스 테두리가 뜨지 않게 한다.
 */
function DialogContent({
  className,
  children,
  style,
  onOpenAutoFocus,
  layout = "auto",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  layout?: DialogLayout;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed z-50 grid w-full gap-4 overflow-y-auto overscroll-contain p-5 duration-200 outline-none",
          dialogContentLayoutClassName(layout),
          className
        )}
        // 하단 안전 영역(홈 인디케이터)만큼 비운다 — 호출부의 p-* 클래스가 덮어써도 유지되도록 inline으로.
        style={{
          paddingBottom: "max(1.25rem, calc(1rem + var(--safe-bottom)))",
          ...style,
        }}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
          <XIcon />
          <span className="sr-only">닫기</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-heading", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-body", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  dialogContentLayoutClassName,
  type DialogLayout,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
