"use client";
/* ---------------------------------------------------------------------------
 * Family Memory AI — web · 알림함 (/notifications, 토스 스타일 알림 센터)
 *
 * 최근 30일 알림을 최신순으로 모아 본다. 진입하면 전체가 자동 읽음 처리되고(헤더 벨
 * 뱃지 0), 화면은 진입 당시 스냅샷 기준으로 "새 알림"(그때 안읽음, 굵게)/"지난 알림"
 * (읽음, 보통 굵기)을 나눠 보여준다. 항목 탭 → 해당 화면으로 딥링크 이동. 커서 페이지.
 *
 * 전체 읽음은 **벨 숫자**를 보고도 건다: 안읽음이 아직 안 불러온 페이지에만 있으면 첫
 * 페이지만 보고는 알 수 없어서, 예전에는 벨 숫자가 알림함을 열어도 남았다. 서버의 전체
 * 읽음은 불러오지 않은 것까지 지우고, 벨 숫자는 목록과 같은 30일 창만 센다.
 * ------------------------------------------------------------------------- */
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  ChartColumn,
  CircleAlert,
  CircleCheck,
  CreditCard,
  type LucideIcon,
  MessageCircleQuestionMark,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  EmptyState,
  ListLoading,
  ListRow,
  PageBackHeader,
  SectionHeader,
} from "@/components/widgets";
import { formatRelativeTime } from "@/lib/format";
import {
  useMarkAllNotificationsRead,
  useNotifications,
  useUnreadCount,
} from "@/lib/queries";
import type { NotificationItem, NotificationKind } from "@family/contracts";

interface KindMeta {
  icon: LucideIcon;
  className: string;
}

/** 알림 유형별 아이콘 + 원형 배경색. */
const KIND_META: Record<NotificationKind, KindMeta> = {
  transaction: { icon: CreditCard, className: "bg-primary/15 text-primary" },
  budget: { icon: CircleAlert, className: "bg-warning/15 text-warning-strong" },
  reminder: { icon: CircleCheck, className: "bg-accent text-accent-foreground" },
  summary: { icon: ChartColumn, className: "bg-primary/15 text-primary" },
  decline: { icon: AlertTriangle, className: "bg-destructive/10 text-destructive" },
  // 예고는 경고가 아니다 — 아직 아무 일도 일어나지 않았으므로 중립 톤을 쓴다.
  upcoming: { icon: CalendarClock, className: "bg-accent text-accent-foreground" },
  // 가족이 물어본 결제 — 사람이 보낸 알림이라 시스템 알림과 다른 아이콘을 쓴다.
  review: { icon: MessageCircleQuestionMark, className: "bg-accent text-accent-foreground" },
};

/** 계약에 없는 kind용 중립 메타. */
const UNKNOWN_KIND_META: KindMeta = {
  icon: Bell,
  className: "bg-muted text-muted-foreground",
};

/**
 * kind → 메타. 표를 그대로 인덱싱하지 않는 이유: 서버(worker)가 계약보다 **앞서** 새
 * kind를 보낼 수 있다(워커·API 배포가 웹보다 먼저 나가는 게 정상 순서다). 그때
 * `undefined.icon`이 되면 알림 한 건이 알림함 전체를 렌더 예외로 끌어내린다 —
 * `decline`이 실제로 그렇게 터졌다.
 */
function kindMeta(kind: string): KindMeta {
  return (KIND_META as Record<string, KindMeta>)[kind] ?? UNKNOWN_KIND_META;
}

function NotificationRow({
  item,
  unread,
}: Readonly<{ item: NotificationItem; unread: boolean }>) {
  const meta = kindMeta(item.kind);
  const Icon = meta.icon;
  return (
    <ListRow
      icon={<Icon />}
      iconClassName={meta.className}
      title={item.title}
      // 안읽음은 굵게, 읽은 것은 보통 굵기 — 진입 당시 기준이다.
      titleClassName={unread ? undefined : "font-normal"}
      subtitle={item.body}
      valueSub={formatRelativeTime(item.createdAt)}
      // 갈 곳이 없는 알림은 눌리는 행처럼 보이지 않게 한다.
      href={item.deepLink ?? undefined}
    />
  );
}

export default function NotificationsPage() {
  const query = useNotifications();
  const unreadCount = useUnreadCount();
  const markAll = useMarkAllNotificationsRead();

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadItems = items.filter((i) => !i.readAt);
  const readItems = items.filter((i) => i.readAt);

  // 진입 시 1회 전체 읽음. markAll은 목록 캐시를 건드리지 않아 위 unreadItems 스냅샷은
  // 화면에 그대로 유지되고, 헤더 벨 뱃지만 0이 된다. 불러온 목록에 안읽음이 없어도 벨
  // 숫자가 남아 있으면 건다(안읽음이 다음 페이지에만 있는 경우).
  const markedRef = useRef(false);
  const loaded = !query.isLoading && !query.isError;
  const hasUnread = unreadItems.length > 0 || (unreadCount.data?.count ?? 0) > 0;
  useEffect(() => {
    if (loaded && hasUnread && !markedRef.current) {
      markedRef.current = true;
      markAll.mutate();
    }
  }, [loaded, hasUnread, markAll]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageBackHeader
        title="알림"
        action={
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="text-muted-foreground -mr-2.5"
          >
            <Link href="/more/notifications" aria-label="알림 설정">
              <Settings strokeWidth={1.7} />
            </Link>
          </Button>
        }
      />

      {query.isLoading ? (
        <ListLoading rows={4} label="알림을 불러오는 중이에요." />
      ) : query.isError ? (
        <EmptyState
          icon={<AlertTriangle />}
          title="알림을 불러오지 못했어요"
          description="잠시 후 다시 시도해 주세요"
          action={
            <Button variant="weak" className="w-full" onClick={() => void query.refetch()}>
              다시 불러오기
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState icon={<Bell />} title="최근 30일 동안 온 알림이 없어요" />
      ) : (
        <>
          {unreadItems.length > 0 ? (
            <section className="finance-panel min-w-0 px-4 pb-2">
              <SectionHeader title="새 알림" className="px-1" />
              {unreadItems.map((item) => (
                <NotificationRow key={item.id} item={item} unread />
              ))}
            </section>
          ) : null}

          {readItems.length > 0 ? (
            <section className="finance-panel min-w-0 px-4 pb-2">
              <SectionHeader title="지난 알림" className="px-1" />
              {readItems.map((item) => (
                <NotificationRow key={item.id} item={item} unread={false} />
              ))}
            </section>
          ) : null}

          {query.hasNextPage ? (
            <Button
              variant="ghost"
              className="text-muted-foreground self-center"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              {query.isFetchingNextPage ? "불러오는 중…" : "더 보기"}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
