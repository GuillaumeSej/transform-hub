import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onListenerError } from "@/lib/firestore/listenerError";
import { normalizeStaffingThresholds, type StaffingThresholds } from "@/lib/staffingRate";

/**
 * Paramètres d'AFFICHAGE propres à une entreprise (ex. seuils du taux de staffing tendu /
 * sur-staffé, page Budget & effectifs) — partagés par tous les utilisateurs de l'entreprise.
 *
 * Stockage : document `leverMeta/{companyId}__displaySettings`. Choix délibéré de réutiliser
 * `leverMeta` (comme lib/firestore/workforce.ts) : c'est la collection dont la règle Firestore
 * DÉJÀ DÉPLOYÉE isole les documents par entreprise via le préfixe de l'id
 * (`docId.split('__')[0]`, voir firestore.rules, `match /leverMeta/{docId}`) ET autorise
 * l'écriture à tout membre de l'entreprise (`canReadCompanyScoped` = admin global OU
 * `belongsToCompany`) — donc au profil `cto`. `companies/{id}` n'est modifiable que par un admin,
 * et une nouvelle collection racine tomberait sur le `match /{document=**}` final (refus) tant que
 * les règles ne sont pas redéployées, ce que l'équipe produit ne peut pas faire.
 *
 * La restriction « qui peut modifier » (cto, pilote stratégique, owner/sponsor de programme,
 * admins) est donc appliquée côté UI (`canEditStaffingThresholds`, lib/staffingRate.ts), pas par
 * les règles — même granularité que le reste de l'app (voir la note « pas de RBAC fin » en tête de
 * firestore.rules).
 */
const displaySettingsDoc = (companyId: string) =>
  doc(db, "leverMeta", `${companyId}__displaySettings`);

export type CompanyDisplaySettings = {
  companyId: string;
  /** Absent tant que personne ne les a définis : l'appelant retombe sur les défauts 85 / 100. */
  staffingThresholds?: StaffingThresholds;
  updatedBy?: string;
  updatedAt?: string;
};

/** Abonnement temps réel : toute modification (par la direction) est répercutée immédiatement
 *  chez tous les utilisateurs de l'entreprise. `null` = document absent / illisible. */
export function subscribeCompanyDisplaySettings(
  companyId: string,
  cb: (settings: CompanyDisplaySettings | null) => void
): Unsubscribe {
  return onSnapshot(
    displaySettingsDoc(companyId),
    (snap) => {
      const data = snap.data();
      if (!data) {
        cb(null);
        return;
      }
      cb({
        companyId,
        staffingThresholds:
          data.staffingThresholds != null
            ? normalizeStaffingThresholds(data.staffingThresholds)
            : undefined,
        updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : undefined,
        updatedAt: typeof data.updatedAt === "string" ? data.updatedAt : undefined,
      });
    },
    onListenerError("companyDisplaySettings")
  );
}

/** Enregistre les seuils du taux de staffing de l'entreprise (fusion : les autres paramètres
 *  d'affichage éventuels du document sont conservés). */
export async function saveCompanyStaffingThresholds(
  companyId: string,
  thresholds: StaffingThresholds,
  updatedBy: string
): Promise<void> {
  await setDoc(
    displaySettingsDoc(companyId),
    {
      companyId,
      staffingThresholds: { tense: thresholds.tense, over: thresholds.over },
      updatedBy,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
}
