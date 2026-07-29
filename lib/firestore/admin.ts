import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { onListenerError } from "@/lib/firestore/listenerError";
import type {
  AuthUser,
  Company,
  HierarchyDomain,
  HierarchyNode,
  LifecycleStage,
  Program,
} from "@/types";
import { hierarchyDomain } from "@/lib/hierarchyLogic";
import { TEST_USERS } from "@/lib/auth";

// --- Companies ---

const companiesCol = () => collection(db, "companies");

export function subscribeCompanies(cb: (companies: Company[]) => void): Unsubscribe {
  return onSnapshot(
    companiesCol(),
    (snap) => {
      cb(snap.docs.map((d) => d.data() as Company));
    },
    onListenerError("companies")
  );
}

export async function saveCompany(company: Company): Promise<void> {
  await setDoc(doc(companiesCol(), company.id), company);
}

export async function saveCompanyHierarchyLevels(
  companyId: string,
  domain: HierarchyDomain,
  levels: Company["hierarchyLevels"]
): Promise<void> {
  const field = domain === "financial" ? "hierarchyLevels" : "geographyHierarchyLevels";
  await updateDoc(doc(companiesCol(), companyId), { [field]: levels ?? [] });
}

export async function deleteCompany(id: string): Promise<void> {
  await deleteDoc(doc(companiesCol(), id));
}

// --- Programs ---

const programsCol = () => collection(db, "programs");

export function subscribePrograms(cb: (programs: Program[]) => void): Unsubscribe {
  return onSnapshot(
    programsCol(),
    (snap) => {
      cb(snap.docs.map((d) => d.data() as Program));
    },
    onListenerError("programs")
  );
}

export async function saveProgram(program: Program): Promise<void> {
  await setDoc(doc(programsCol(), program.id), program);
}

export async function deleteProgram(id: string): Promise<void> {
  await deleteDoc(doc(programsCol(), id));
}

// --- Lifecycle Configs ---

const lifecycleCol = () => collection(db, "lifecycleConfigs");

export function subscribeLifecycleConfig(
  companyId: string,
  cb: (stages: LifecycleStage[]) => void
): Unsubscribe {
  return onSnapshot(
    doc(lifecycleCol(), companyId),
    (snap) => {
      const data = snap.data();
      cb(data ? (data.stages as LifecycleStage[]) : []);
    },
    onListenerError("lifecycleConfigs")
  );
}

export async function saveLifecycleConfig(
  companyId: string,
  stages: LifecycleStage[]
): Promise<void> {
  await setDoc(doc(lifecycleCol(), companyId), { companyId, stages });
}

// --- Hierarchy Nodes (arborescence financière P&L -> maille la plus fine) ---

const hierarchyNodesCol = () => collection(db, "hierarchyNodes");

/** Abonnement filtré par entreprise côté Firestore. Le domaine reste filtré côté client pour
 * préserver la compatibilité des anciens nœuds financiers sans champ `domain`. */
export function subscribeHierarchyNodes(
  companyId: string,
  cb: (nodes: HierarchyNode[]) => void,
  domain?: HierarchyDomain
): Unsubscribe {
  const scopedQuery = query(hierarchyNodesCol(), where("companyId", "==", companyId));
  return onSnapshot(
    scopedQuery,
    { includeMetadataChanges: true },
    (snap) => {
      // Ne jamais présenter une écriture locale comme enregistrée : on conserve l'ancien rendu
      // jusqu'à l'acquittement serveur. Cela évite les lignes fantômes en cas de rejet Firestore.
      if (snap.metadata.hasPendingWrites) return;
      const all = snap.docs.map((d) => d.data() as HierarchyNode);
      cb(
        all.filter(
          (node) => node.companyId === companyId && (!domain || hierarchyDomain(node) === domain)
        )
      );
    },
    onListenerError("hierarchyNodes")
  );
}

export async function saveHierarchyNode(node: HierarchyNode): Promise<void> {
  await setDoc(doc(hierarchyNodesCol(), node.id), node);
}

export async function deleteHierarchyNode(id: string): Promise<void> {
  await deleteDoc(doc(hierarchyNodesCol(), id));
}

export async function deleteHierarchyNodesBatch(ids: string[]): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = writeBatch(db);
    ids.slice(i, i + CHUNK).forEach((id) => batch.delete(doc(hierarchyNodesCol(), id)));
    await batch.commit();
  }
}

