"use client";

import { useEffect, useMemo, useState } from "react";
import { generateAlerts } from "@/lib/alertEngine";
import { subscribeCompanies, subscribeUsers } from "@/lib/firestore/admin";
import { targetAlerts } from "@/lib/notifications";
import type { AuthUser, BeTrackData, Company } from "@/types";

export function useNotifications(data: BeTrackData, user: AuthUser | null | undefined) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    const unsubscribeUsers = subscribeUsers(setUsers);
    const unsubscribeCompanies = subscribeCompanies(setCompanies);
    return () => {
      unsubscribeUsers();
      unsubscribeCompanies();
    };
  }, []);

  const alerts = useMemo(
    () => targetAlerts(generateAlerts(data), user, users, data, companies),
    [data, user, users, companies]
  );

  return {
    alerts,
    unresolvedAlerts: alerts.filter((alert) => !alert.resolved),
  };
}
