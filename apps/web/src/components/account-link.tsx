"use client";
/** Header account entry remains a direct link to 전체 and account settings. */
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth-context";
import { activeTabFor } from "@/lib/nav-tabs";
import { cn } from "@/lib/utils";

/** 이름/이메일에서 아바타 이니셜 1글자. */
function initial(name?: string | null, email?: string | null): string {
  const src = (name ?? email ?? "?").trim();
  return src ? src[0]!.toUpperCase() : "?";
}

export function AccountLink() {
  const { user } = useAuth();
  const pathname = usePathname();
  // 전체 아래의 기존 계정·관리 화면에서도 같은 활성 표시를 유지한다.
  const active = activeTabFor(pathname) === "more";

  return (
    <Link
      href="/more"
      aria-label="내 계정과 관리"
      aria-current={active ? "page" : undefined}
      // size-11 = 44px 터치 타깃.
      className={cn(
        "hover:bg-muted flex size-11 items-center justify-center rounded-full transition-colors",
        active && "bg-muted",
      )}
    >
      <Avatar className={cn("size-8", active && "ring-primary ring-2")}>
        <AvatarFallback className="bg-primary/10 text-primary text-sm">
          {initial(user?.name, user?.email)}
        </AvatarFallback>
      </Avatar>
    </Link>
  );
}
