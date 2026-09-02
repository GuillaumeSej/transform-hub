import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onListenerError } from "@/lib/firestore/listenerError";
import type { MaturityStageConfig } from "@/types";

/**
 * Étapes de maturité d'un Plan Stratégique (à la CMMI/PPAP) — scopées PAR PROGRAMME, pas par
 * entreprise : deux programmes de la même société peuvent avoir des cycles de longueurs
 * différentes (ex. un Plan Stratégique à 12 étapes à côté d'un Plan Performance à 5 étapes de
 * cycle de vie levier). C'est la raison d'être de cette collection parallèle plutôt qu'une
 * extension de `lifecycleConfigs` (voir `lib/firestore/admin.ts`), qui est scopé entreprise et ne
 * permet ni ajout ni suppression d'étape.
 *
 * Même pattern d'abonnement que `subscribeHierarchyNodes` (filtre serveur, garde
 * `hasPendingWrites`), avec un tri par `order` appliqué côté client — l'ordre est une propriété
 * d'affichage, pas un critère de requête, et le volume (quelques étapes) ne justifie pas un index.
 */

const maturityStagesCol = () => collection(db, "maturityStageConfigs");

/** Jeu d'étapes par défaut d'un programme stratégique fraîchement créé — l'admin peut ensuite
 *  librement en ajouter/supprimer/renommer via `components/admin/MaturityStagesEditor.tsx`. */
export const DEFAULT_MATURITY_STAGES: Omit<MaturityStageConfig, "programId" | "companyId">[] = [
  { id: "defined", order: 1, label: "Défini" },
  { id: "validated", order: 2, label: "Validé" },
  { id: "planned", order: 3, label: "Planifié" },
  { id: "achieved", order: 4, label: "Réalisé", isTerminal: true },
];

export function subscribeMaturityStages(
  programId: string,
  cb: (stages: MaturityStageConfig[]) => void
): Unsubscribe {
  const scopedQuery = query(maturityStagesCol(), where("programId", "==", programId));
  return onSnapshot(
    scopedQuery,
    { includeMetadataChanges: true },
    (snap) => {
      if (snap.metadata.hasPendingWrites) return;
      const stages = snap.docs.map((d) => d.data() as MaturityStageConfig);
      cb(stages.sort((a, b) => a.order - b.order));
    },
    onListenerError("maturityStageConfigs")
  );
}

/** Id du document = `${programId}__${stage.id}` : le slug d'étape n'est unique qu'au sein d'un
 *  programme (deux programmes peuvent tous deux avoir une étape "defined"). */
function stageDocId(stage: Pick<MaturityStageConfig, "programId" | "id">): string {
  return `${stage.programId}__${stage.id}`;
}

export async function saveMaturityStage(stage: MaturityStageConfig): Promise<void> {
  await setDoc(doc(maturityStagesCol(), stageDocId(stage)), stage);
}

export async function deleteMaturityStage(programId: string, stageId: string): Promise<void> {
  await deleteDoc(doc(maturityStagesCol(), stageDocId({ programId, id: stageId })));
}

/**
 * Crée le jeu d'étapes par défaut pour un programme qui n'en a encore aucune. Même pattern
 * "créer seulement si vide" que `ensureAdminSeeded` (lib/firestore/admin.ts) : un programme dont
 * l'admin a déjà configuré (voire vidé puis reconstruit) les étapes ne doit JAMAIS se voir
 * réinjecter les valeurs par défaut. Retourne les étapes effectivement créées (vide si le
 * programme en avait déjà).
 */
export async function ensureDefaultMaturityStages(
  companyId: string,
  programId: string
): Promise<MaturityStageConfig[]> {
  const existing = await getDocs(query(maturityStagesCol(), where("programId", "==", programId)));
  if (!existing.empty) return [];

  const stages: MaturityStageConfig[] = DEFAULT_MATURITY_STAGES.map((stage) => ({
    ...stage,
    programId,
    companyId,
  }));
  const batch = writeBatch(db);
  for (const stage of stages) {
    batch.set(doc(maturityStagesCol(), stageDocId(stage)), stage);
  }
  await batch.commit();
  return stages;
}
