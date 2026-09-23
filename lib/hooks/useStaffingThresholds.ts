"use client";

import { useCallback, useEffect, useState } from "react";
import {
  saveCompanyStaffingThresholds,
  subscribeCompanyDisplaySettings,
} from "@/lib/firestore/companyDisplaySettings";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  DEFAULT_STAFFING_THRESHOLDS,
  canEditStaffingThresholds,
  normalizeStaffingThresholds,
  type StaffingThresholds,
} from "@/lib/staffingRate";

const cacheKey = (companyId: string) => `betrack.staffingThresholds.company.${companyId}`;

/** Cache localStorage TRANSITOIRE (dernière valeur connue de l'entreprise) : évite l'affichage
 *  furtif des défauts 85 / 100 avant la réponse Firestore. Jamais une source de vérité. */
function readCache(companyId: string | null): StaffingThresholds | null {
  if (!companyId) return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(companyId));
    return raw ? normalizeStaffingThresholds(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeCache(companyId: string, value: StaffingThresholds | null) {
  try {
    if (value) window.localStorage.setItem(cacheKey(companyId), JSON.stringify(value));
    else window.localStorage.removeItem(cacheKey(companyId));
  } catch {
    // stockage indisponible (navigation privée...) : sans effet
  }
}

/**
 * Seuils du taux de staffing (tendu / sur-staffé) de l'ENTREPRISE — paramètre d'affichage commun
 * à tous ses utilisateurs, stocké dans `leverMeta/{companyId}__displaySettings` (voir
 * lib/firestore/companyDisplaySettings.ts). Abonnement temps réel : une modification est
 * répercutée immédiatement chez tous les utilisateurs. Défaut 85 / 100 si rien n'est défini.
 *
 * `companyId` : entreprise ciblée (page admin d'une entreprise) ; par défaut celle de
 * l'utilisateur connecté. `canEdit` : profils habilités (`canEditStaffingThresholds`) ET une
 * entreprise résolue — un admin global sans entreprise ne peut rien enregistrer ici.
 */
export function useStaffingThresholds(companyIdOverride?: string | null): {
  thresholds: StaffingThresholds;
  canEdit: boolean;
  save: (next: StaffingThresholds) => Promise<boolean>;
  saving: boolean;
} {
  const { user } = useRole();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const companyId = companyIdOverride ?? user?.companyId ?? null;
  const [thresholds, setThresholds] = useState<StaffingThresholds>(() => ({
    ...DEFAULT_STAFFING_THRESHOLDS,
  }));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setThresholds(readCache(companyId) ?? { ...DEFAULT_STAFFING_THRESHOLDS });
    if (!companyId) return;
    return subscribeCompanyDisplaySettings(companyId, (settings) => {
      const value = settings?.staffingThresholds ?? null;
      writeCache(companyId, value);
      setThresholds(value ?? { ...DEFAULT_STAFFING_THRESHOLDS });
    });
  }, [companyId]);

  const canEdit = !!companyId && canEditStaffingThresholds(user);

  const save = useCallback(
    async (next: StaffingThresholds) => {
      if (!companyId || !user || !canEditStaffingThresholds(user)) return false;
      const value = normalizeStaffingThresholds(next);
      setSaving(true);
      try {
        await saveCompanyStaffingThresholds(companyId, value, user.username);
        // Le listener confirmera la valeur ; mise à jour immédiate pour un retour sans latence.
        setThresholds(value);
        writeCache(companyId, value);
        showToast(
          t("effectifs.staffingRate.thresholds.saved", "Seuils enregistrés pour l'entreprise"),
          undefined,
          "success"
        );
        return true;
      } catch {
        showToast(
          t("effectifs.staffingRate.thresholds.saveError", "Seuils non enregistrés"),
          t(
            "effectifs.staffingRate.thresholds.saveErrorDetail",
            "Vérifiez votre connexion puis réessayez."
          ),
          "error"
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [companyId, user, showToast, t]
  );

  return { thresholds, canEdit, save, saving };
}
