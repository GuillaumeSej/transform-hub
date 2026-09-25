"use client";

import type { ReactNode } from "react";
import type { AuthUser, Company, Program } from "@/types";
import { Card, CardBody, CardHeader } from "@/components/shared/Card";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { describeProfiles, summarizeClearance, type ClearanceSummary } from "@/lib/profile";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-secondary">
        {label}
      </dt>
      <dd className="mt-1 break-words text-[13px] text-primary">{children}</dd>
    </div>
  );
}

function Missing({ label }: { label: string }) {
  return <span className="italic text-secondary">{label}</span>;
}

/** Carte « Informations » de la page Mon profil — lecture seule : les données du compte sont
 *  gérées par l'administrateur (UsersPanel), l'utilisateur ne peut modifier que son mot de passe. */
export function ProfileInfoCard({
  user,
  company,
  programs,
}: {
  user: AuthUser;
  /** Entreprise de l'utilisateur ; `null` pour un admin global (sans entreprise) ou pendant le
   *  chargement. */
  company: Company | null;
  programs: Program[];
}) {
  const { t } = useTranslation();
  const notSet = t("profile.notSet", "Non renseigné");
  const profileRows = describeProfiles(user, programs);
  const clearance = summarizeClearance(user, company);

  const clearanceLabel = (summary: ClearanceSummary): string => {
    switch (summary.kind) {
      case "admin":
        return t("profile.clearanceAdmin", "Accès total (administrateur)");
      case "all":
        return t("profile.clearanceAll", "Tous les niveaux");
      case "level":
        return t("profile.clearanceLevel", "{level} (et les niveaux inférieurs)").replace(
          "{level}",
          summary.level
        );
      case "none":
        return t("profile.clearanceNone", "Aucun niveau confidentiel");
    }
  };
  const clearanceSource =
    clearance.kind === "admin"
      ? null
      : clearance.source === "individual"
        ? t("profile.clearanceIndividual", "Habilitation individuelle")
        : t("profile.clearanceInherited", "Héritée de vos profils");

  const adminRights = [
    user.isGlobalAdmin ? t("profile.adminGlobal", "Admin BearingPoint") : null,
    user.isCompanyAdmin ? t("profile.adminCompany", "Admin entreprise") : null,
  ].filter((x): x is string => x !== null);

  const companyLabel = user.companyId
    ? (company?.name ?? user.companyId)
    : t("profile.companyGlobal", "BearingPoint (global)");

  return (
    <Card>
      <CardHeader title={t("profile.infoTitle", "Informations")} />
      <CardBody>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field label={t("profile.firstName", "Prénom")}>
            {user.firstName || <Missing label={notSet} />}
          </Field>
          <Field label={t("profile.lastName", "Nom")}>
            {user.lastName || <Missing label={notSet} />}
          </Field>
          <Field label={t("profile.username", "Identifiant")}>
            <span className="font-mono text-[12px]">{user.username}</span>
          </Field>
          <Field label={t("profile.email", "E-mail")}>
            {user.email?.trim() || <Missing label={notSet} />}
          </Field>
          <Field label={t("profile.company", "Entreprise")}>{companyLabel}</Field>
          <Field label={t("profile.direction", "Direction")}>
            {user.direction?.trim() || <Missing label={notSet} />}
          </Field>
          <Field label={t("profile.profiles", "Profils")}>
            {profileRows.length === 0 ? (
              <Missing label={t("profile.noProfile", "Aucun profil métier")} />
            ) : (
              <ul className="space-y-1">
                {profileRows.map((row, i) => (
                  <li key={`${row.roleLabelKey}-${row.programName ?? "all"}-${i}`}>
                    <span className="font-semibold">{t(row.roleLabelKey)}</span>
                    <span className="text-secondary">
                      {" · "}
                      {row.programName ?? t("profile.allPrograms", "Tous les programmes")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <Field label={t("profile.adminRights", "Habilitations d'administration")}>
            {adminRights.length === 0 ? (
              <Missing label={t("profile.noAdminRights", "Aucune")} />
            ) : (
              adminRights.join(", ")
            )}
          </Field>
          <Field label={t("profile.clearance", "Niveau de confidentialité")}>
            {clearanceLabel(clearance)}
            {clearanceSource && (
              <span className="block text-[11px] text-secondary">{clearanceSource}</span>
            )}
          </Field>
        </dl>
      </CardBody>
    </Card>
  );
}
