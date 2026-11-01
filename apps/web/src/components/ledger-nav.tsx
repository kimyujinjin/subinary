import Link from "next/link";

import { ledgerNavItems, type LedgerSection } from "@/lib/ledger-nav";
import { cn } from "@/lib/utils";

export function LedgerNav({ active, month }: { active: LedgerSection; month?: string }) {
  return (
    <nav aria-label="가계부 메뉴" className="grid min-w-0 grid-cols-3 gap-1 border-b">
      {ledgerNavItems(month).map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={cn(
            "flex min-h-11 min-w-0 items-center justify-center border-b-2 px-2 py-3 text-sm font-medium transition-colors",
            active === item.key
              ? "border-primary text-primary"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
