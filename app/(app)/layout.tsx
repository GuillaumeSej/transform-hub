import { AppShell } from "@/components/shared/AppShell";

// Route group (app) : regroupe toutes les pages protégées sous le même AppShell (sidebar/topbar +
// garde d'authentification) sans changer leurs URLs (/dashboard, /levers, etc. restent identiques).
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
