import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStaffAccess } from "./useStaffAccess";

/**
 * Resolves the plan tier of the *business account* the current user belongs to.
 * For owners this is their own plan, for staff it is their owner's plan.
 */
export function useEffectivePlan() {
  const { effectiveUserId, isStaff, loading: staffLoading } = useStaffAccess();
  const [planTier, setPlanTier] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (staffLoading) return;
    if (!effectiveUserId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("plan_tier")
        .eq("user_id", effectiveUserId)
        .maybeSingle();
      if (!cancelled) {
        setPlanTier((data?.plan_tier as string) || "free");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [effectiveUserId, staffLoading]);

  return {
    planTier,
    effectiveUserId,
    isStaff,
    isGrowth: planTier === "enterprise" || planTier === "pro" || planTier === "growth",
    loading: loading || staffLoading,
  };
}