/** Création en masse (import Excel) — un seul writeBatch, jusqu'à 500 écritures par lot Firestore
 *  (largement suffisant ici : un import d'arborescence dépasse rarement quelques centaines de
 *  nœuds ; à découper en plusieurs lots le jour où ce ne serait plus le cas). */
export async function saveHierarchyNodesBatch(nodes: HierarchyNode[]): Promise<void> {
  if (nodes.length === 0) return;
  const col = hierarchyNodesCol();
  const CHUNK = 500;
  for (let i = 0; i < nodes.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const node of nodes.slice(i, i + CHUNK)) {
      batch.set(doc(col, node.id), node);
    }
    await batch.commit();
  }
}

// --- Users (admin-managed) ---

const usersCol = () => collection(db, "adminUsers");

export function subscribeUsers(cb: (users: AuthUser[]) => void): Unsubscribe {
  return onSnapshot(
    usersCol(),
    (snap) => {
      cb(snap.docs.map((d) => d.data() as AuthUser));
    },
    onListenerError("adminUsers")
  );
}

export async function saveUser(user: AuthUser): Promise<void> {
  const normalized = { ...user, username: user.username.trim().toLowerCase() };
  await setDoc(doc(usersCol(), normalized.username), normalized);
}

export async function deleteUser(username: string): Promise<void> {
  await deleteDoc(doc(usersCol(), username));
}

// --- Seed: ensure test company + test users exist in Firestore ---

export const TEST_COMPANY: Company = {
  id: "c1",
  name: "Acme Corp",
  industry: "Industrie / Manufacturing",
  createdAt: "2026-01-15",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
};

export const TEST_COMPANY_2: Company = {
  id: "c2",
  name: "GlobalTech",
  industry: "Technologie / IT",
  createdAt: "2026-01-15",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
};

export const TEST_COMPANY_3: Company = {
  id: "c3",
  name: "EuroFinance",
  industry: "Finance / Banking",
  createdAt: "2026-01-15",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
};

export const TEST_PROGRAM: Program = {
  id: "p1",
  companyId: "c1",
  name: "Transformation Acme 2026",
  sponsor: "Marie Martin",
  target: 15.0,
  currency: "€M",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
  baselineEBIT: 45.0,
  revenue: 320.0,
  createdAt: "2026-01-15",
};

export const TEST_PROGRAM_2: Program = {
  id: "p2",
  companyId: "c2",
  name: "Digital Shift GlobalTech",
  sponsor: "Sophie Chen",
  target: 22.0,
  currency: "€M",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
  baselineEBIT: 60.0,
  revenue: 480.0,
  createdAt: "2026-01-15",
};

export const TEST_PROGRAM_3: Program = {
  id: "p3",
  companyId: "c3",
  name: "Fusion EuroFinance 2026",
  sponsor: "Lucas Bernard",
  target: 10.0,
  currency: "€M",
  fyStart: "2026-01-01",
  fyEnd: "2026-12-31",
  baselineEBIT: 35.0,
  revenue: 270.0,
  createdAt: "2026-01-15",
};

let adminSeeded = false;

export async function ensureAdminSeeded(): Promise<void> {
  if (adminSeeded) return;
  adminSeeded = true;

  // Seed test companies if missing
  const companiesSnap = await getDocs(companiesCol());
  if (companiesSnap.empty) {
    await setDoc(doc(companiesCol(), TEST_COMPANY.id), TEST_COMPANY);
    await setDoc(doc(companiesCol(), TEST_COMPANY_2.id), TEST_COMPANY_2);
    await setDoc(doc(companiesCol(), TEST_COMPANY_3.id), TEST_COMPANY_3);
  }

  // Seed test programs if missing
  const programsSnap = await getDocs(programsCol());
  if (programsSnap.empty) {
    await setDoc(doc(programsCol(), TEST_PROGRAM.id), TEST_PROGRAM);
    await setDoc(doc(programsCol(), TEST_PROGRAM_2.id), TEST_PROGRAM_2);
    await setDoc(doc(programsCol(), TEST_PROGRAM_3.id), TEST_PROGRAM_3);
  }

  // Seed test users if missing
  const usersSnap = await getDocs(usersCol());
  if (usersSnap.empty) {
    const batch = TEST_USERS.map((u) => setDoc(doc(usersCol(), u.username), u));
    await Promise.all(batch);
  }
}
