"use client";

import { useEffect, useState, type ReactNode } from "react";
import { RoleProvider } from "@/lib/hooks/useRole";
import { ToastProvider } from "@/lib/hooks/useToast";
import { initializeStorage, getAlerts, resetToMockData } from "@/lib/storage";
import { Sidebar } from "@/components/shared/Sidebar";
import { Topbar } from "@/components/shared/Topbar";
import { Toaster } from "@/components/shared/Toaster";

function Shell({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    initializeStorage();
    setAlertCount(getAlerts().length);
    setReady(true);
  }, []);

  if (!ready) return null;

  return (
    <div className="flex h-screen">
      <Sidebar alertCount={alertCount} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar
          alertCount={alertCount}
          onReset={() => {
            resetToMockData();
            setAlertCount(getAlerts().length);
            window.location.reload();
          }}
        />
        <main className="flex-1 overflow-y-auto px-6 pb-10 pt-5">{children}</main>
      </div>
      <Toaster />
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RoleProvider>
      <ToastProvider>
        <Shell>{children}</Shell>
      </ToastProvider>
    </RoleProvider>
  );
}
