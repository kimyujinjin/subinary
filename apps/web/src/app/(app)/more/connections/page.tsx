"use client";

import { Suspense } from "react";
import { AssetConnectionHub } from "@/components/finance-connections/provider-hub";
import { FinanceLoading } from "@/components/manual-finance/shared";
import { manualFinanceCanCreate } from "@/components/manual-finance/model";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";

export default function ConnectionsPage() {
  const { user } = useAuth();
  const { householdId, activeMembership } = useHousehold();
  // (app) 레이아웃의 AppReadinessBoundary가 로그인·가족 선택이 끝난 뒤에만 이 화면을 그린다 — 여기서는 타입만 좁힌다.
  if (!householdId || !user) return null;
  // Identity/household/role changes destroy credentials, snapshots and in-flight callbacks.
  return <Suspense fallback={<FinanceLoading />}><AssetConnectionHub key={`${user.id}/${householdId}/${activeMembership?.role}`} householdId={householdId} userId={user.id} canManage={manualFinanceCanCreate(activeMembership?.role)} /></Suspense>;
}
