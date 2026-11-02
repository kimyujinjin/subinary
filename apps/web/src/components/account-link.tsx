"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { isUnder } from "@/lib/nav-tabs";
import { cn } from "@/lib/utils";

export function AccountLink() {
  const pathname = usePathname();
  const active = isUnder(pathname, "/more");
  return (
    <Link href="/more" aria-label="설정" aria-current={active ? "page" : undefined}
      className={cn("text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-ring flex size-11 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:outline-offset-2", active && "bg-finance-highlight text-finance-highlight-foreground")}>
      <Settings className="size-5" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
    </Link>
  );
}
