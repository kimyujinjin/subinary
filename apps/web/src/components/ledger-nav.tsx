import Link from "next/link";

import { ledgerNavItems, type LedgerSection } from "@/lib/ledger-nav";
import { cn } from "@/lib/utils";

export function LedgerNav({ active, month }: { active: LedgerSection; month?: string }) {
  return (
    <nav aria-label="가계부 메뉴" className="grid min-w-0 grid-cols-3 gap-4 border-b border-foreground/20">
      {ledgerNavItems(month).map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={cn(
            "flex min-h-11 min-w-0 items-center justify-center border-b-2 px-2 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            active === item.key
              ? "border-primary text-primary font-semibold"
              : "text-muted-foreground hover:text-foreground border-transparent font-medium",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
