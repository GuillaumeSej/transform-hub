import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AuditEntry, Comment, Lever, LeverDependency, SubLever } from "@/types";

/**
 * Couche Firestore pour le périmètre "leviers" (levers, sous-leviers, commentaires, journal
 * d'audit) : c'est la donnée que plusieurs personnes doivent voir à jour en même temps, donc
 * elle sort de localStorage. Le reste (program, workstreams, workforce, operations, alerts,
 * scenarios) reste sur localStorage pour l'instant, voir lib/storage.ts.
 */

// Incrémenter force un reseed complet de la BDD (schéma de données modifié) — même logique
// que SCHEMA_VERSION dans lib/storage.ts.
const SCHEMA_VERSION = "2";

const leversCol = () => collection(db, "levers");
const subLeversCol = () => collection(db, "subLevers");
const metaDoc = () => doc(db, "meta", "levers");
const commentsDoc = () => doc(db, "leverMeta", "comments");
const auditDoc = () => doc(db, "leverMeta", "auditLog");

/** Normalise les dépendances lues depuis Firestore : les documents écrits avant l'introduction
 * des types de dépendance stockent des ids bruts (`string[]`) — on les convertit en
 * `{ targetId, type: "FS" }` à la lecture, sans bump du schéma (un bump forcerait un reseed qui
 * écraserait les données saisies par l'équipe). */
function normalizeDependencies(deps: unknown): LeverDependency[] {
  if (!Array.isArray(deps)) return [];
  return deps
    .map((d): LeverDependency | null => {
      if (typeof d === "string") return { targetId: d, type: "FS" };
      if (d && typeof d === "object" && typeof (d as LeverDependency).targetId === "string") {
        const type = (d as LeverDependency).type;
        return {
          targetId: (d as LeverDependency).targetId,
          type: type === "SS" || type === "FF" || type === "SF" ? type : "FS",
        };
      }
      return null;
    })
    .filter((d): d is LeverDependency => d !== null);
}

export function subscribeLevers(cb: (levers: Lever[]) => void): Unsubscribe {
  return onSnapshot(leversCol(), (snap) => {
    cb(
      snap.docs.map((d) => {
        const lever = d.data() as Lever;
        return { ...lever, dependencies: normalizeDependencies(lever.dependencies) };
      })
    );
  });
}

export function subscribeSubLevers(cb: (subLevers: SubLever[]) => void): Unsubscribe {
  return onSnapshot(subLeversCol(), (snap) => {
    cb(
      snap.docs.map((d) => {
        const subLever = d.data() as SubLever;
        return { ...subLever, dependencies: normalizeDependencies(subLever.dependencies) };
      })
    );
  });
}

export function subscribeComments(cb: (comments: Record<string, Comment[]>) => void): Unsubscribe {
  return onSnapshot(commentsDoc(), (snap) => {
    cb((snap.data() as Record<string, Comment[]>) ?? {});
  });
}

export function subscribeAuditLog(cb: (audit: AuditEntry[]) => void): Unsubscribe {
  return onSnapshot(auditDoc(), (snap) => {
    cb((snap.data()?.entries as AuditEntry[]) ?? []);
  });
}

export async function saveLever(lever: Lever): Promise<void> {
  await setDoc(doc(leversCol(), lever.id), lever);
}

export async function saveSubLever(subLever: SubLever): Promise<void> {
  await setDoc(doc(subLeversCol(), subLever.id), subLever);
}

export async function deleteSubLeverDoc(id: string): Promise<void> {
  await deleteDoc(doc(subLeversCol(), id));
}

export async function saveComments(comments: Record<string, Comment[]>): Promise<void> {
  await setDoc(commentsDoc(), comments);
}

export async function saveAuditLog(entries: AuditEntry[]): Promise<void> {
  await setDoc(auditDoc(), { entries });
}

type LeversSeed = {
  levers: Lever[];
  subLevers: SubLever[];
  comments: Record<string, Comment[]>;
  audit: AuditEntry[];
};

/** Purge les leviers/sous-leviers existants et réécrit le seed fourni — utilisé au premier
 * démarrage (schéma jamais initialisé) et par le bouton "réinitialiser la démo". */
export async function forceReseedLevers(seed: LeversSeed): Promise<void> {
  const [existingLevers, existingSubLevers] = await Promise.all([
    getDocs(leversCol()),
    getDocs(subLeversCol()),
  ]);

  const batch = writeBatch(db);
  existingLevers.forEach((d) => batch.delete(d.ref));
  existingSubLevers.forEach((d) => batch.delete(d.ref));
  seed.levers.forEach((l) => batch.set(doc(leversCol(), l.id), l));
  seed.subLevers.forEach((s) => batch.set(doc(subLeversCol(), s.id), s));
  batch.set(commentsDoc(), seed.comments);
  batch.set(auditDoc(), { entries: seed.audit });
  batch.set(metaDoc(), { schemaVersion: SCHEMA_VERSION });
  await batch.commit();
}

/** Amorce Firestore avec le seed mockData si la BDD n'a jamais été initialisée pour ce schéma
 * (démarrage à vide ou schéma changé) — idempotent, ne touche à rien si déjà initialisé. */
export async function ensureLeversSeeded(seed: LeversSeed): Promise<void> {
  const meta = await getDoc(metaDoc());
  if (meta.exists() && meta.data().schemaVersion === SCHEMA_VERSION) return;
  await forceReseedLevers(seed);
}
