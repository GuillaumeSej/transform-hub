import { AppShell } from "@/components/shared/AppShell";
import { UnsavedChangesProvider } from "@/lib/hooks/useUnsavedChanges";
import { UnsavedChangesConfirmModal } from "@/components/shared/UnsavedChangesConfirmModal";
import { ActiveProgramProvider } from "@/lib/hooks/useActiveProgram";

// Route group (app) : regroupe toutes les pages protégées sous le même AppShell (sidebar/topbar +
// garde d'authentification) sans changer leurs URLs (/dashboard, /levers, etc. restent identiques).
//
// UnsavedChangesProvider est monté ici (pas dans app/layout.tsx) parce que la garde de navigation
// "modifications non enregistrées" n'a de sens que pour les pages métier, pas pour /login.
//
// ActiveProgramProvider enrobe AppShell (et non l'inverse) : le type du programme actif pilote la
// nav elle-même (items masqués/relabelés selon Performance vs Stratégique, voir lib/nav-config.ts),
// donc la sidebar rendue par AppShell doit pouvoir le lire. Même raison pour /login exclu : ce
// contexte n'a de sens que pour les routes protégées.
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <UnsavedChangesProvider>
      <ActiveProgramProvider>
        <AppShell>{children}</AppShell>
      </ActiveProgramProvider>
      <UnsavedChangesConfirmModal />
    </UnsavedChangesProvider>
  );
}
