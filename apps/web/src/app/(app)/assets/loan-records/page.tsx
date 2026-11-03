"use client";
import { LoanImportScreen } from "@/components/loan-import/import-screen";
import { manualFinanceCanCreate } from "@/components/manual-finance/model";
import { EmptyState } from "@/components/widgets";
import { useAuth } from "@/lib/auth-context";
import { useHousehold } from "@/lib/household-context";
export default function LoanRecordsPage() {
  const { user, status } = useAuth(); const { householdId, activeMembership } = useHousehold();
  if (!householdId || !user || status !== "authenticated") return <EmptyState title="로그인과 가족 선택이 필요해요" />;
  return <LoanImportScreen key={`${user.id}/${householdId}/${activeMembership?.role}`} recordsOnly householdId={householdId} userId={user.id} canCreate={manualFinanceCanCreate(activeMembership?.role)} />;
}
