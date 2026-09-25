"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { Company, Program } from "@/types";
import { useRole } from "@/lib/hooks/useRole";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { useUnsavedChanges } from "@/lib/hooks/useUnsavedChanges";
import { subscribeCompanies, subscribePrograms } from "@/lib/firestore/admin";
import { Button } from "@/components/shared/Button";
import { ProfileInfoCard } from "@/components/profile/ProfileInfoCard";
import { PasswordChangeCard } from "@/components/profile/PasswordChangeCard";

/** Route `/profile` — « Mon profil », accessible à TOUT utilisateur connecté (hors nav : liste
 *  blanche dans AppShell.tsx), ouverte depuis le bloc utilisateur en bas de la Sidebar.
 *  Informations du compte en lecture seule + changement de mot de passe + déconnexion. */
export default function ProfilePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, logout } = useRole();
  const { confirmDiscard } = useUnsavedChanges();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const companyId = user?.companyId ?? null;

  // Scopé à l'entreprise de l'utilisateur (contrat des règles Firestore, voir lib/firestore/admin.ts).
  // Admin global sans entreprise : rien à charger (libellé « BearingPoint (global) »).
  useEffect(() => {
    if (!companyId) return;
    const unsubCompanies = subscribeCompanies(setCompanies, companyId);
    const unsubPrograms = subscribePrograms(setPrograms, companyId);
    return () => {
      unsubCompanies();
      unsubPrograms();
    };
  }, [companyId]);

  if (!user) return null;
  const company = companyId ? (companies.find((c) => c.id === companyId) ?? null) : null;

  return (
    <div className="animate-fade-up">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="relative pb-2 text-[22px] font-bold tracking-tight text-primary after:absolute after:bottom-0 after:left-0 after:h-[3px] after:w-9 after:bg-bp-coral">
            {t("profile.title", "Mon profil")}
          </h1>
          <p className="mt-3 text-[13px] text-secondary">
            {t(
              "profile.subtitle",
              "Vos informations de compte. Pour les modifier, contactez votre administrateur."
            )}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={async () => {
            // Même garde que le bouton de déconnexion du Topbar : travail non enregistré perdu.
            if (!(await confirmDiscard())) return;
            logout();
            router.push("/login");
          }}
        >
          <LogOut size={14} aria-hidden="true" />
          {t("profile.logout", "Se déconnecter")}
        </Button>
      </div>
      <div className="grid gap-x-4 lg:grid-cols-2">
        <ProfileInfoCard user={user} company={company} programs={programs} />
        <PasswordChangeCard username={user.username} />
      </div>
    </div>
  );
}
