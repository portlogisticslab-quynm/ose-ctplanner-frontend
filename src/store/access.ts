// V1.4: plan of this browser ("pro" | "demo") from the Port & Logistics Hub paywall (portlogistics-hub v1.6.0).
// While the paywall is off (backend GATE_SECRET empty) the answer is always "pro" and nothing changes.
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export interface Access { plan: "pro" | "demo"; paywall: boolean; free_until: string | null; host: string; account_url: string }

export function useAccess(): Access {
  const q = useQuery({ queryKey: ["access"], staleTime: 300_000, queryFn: () => api<Access>("GET", "/api/v1/access") });
  return q.data ?? { plan: "pro", paywall: false, free_until: null, host: "ctplanner.ose.vn", account_url: "https://portlogistics.ose.vn/account/" };
}
