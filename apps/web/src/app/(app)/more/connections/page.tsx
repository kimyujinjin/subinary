"use client";

import { ConnectionScreen } from "@/components/finance-connections/connection-screen";
import { manualFinanceCanCreate } from "@/components/manual-finance/model";
import { EmptyState } from "@/components/widgets";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";

export default function ConnectionsPage() {
  const { user, status } = useAuth();
  const { householdId, activeMembership } = useHousehold();
  if (!householdId || !user || status !== "authenticated")
    return <EmptyState title="로그인과 가족 선택이 필요해요" description="본인 앱 계정으로 로그인한 뒤 연결한 계좌를 확인할 수 있어요." />;
  // Identity/household/role changes destroy credentials, snapshots and in-flight callbacks.
  return <ConnectionScreen key={`${user.id}/${householdId}/${activeMembership?.role}`} householdId={householdId} userId={user.id} canManage={manualFinanceCanCreate(activeMembership?.role)} />;
}
