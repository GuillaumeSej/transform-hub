import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { AuthUser, Company, LifecycleStage, Project } from "@/types";
import { TEST_USERS } from "@/lib/auth";

// --- Companies ---

const companiesCol = () => collection(db, "companies");

export function subscribeCompanies(cb: (companies: Company[]) => void): Unsubscribe {
  return onSnapshot(companiesCol(), (snap) => {
    cb(snap.docs.map((d) => d.data() as Company));
  });
}

export async function saveCompany(company: Company): Promise<void> {
  await setDoc(doc(companiesCol(), company.id), company);
}

export async function deleteCompany(id: string): Promise<void> {
  await deleteDoc(doc(companiesCol(), id));
}

// --- Projects ---

const projectsCol = () => collection(db, "projects");

export function subscribeProjects(cb: (projects: Project[]) => void): Unsubscribe {
  return onSnapshot(projectsCol(), (snap) => {
    cb(snap.docs.map((d) => d.data() as Project));
  });
}

export async function saveProject(project: Project): Promise<void> {
  await setDoc(doc(projectsCol(), project.id), project);
}

export async function deleteProject(id: string): Promise<void> {
  await deleteDoc(doc(projectsCol(), id));
}

// --- Lifecycle Configs ---

const lifecycleCol = () => collection(db, "lifecycleConfigs");

export function subscribeLifecycleConfig(
  companyId: string,
  cb: (stages: LifecycleStage[]) => void
): Unsubscribe {
  return onSnapshot(doc(lifecycleCol(), companyId), (snap) => {
    const data = snap.data();
    cb(data ? (data.stages as LifecycleStage[]) : []);
  });
}

export async function saveLifecycleConfig(
  companyId: string,
  stages: LifecycleStage[]
): Promise<void> {
  await setDoc(doc(lifecycleCol(), companyId), { companyId, stages });
}

// --- Users (admin-managed) ---

const usersCol = () => collection(db, "adminUsers");

export function subscribeUsers(cb: (users: AuthUser[]) => void): Unsubscribe {
  return onSnapshot(usersCol(), (snap) => {
    cb(snap.docs.map((d) => d.data() as AuthUser));
  });
}

export async function saveUser(user: AuthUser): Promise<void> {
  await setDoc(doc(usersCol(), user.username), user);
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

let adminSeeded = false;

export async function ensureAdminSeeded(): Promise<void> {
  if (adminSeeded) return;
  adminSeeded = true;

  // Seed test company if missing
  const companiesSnap = await getDocs(companiesCol());
  if (companiesSnap.empty) {
    await setDoc(doc(companiesCol(), TEST_COMPANY.id), TEST_COMPANY);
  }

  // Seed test users if missing
  const usersSnap = await getDocs(usersCol());
  if (usersSnap.empty) {
    const batch = TEST_USERS.map((u) => setDoc(doc(usersCol(), u.username), u));
    await Promise.all(batch);
  }
}
