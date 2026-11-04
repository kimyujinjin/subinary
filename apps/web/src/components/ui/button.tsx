import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * 버튼 위계는 3단계다(docs/ux-renewal-2026-11.md §3.3).
 * - default(채움): 화면의 주 행동. 화면당 1개.
 * - weak(옅음): 보조 행동.
 * - ghost/link(텍스트): 더보기·닫기, 아이콘 버튼.
 * tint·secondary·outline은 예전 변형이라 weak와 같은 모양으로 흡수했다. 새 코드에서 쓰지 않는다.
 */
const weak =
  "bg-primary/10 text-primary hover:bg-primary/15 dark:bg-primary/15 dark:hover:bg-primary/20";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control text-body font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-[18px] shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        weak,
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20",
        tint: weak,
        secondary: weak,
        outline: weak,
        ghost: "text-foreground hover:bg-muted",
        link: "text-primary hover:underline underline-offset-4",
      },
      size: {
        default: "h-11 px-4 has-[>svg]:px-3.5",
        sm: "h-9 gap-1.5 px-3 text-caption has-[>svg]:px-2.5",
        lg: "h-13 px-6 has-[>svg]:px-5",
        // 아이콘 버튼은 배경 없이 아이콘 24 + 터치 44(§3.3). variant="ghost"와 함께 쓴다.
        icon: "size-11 [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
