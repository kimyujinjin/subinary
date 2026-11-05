"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { SheetHandle } from "./sheet-handle";
import { DIALOG_RESPONSIVE, DIALOG_SHEET } from "./sheet-layout";

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

/**
 * 기본(`layout="auto"`)은 입력 폼 모양이다 — 폰은 아래에서 올라오고 넓은 화면은 가운데(`DIALOG_RESPONSIVE`).
 * `layout="sheet"`는 상세 보기용 바텀 시트다 — 모든 폭에서 아래에 붙고 최대 85%, 손잡이를 끌어내리면 닫힌다.
 * 어느 쪽이든 화면 하단 안전 영역을 비우고 창 안만 스크롤한다. 용도별 기준은 `sheet-layout.ts` 표.
 * 열 때는 창 자체에 포커스를 둬 첫 버튼에 포커스 테두리가 뜨지 않게 한다.
 */
function DialogContent({
  className,
  children,
  style,
  onOpenAutoFocus,
  ref,
  layout = "auto",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  layout?: "auto" | "sheet";
}) {
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={(node) => {
          sheetRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        data-slot="dialog-content"
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement).focus();
        }}
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed z-50 grid w-full gap-4 overflow-y-auto overscroll-contain p-5 duration-200 outline-none",
          layout === "sheet" ? DIALOG_SHEET : DIALOG_RESPONSIVE,
          className
        )}
        // 하단 안전 영역(홈 인디케이터)만큼 비운다 — 호출부의 p-* 클래스가 덮어써도 유지되도록 inline으로.
        style={{
          paddingBottom: "max(1.25rem, calc(1rem + var(--safe-bottom)))",
          ...style,
        }}
        {...props}
      >
        {layout === "sheet" ? (
          <SheetHandle
            sheetRef={sheetRef}
            closeRef={closeRef}
            className="absolute top-0 left-1/2 z-10 -translate-x-1/2"
          />
        ) : null}
        {children}
        <DialogPrimitive.Close
          ref={closeRef}
          className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
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
