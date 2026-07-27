import { AppShell } from "@/components/shared/AppShell";
import { UnsavedChangesProvider } from "@/lib/hooks/useUnsavedChanges";
import { UnsavedChangesConfirmModal } from "@/components/shared/UnsavedChangesConfirmModal";

// Route group (app) : regroupe toutes les pages protégées sous le même AppShell (sidebar/topbar +
// garde d'authentification) sans changer leurs URLs (/dashboard, /levers, etc. restent identiques).
//
// UnsavedChangesProvider est monté ici (pas dans app/layout.tsx) parce que la garde de navigation
// "modifications non enregistrées" n'a de sens que pour les pages métier, pas pour /login.
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <UnsavedChangesProvider>
      <AppShell>{children}</AppShell>
      <UnsavedChangesConfirmModal />
    </UnsavedChangesProvider>
  );
}
