"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";
import { touchTarget } from "./button";

/**
 * 스위치. iOS 비율(51×31)을 따라 46×28, 손잡이 24 — 목록 줄(44) 안에 들어간다.
 * 꺼진 트랙은 --control-off(바탕 대비 3:1 이상, color-contrast.test.ts). 누르는 영역은 touchTarget으로 44px 이상.
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-control-off focus-visible:ring-ring/50 inline-flex h-7 w-11.5 shrink-0 items-center rounded-full p-0.5 transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        touchTarget,
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="bg-background pointer-events-none block size-6 rounded-full shadow-sm transition-transform data-[state=checked]:translate-x-4.5 data-[state=unchecked]:translate-x-0"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
