"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { accountSlug } from "@/lib/auth";
import { saveUserStaffingThresholds } from "@/lib/firestore/admin";
import { useRole } from "@/lib/hooks/useRole";
import { useToast } from "@/lib/hooks/useToast";
import { useTranslation } from "@/lib/i18n/useTranslation";
import {
  DEFAULT_STAFFING_THRESHOLDS,
  normalizeStaffingThresholds,
  type StaffingThresholds,
} from "@/lib/staffingRate";

const storageKey = (slug: string) => `betrack.staffingThresholds.${slug}`;

function readLocal(slug: string | null): StaffingThresholds | null {
  if (!slug) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    return raw ? normalizeStaffingThresholds(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeLocal(slug: string | null, value: StaffingThresholds | null) {
  if (!slug) return;
  try {
    if (value) window.localStorage.setItem(storageKey(slug), JSON.stringify(value));
    else window.localStorage.removeItem(storageKey(slug));
  } catch {
    // stockage indisponible (navigation privée...) : sans effet
  }
}

/**
 * Seuils du taux de staffing de l'utilisateur connecté (tendu / sur-staffé).
 * Source : `AuthUser.preferences.staffingThresholds` (document `adminUsers` de l'utilisateur),
 * sinon repli localStorage (écriture Firestore précédemment refusée), sinon défaut 85 / 100.
 * `save` écrit dans Firestore (mise à jour optimiste du contexte) ; en cas d'échec, la valeur est
 * conservée localement pour ce navigateur et un toast d'erreur est affiché.
 */
export function useStaffingThresholds(): {
  thresholds: StaffingThresholds;
  save: (next: StaffingThresholds) => Promise<boolean>;
  saving: boolean;
} {
  const { user, updatePreferences } = useRole();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const slug = user ? accountSlug(user.username, user.companyId) : null;
  const [localFallback, setLocalFallback] = useState<StaffingThresholds | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalFallback(readLocal(slug));
  }, [slug]);

  const stored = user?.preferences?.staffingThresholds;
  const thresholds = useMemo(
    () =>
      localFallback ??
      (stored ? normalizeStaffingThresholds(stored) : { ...DEFAULT_STAFFING_THRESHOLDS }),
    [localFallback, stored]
  );

  const save = useCallback(
    async (next: StaffingThresholds) => {
      const value = normalizeStaffingThresholds(next);
      updatePreferences({ staffingThresholds: value });
      if (!slug) return false;
      setSaving(true);
      try {
        await saveUserStaffingThresholds(slug, value);
        writeLocal(slug, null);
        setLocalFallback(null);
        showToast(
          t("effectifs.staffingRate.thresholds.saved", "Seuils enregistrés"),
          undefined,
          "success"
        );
        return true;
      } catch {
        writeLocal(slug, value);
        setLocalFallback(value);
        showToast(
          t(
            "effectifs.staffingRate.thresholds.saveError",
            "Seuils non enregistrés sur votre profil"
          ),
          t(
            "effectifs.staffingRate.thresholds.saveErrorDetail",
            "Ils sont conservés uniquement sur ce navigateur."
          ),
          "error"
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [slug, updatePreferences, showToast, t]
  );

  return { thresholds, save, saving };
}
