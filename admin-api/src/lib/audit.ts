import type { Firestore } from "firebase-admin/firestore";

/**
 * Audit trail for privileged admin-api actions.
 *
 * DEVIATION from the frontend's existing audit convention (documented here on purpose): the app's
 * `AuditEntry` type (types/index.ts) and its storage (`leverMeta/{companyId}__auditLog`, a single
 * document per company holding an `entries` array — see lib/firestore/levers.ts) are both modeled
 * specifically around LEVERS: `AuditEntry.action` is a closed union that has no "rename_user" /
 * "delete_user" member, `entity` is documented as a lever/movement/employee id, and the whole
 * scheme has no representation for a GLOBAL admin action (companyId === null) — `saveAuditLog`
 * explicitly no-ops in that case. Reusing that exact collection would either require illegally
 * shoehorning these actions into the lever action union, or silently dropping audit entries for
 * every global-admin rename/delete (the most sensitive case). Instead this service writes to its
 * own collection, `adminApiAuditLog`, one document per event (auto id) rather than one growing
 * array per company, so global-admin actions (companyId null) are represented too. The field names
 * intentionally mirror the app's `AuditEntry` shape (`ts`, `action`) plus the extra fields this
 * flow needs (`actor`, `targetOldUsername`, `targetNewUsername`, `companyId`), for a human reading
 * both logs side by side.
 */
export type AdminApiAuditEntry = {
  ts: string;
  action: "rename_user" | "delete_user";
  actorUsername: string;
  actorUid: string;
  targetOldUsername: string;
  targetNewUsername?: string;
  companyId: string | null;
};

export async function writeAuditEntry(db: Firestore, entry: AdminApiAuditEntry): Promise<void> {
  try {
    await db.collection("adminApiAuditLog").add(entry);
  } catch (err) {
    // Never let an audit-log failure mask the success of the actual operation, but make sure it's
    // visible in the logs (stdout, captured by Render/Azure) since we can't retry silently later.
    console.error(
      JSON.stringify({
        msg: "audit_log_write_failed",
        action: entry.action,
        error: err instanceof Error ? err.message : String(err),
      })
    );
  }
}
