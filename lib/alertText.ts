import type { Alert } from "@/types";

/** Signature de `t` (useTranslation) — passée en argument pour garder ce module pur (sans hook). */
type Translate = (key: string, fallback?: string) => string;

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), template);
}

/** Titre affichable d'une alerte : traduit pour les alertes auto porteuses de `i18n` (générées
 *  par lib/alertEngine.ts), texte saisi tel quel pour les alertes manuelles. Le gabarit français
 *  sert de fallback quand la clé manque dans le dictionnaire actif. */
export function alertTitle(t: Translate, alert: Alert): string {
  if (!alert.i18n) return alert.title;
  return fill(t(alert.i18n.titleKey, alert.title), alert.i18n.vars);
}

export function alertDesc(t: Translate, alert: Alert): string {
  if (!alert.i18n) return alert.desc;
  return fill(t(alert.i18n.descKey, alert.desc), alert.i18n.vars);
}
