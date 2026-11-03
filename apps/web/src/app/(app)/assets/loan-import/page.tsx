"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { FinanceLoading } from "@/components/manual-finance/shared";

export default function LoanImportPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/more/connections?provider=shinhan_bank"); }, [router]);
  return <div role="status" aria-label="신한은행 연결 관리로 이동"><FinanceLoading /></div>;
}
