/**
 * Planificateur PUR (aucun import Firebase) des données de la vidéo de démo « Plan Stratégique »
 * — programme « Excellence Opérationnelle 2026-2028 » (p-strat-demo-2026) d'Acme Corp (c1).
 * Utilisé par scripts/prepare-demo-strat-video.js (lecture Firestore + écriture) et testé par
 * lib/__tests__/demoStratVideoPlan.test.ts (qui vérifie les formes produites avec les VRAIES
 * fonctions de l'app : chaîne de validation, Mon espace, dépendances, staffing, confidentialité).
 *
 * Entrée : `snapshot` = objets bruts lus en base (voir `DemoSnapshot` ci-dessous).
 * Sortie : `{ writes: [{ op: "set"|"update"|"delete", path, data }], report }`.
 *
 * Principes :
 *  - ids déterministes préfixés `demo-video-` pour tout document CRÉÉ (projets, demandes de
 *    validation, lignes de staffing) → le nettoyage les supprime par préfixe ;
 *  - tout champ d'un document EXISTANT modifié (responsable de saisie du KPI NPS, niveaux de
 *    confidentialité de l'entreprise, niveau de l'axe Talents, désignations de projet/chantier
 *    manquantes) voit sa valeur d'origine sauvegardée dans `demoData/demo-video-backup` (une seule
 *    fois : une relance ne l'écrase jamais) → le nettoyage la restaure ;
 *  - idempotent : l'état désiré est comparé au snapshot, seules les différences sont écrites (une
 *    relance sur l'état post-application, avec le même `now`, ne produit aucune écriture).
 *
 * Correspondance rôles app ↔ modèle (lib/strategicHierarchy.ts, fr.ts) :
 *  - « Pilote du plan stratégique » = profil `strategic_lead` ;
 *  - « Sponsor d'axe » = `StrategicAxis.owner` (profil `axis_sponsor`) ;
 *  - « Sponsor de chantier » = `Chantier.pilote` (profil `chantier_owner`) ;
 *  - « Responsable projet » = `ChantierAction.owner` (profil `chantier_contributor`) ;
 *  - « Contributeur projet » = `ChantierAction.contributors` (profil `projet_contributor`).
 */

const PROGRAM_ID = "p-strat-demo-2026";
const COMPANY_ID = "c1";
const PREFIX = "demo-video-";
const BACKUP_PATH = "demoData/demo-video-backup";
const CONFIDENTIAL_LEVEL = "Confidentiel";
/** Taux visé pour l'équipe sur-staffée (mobilisé / disponible) — marge au-dessus de ~120 %. */
const TARGET_STAFFING_RATE = 1.35;
/** Sentinelle « supprimer ce champ » (convertie en FieldValue.delete() par le script). */
const DELETE_FIELD = "__DEMO_VIDEO_DELETE_FIELD__";

const STRATEGIC_ROLES = [
  "strategic_lead",
  "axis_sponsor",
  "chantier_owner",
  "chantier_contributor",
  "projet_contributor",
  "hr",
  "comex_member",
];

const IDS = {
  projetLate: `${PREFIX}projet-revue-fournisseurs`,
  projetUpcoming: `${PREFIX}projet-continuite-transport`,
  deliverable1: `${PREFIX}livrable-cartographie`,
  deliverable2: `${PREFIX}livrable-plan-continuite`,
  prereq: `${PREFIX}prerequis-fs`,
  apprContribPending: `${PREFIX}appr-contrib-budget`,
  apprOwnerPending: `${PREFIX}appr-owner-echeance`,
  apprApprovedPlanning: `${PREFIX}appr-approved-echeance`,
  apprRejectedBudget: `${PREFIX}appr-rejected-budget`,
  apprApprovedBudget: `${PREFIX}appr-approved-budget`,
  staffing1: `${PREFIX}staffing-1`,
  staffing2: `${PREFIX}staffing-2`,
};

// ─── Utilitaires purs ────────────────────────────────────────────────────────────────────────

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const isDemoId = (id) => typeof id === "string" && id.startsWith(PREFIX);

function stripUndefined(value) {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = stripUndefined(v);
    return out;
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
const deepEqual = (a, b) => stable(a) === stable(b);

const DAY_MS = 86_400_000;
const isoDay = (date) => date.toISOString().slice(0, 10);
const addDays = (day, n) => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
const isoAt = (day, hour) => `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const dayNum = (s) => Date.parse(`${s.slice(0, 10)}T00:00:00Z`) / DAY_MS;

/** Bornes (UTC) du mois `offset` mois après celui de `today`. */
function monthBounds(today, offset) {
  const y = Number(today.slice(0, 4));
  const m0 = Number(today.slice(5, 7)) - 1 + offset;
  const start = new Date(Date.UTC(y, m0, 1));
  const end = new Date(Date.UTC(y, m0 + 1, 0));
  return { start: isoDay(start), end: isoDay(end) };
}

/** Même règle que lib/staffingNeed.ts::averageFte (ETP moyens pondérés par le recouvrement). */
function averageFte(entries, period) {
  const periodDays = dayNum(period.end) - dayNum(period.start) + 1;
  let sum = 0;
  for (const e of entries) {
    if (!e.startDate) continue;
    const s = Math.max(dayNum(e.startDate), dayNum(period.start));
    const en = Math.min(dayNum(e.endDate ?? "9999-12-31"), dayNum(period.end));
    const days = Math.max(0, en - s + 1);
    sum += (e.fte || 0) * (days / periodDays);
  }
  return sum;
}

/** Même règle que lib/workforceLogic.ts::fteByDepartment. */
function fteByDepartment(employees) {
  const map = {};
  for (const e of employees ?? []) {
    if (!e.department) continue;
    map[e.department] = (map[e.department] ?? 0) + (e.fte || 0);
  }
  return map;
}

// ─── Utilisateurs / rôles ────────────────────────────────────────────────────────────────────

const isAdmin = (u) => !!(u?.isGlobalAdmin || u?.isCompanyAdmin);
const isActive = (u) => !!u && u.disabled !== true;
const hasProgramRole = (u, role, programId = PROGRAM_ID) =>
  (u?.profiles ?? []).some((p) => p.role === role && (!p.programId || p.programId === programId));
const displayName = (u) =>
  u ? u.name || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username : undefined;

/** Réplique de lib/leversLogic.ts::resolveConfidentialityClearance (piste stratégique,
 *  hiérarchique) : l'utilisateur voit-il un élément de niveau `level` ? */
function hasClearanceFor(user, level, company, orderedLevels) {
  if (isAdmin(user)) return true;
  const override = user.confidentialityClearance;
  if (override === "all") return true;
  let raw;
  if (override !== undefined) raw = Array.isArray(override) ? override : [override];
  else {
    raw = [];
    for (const p of user.profiles ?? []) {
      if (!STRATEGIC_ROLES.includes(p.role)) continue;
      const forRole = company?.roleClearance?.[p.role];
      if (forRole == null) continue;
      raw.push(...(Array.isArray(forRole) ? forRole : [forRole]));
    }
  }
  const best = Math.max(-1, ...raw.map((l) => orderedLevels.indexOf(l)));
  const need = orderedLevels.indexOf(level);
  return need >= 0 && need <= best;
}

// ─── Plan ────────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} DemoSnapshot
 * @property {object|null} program       programs/p-strat-demo-2026
 * @property {object|null} company       companies/c1
 * @property {object[]} users            adminUsers de c1 ({ docId, ...AuthUser })
 * @property {object[]} axes             strategicAxes du programme
 * @property {object[]} chantiers        chantiers du programme
 * @property {object[]} chantierActions  projets des chantiers du programme
 * @property {object[]} indicators       indicateurs du programme
 * @property {object[]} [measurements]   mesures des indicateurs du programme
 * @property {object[]} staffing         chantierStaffing du programme
 * @property {object[]} employees        base ETP (leverMeta/c1__workforceEmployees.list)
 * @property {object[]} approvals        strategicApprovals du programme
 * @property {object|null} [backup]      demoData/demo-video-backup
 */

function planDemoStratVideo(snapshot, { now } = {}) {
  const nowDate = now ? new Date(now) : new Date();
  const today = isoDay(nowDate);
  const snap = {
    users: [],
    axes: [],
    chantiers: [],
    chantierActions: [],
    indicators: [],
    measurements: [],
    staffing: [],
    employees: [],
    approvals: [],
    ...snapshot,
  };
  const writes = [];
  const report = {
    missingAccounts: [],
    notes: [],
    usersWithoutClearance: [],
    cast: {},
  };
  const backupEntries = [...(snap.backup?.entries ?? [])];
  let backupChanged = false;

  if (!snap.program) report.notes.push(`Programme ${PROGRAM_ID} introuvable.`);
  if (!snap.company) report.notes.push(`Entreprise ${COMPANY_ID} introuvable.`);

  const users = snap.users.filter(isActive);
  const userByName = new Map(users.map((u) => [u.username, u]));
  const nameOf = (username) => displayName(userByName.get(username)) ?? username;
  const docsByPath = new Map();
  const index = (collection, list) =>
    list.forEach((d) => docsByPath.set(`${collection}/${d.id}`, d));
  index("strategicAxes", snap.axes);
  index("chantiers", snap.chantiers);
  index("chantierActions", snap.chantierActions);
  index("indicators", snap.indicators);
  index("chantierStaffing", snap.staffing);
  index("strategicApprovals", snap.approvals);
  if (snap.company) docsByPath.set(`companies/${snap.company.id ?? COMPANY_ID}`, snap.company);

  /** Modifie UN champ d'un document existant (sauvegarde de la valeur d'origine, une fois). */
  const pendingUpdates = new Map();
  function setField(path, field, value, reason) {
    const doc = docsByPath.get(path);
    if (!doc) return;
    const current = doc[field];
    if (deepEqual(current, value)) return;
    if (!backupEntries.some((e) => e.path === path && e.field === field)) {
      backupEntries.push(
        stripUndefined({
          path,
          field,
          existed: current !== undefined,
          value: current,
        })
      );
      backupChanged = true;
    }
    const data = pendingUpdates.get(path) ?? {};
    data[field] = value;
    pendingUpdates.set(path, data);
    report.notes.push(`${path} · ${field} ← ${JSON.stringify(value)} (${reason})`);
  }
  /** Crée/remplace un document démo (écrit seulement s'il diffère de l'existant). */
  const setWrites = [];
  function setDoc(path, data) {
    const clean = stripUndefined(data);
    if (deepEqual(docsByPath.get(path), clean)) return;
    setWrites.push({ op: "set", path, data: clean });
  }

  // ── Distribution des rôles ──────────────────────────────────────────────────────────────
  const program = (list) => list.filter((x) => !x.programId || x.programId === PROGRAM_ID);
  const axes = program(snap.axes);
  const chantiers = program(snap.chantiers).sort((a, b) => a.id.localeCompare(b.id));
  const supply =
    chantiers.find((c) => norm(c.name).includes("optimisation supply chain")) ??
    chantiers.find((c) => norm(c.name).includes("supply chain"));
  const talents = axes.find((a) => norm(a.name).includes("talents"));
  if (!supply)
    report.notes.push("Chantier « Optimisation Supply Chain » introuvable : b), c), d) ignorés.");
  if (!talents) report.notes.push("Axe « Talents & Organisation » introuvable : f) partiel.");

  const pilots = users
    .filter((u) => hasProgramRole(u, "strategic_lead"))
    .map((u) => u.username)
    .sort();
  const isPilotLike = (username) => {
    const u = userByName.get(username);
    return !!u && (hasProgramRole(u, "strategic_lead") || hasProgramRole(u, "cto"));
  };
  const firstWithRole = (role, exclude = []) =>
    users
      .filter((u) => !isAdmin(u) && hasProgramRole(u, role) && !exclude.includes(u.username))
      .map((u) => u.username)
      .sort()[0];

  let sponsor; // Sponsor de chantier (Chantier.pilote)
  let owner; // Responsable projet (P1.owner)
  let contributor; // Contributeur projet
  let p1;
  let axisOfSupply;
  if (supply) {
    axisOfSupply = axes.find((a) => a.id === (supply.axisIds ?? [])[0]);
    sponsor = userByName.has(supply.pilote) ? supply.pilote : firstWithRole("chantier_owner");
    if (sponsor && sponsor !== supply.pilote) {
      setField(`chantiers/${supply.id}`, "pilote", sponsor, "sponsor de chantier manquant");
    }
    const projets = snap.chantierActions
      .filter((a) => a.chantierId === supply.id && !isDemoId(a.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    p1 =
      projets.find(
        (a) => userByName.has(a.owner) && a.owner !== sponsor && !isPilotLike(a.owner)
      ) ?? projets[0];
    if (!p1)
      report.notes.push("Aucun projet existant sur « Optimisation Supply Chain » : c) ignoré.");
    if (p1) {
      owner =
        userByName.has(p1.owner) && p1.owner !== sponsor && !isPilotLike(p1.owner)
          ? p1.owner
          : firstWithRole("chantier_contributor", [sponsor]);
      if (owner && owner !== p1.owner) {
        setField(`chantierActions/${p1.id}`, "owner", owner, "responsable projet manquant");
      }
      const contribs = p1.contributors ?? [];
      contributor =
        contribs
          .filter(
            (u) => userByName.has(u) && hasProgramRole(userByName.get(u), "projet_contributor")
          )
          .filter((u) => u !== owner && u !== sponsor)
          .sort()[0] ?? firstWithRole("projet_contributor", [owner, sponsor]);
      if (contributor && !contribs.includes(contributor)) {
        setField(
          `chantierActions/${p1.id}`,
          "contributors",
          [...contribs, contributor],
          "contributeur projet ajouté au projet"
        );
      }
    }
  }
  report.cast = stripUndefined({
    pilots,
    axisSponsor: axisOfSupply?.owner,
    chantierSponsor: sponsor,
    projectOwner: owner,
    projectContributor: contributor,
    chantierId: supply?.id,
    projetId: p1?.id,
  });

  // ── a) KPI NPS : responsable de saisie ─────────────────────────────────────────────────
  const nps = program(snap.indicators).find((i) => /\bnps\b/i.test(norm(i.name)));
  if (!nps) report.notes.push("KPI « NPS » introuvable : a) ignoré.");
  else {
    const responsible =
      owner && !isPilotLike(owner) ? owner : sponsor && !isPilotLike(sponsor) ? sponsor : undefined;
    if (!responsible)
      report.notes.push("NPS : aucun responsable projet / sponsor de chantier utilisable.");
    else {
      setField(
        `indicators/${nps.id}`,
        "additionalAuthorizedUserIds",
        [responsible],
        "responsable de saisie du NPS"
      );
      const kept = (snap.measurements ?? []).filter((m) => m.indicatorId === nps.id).length;
      report.notes.push(`NPS : historique conservé (${kept} mesure(s), aucune n'est modifiée).`);
    }
  }

  // ── b) + d) Projets démo (chronologie, dépendance FS, Mon espace du sponsor) ─────────────
  if (supply && sponsor) {
    const status = p1?.status ?? "in_progress";
    const milestones = { currentMilestone: "E2", passedMilestones: ["E0", "E1"], checklists: {} };
    const late = {
      id: IDS.projetLate,
      companyId: COMPANY_ID,
      chantierId: supply.id,
      name: "Revue des fournisseurs critiques",
      description: "Qualification des fournisseurs de rang 1 à risque (démo).",
      owner: sponsor,
      start: addDays(today, -75),
      end: addDays(today, -12),
      status,
      milestones,
    };
    const upcoming = {
      id: IDS.projetUpcoming,
      companyId: COMPANY_ID,
      chantierId: supply.id,
      name: "Plan de continuité transport",
      description: "Sécurisation des flux transport en cas de rupture (démo).",
      owner: sponsor,
      start: addDays(today, -30),
      end: addDays(today, 21),
      status,
      milestones,
      deliverables: [
        {
          id: IDS.deliverable1,
          label: "Cartographie des flux transport",
          phases: [],
          dueDate: addDays(today, -5),
          status: "done",
        },
        {
          id: IDS.deliverable2,
          label: "Plan de continuité validé",
          phases: [],
          dueDate: addDays(today, 18),
          status: "todo",
        },
      ],
      prerequisites: [{ id: IDS.prereq, kind: "action", targetActionId: IDS.projetLate }],
    };
    setDoc(`chantierActions/${late.id}`, late);
    setDoc(`chantierActions/${upcoming.id}`, upcoming);
  }

  // ── c) Demandes de validation ──────────────────────────────────────────────────────────
  if (supply && p1 && sponsor && owner) {
    const base = {
      companyId: COMPANY_ID,
      programId: PROGRAM_ID,
      kind: "projet_update",
      targetType: "projet",
      targetId: p1.id,
      targetName: p1.name,
    };
    const step = (level, usernames, decision) =>
      stripUndefined({
        level,
        usernames,
        ...(decision
          ? {
              decidedBy: decision.by,
              decidedByName: nameOf(decision.by),
              decidedAt: decision.at,
              decision: decision.status,
              decisionComment: decision.comment,
            }
          : {}),
      });
    const budget = typeof p1.budget === "number" ? p1.budget : undefined;
    const d = (n, h) => isoAt(addDays(today, n), h);
    const approvals = [];

    // A2 — phone : échéance (planning, 1 validation) demandée par le responsable projet.
    if (p1.end) {
      approvals.push({
        ...base,
        id: IDS.apprOwnerPending,
        payload: {
          patch: { end: addDays(p1.end, 14) },
          before: { end: p1.end },
          category: "planning",
        },
        requestedBy: owner,
        requestedByName: nameOf(owner),
        requestedAt: d(-1, 9),
        approverRole: "chantier_owner",
        approverUsername: sponsor,
        approverUsernames: [sponsor],
        status: "pending",
        reason: "Décalage de deux semaines lié au retard d'un transporteur.",
        chain: [step("chantierSponsor", [sponsor])],
        stepIndex: 0,
      });
      // Historique : échéance approuvée par le sponsor de chantier.
      approvals.push({
        ...base,
        id: IDS.apprApprovedPlanning,
        payload: {
          patch: { end: p1.end },
          before: { end: addDays(p1.end, -30) },
          category: "planning",
        },
        requestedBy: owner,
        requestedByName: nameOf(owner),
        requestedAt: d(-32, 10),
        approverRole: "chantier_owner",
        approverUsername: sponsor,
        approverUsernames: [sponsor],
        status: "approved",
        decidedBy: sponsor,
        decidedByName: nameOf(sponsor),
        decidedAt: d(-30, 15),
        reason: "Replanification après cadrage.",
        chain: [
          step("chantierSponsor", [sponsor], { by: sponsor, at: d(-30, 15), status: "approved" }),
        ],
        stepIndex: 0,
      });
    } else report.notes.push(`Projet ${p1.id} sans date de fin : demandes d'échéance ignorées.`);

    if (contributor) {
      // A1 — scène principale : contributeur → responsable projet (validé) → sponsor (en attente).
      approvals.push({
        ...base,
        id: IDS.apprContribPending,
        payload: stripUndefined({
          patch: { budget: (budget ?? 110000) + 40000 },
          before: { budget },
          category: "pilotage",
        }),
        requestedBy: contributor,
        requestedByName: nameOf(contributor),
        requestedAt: d(-3, 9),
        approverRole: "chantier_owner",
        approverUsername: sponsor,
        approverUsernames: [sponsor],
        status: "pending",
        reason: "Surcoût transport express pour tenir la date de mise en service.",
        chain: [
          step("projectOwner", [owner], {
            by: owner,
            at: d(-2, 11),
            status: "approved",
            comment: "OK de mon côté, surcoût justifié.",
          }),
          step("chantierSponsor", [sponsor]),
        ],
        stepIndex: 1,
      });
      // Historique : demande de budget refusée au 1er palier.
      approvals.push({
        ...base,
        id: IDS.apprRejectedBudget,
        payload: stripUndefined({
          patch: { budget: (budget ?? 110000) + 120000 },
          before: { budget },
          category: "pilotage",
        }),
        requestedBy: contributor,
        requestedByName: nameOf(contributor),
        requestedAt: d(-20, 9),
        approverRole: "chantier_contributor",
        approverUsername: owner,
        approverUsernames: [owner],
        status: "rejected",
        decidedBy: owner,
        decidedByName: nameOf(owner),
        decidedAt: d(-19, 14),
        decisionComment: "Montant non justifié, à retravailler avec les achats.",
        reason: "Renfort prestataire logistique.",
        chain: [
          step("projectOwner", [owner], {
            by: owner,
            at: d(-19, 14),
            status: "rejected",
            comment: "Montant non justifié, à retravailler avec les achats.",
          }),
          step("chantierSponsor", [sponsor]),
        ],
        stepIndex: 0,
      });
      // Historique : budget approuvé en 2 paliers (cohérent avec le budget actuel du projet).
      if (budget !== undefined) {
        approvals.push({
          ...base,
          id: IDS.apprApprovedBudget,
          payload: {
            patch: { budget },
            before: { budget: Math.max(0, budget - 25000) },
            category: "pilotage",
          },
          requestedBy: contributor,
          requestedByName: nameOf(contributor),
          requestedAt: d(-45, 9),
          approverRole: "chantier_owner",
          approverUsername: sponsor,
          approverUsernames: [sponsor],
          status: "approved",
          decidedBy: sponsor,
          decidedByName: nameOf(sponsor),
          decidedAt: d(-42, 16),
          reason: "Ajustement du budget après appel d'offres.",
          chain: [
            step("projectOwner", [owner], { by: owner, at: d(-44, 10), status: "approved" }),
            step("chantierSponsor", [sponsor], { by: sponsor, at: d(-42, 16), status: "approved" }),
          ],
          stepIndex: 1,
        });
      }
    } else report.notes.push("Pas de contributeur projet : demandes du contributeur ignorées.");

    for (const a of approvals) setDoc(`strategicApprovals/${a.id}`, a);
  }

  // ── e) Staffing : une équipe > ~120 % de son disponible ───────────────────────────────────
  const available = fteByDepartment(snap.employees);
  const teams = Object.keys(available)
    .filter((t) => available[t] >= 1)
    .sort((a, b) => available[a] - available[b] || a.localeCompare(b));
  const team = teams.find((t) => /supply|logist|achat|approvision/i.test(norm(t))) ?? teams[0];
  if (!team) report.notes.push("Base ETP vide : e) ignoré (aucune équipe disponible).");
  else if (!supply) report.notes.push("e) ignoré : chantier Supply Chain introuvable.");
  else {
    const months = [monthBounds(today, 1), monthBounds(today, 2)];
    const existing = program(snap.staffing).filter(
      (e) => !isDemoId(e.id) && e.function === team && e.startDate
    );
    const extra = Math.max(
      ...months.map((m) => TARGET_STAFFING_RATE * available[team] - averageFte(existing, m))
    );
    if (extra <= 0) {
      report.notes.push(
        `Équipe « ${team} » déjà au-dessus de ${TARGET_STAFFING_RATE * 100} % : aucune ligne ajoutée.`
      );
    } else {
      const fte = Math.ceil((extra / 2) * 10) / 10;
      const other = chantiers.find((c) => c.id !== supply.id) ?? supply;
      const staffingOf = (id, chantierId, actionId, note) => {
        const current = docsByPath.get(`chantierStaffing/${id}`);
        return {
          id,
          companyId: COMPANY_ID,
          programId: PROGRAM_ID,
          chantierId,
          function: team,
          fte,
          note,
          startDate: months[0].start,
          endDate: months[1].end,
          actionId,
          createdAt: current?.createdAt ?? nowDate.toISOString(),
        };
      };
      setDoc(
        `chantierStaffing/${IDS.staffing1}`,
        staffingOf(
          IDS.staffing1,
          supply.id,
          sponsor ? IDS.projetUpcoming : undefined,
          "Pic de charge — plan de continuité (démo)"
        )
      );
      setDoc(
        `chantierStaffing/${IDS.staffing2}`,
        staffingOf(IDS.staffing2, other.id, undefined, "Pic de charge — renfort (démo)")
      );
      const rate = Math.round(
        ((averageFte(existing, months[0]) + 2 * fte) / available[team]) * 100
      );
      report.notes.push(
        `Staffing : équipe « ${team} » (disponible ${available[team]} ETP, base fiches employé) → ~${rate} % en ${months[0].start.slice(0, 7)} et ${months[1].start.slice(0, 7)} (2 × ${fte} ETP).`
      );
    }
  }

  // ── f) Confidentialité ─────────────────────────────────────────────────────────────────
  const currentLevels = snap.company?.confidentialityLevels ?? [];
  const levels = currentLevels.includes(CONFIDENTIAL_LEVEL)
    ? currentLevels
    : [...currentLevels, CONFIDENTIAL_LEVEL];
  if (snap.company) {
    setField(
      `companies/${snap.company.id ?? COMPANY_ID}`,
      "confidentialityLevels",
      levels,
      "niveau « Confidentiel »"
    );
  }
  if (talents) {
    setField(
      `strategicAxes/${talents.id}`,
      "confidentialityLevel",
      CONFIDENTIAL_LEVEL,
      "axe confidentiel"
    );
  }
  const strategicUsers = users.filter(
    (u) => !isAdmin(u) && STRATEGIC_ROLES.some((r) => hasProgramRole(u, r))
  );
  report.usersWithoutClearance = strategicUsers
    .filter((u) => !hasClearanceFor(u, CONFIDENTIAL_LEVEL, snap.company, levels))
    .map((u) => u.username)
    .sort();

  // ── g) Comptes de démo manquants ───────────────────────────────────────────────────────
  const need = [
    ["strategic_lead", "Pilote du plan stratégique", () => pilots.length > 0],
    ["axis_sponsor", "Sponsor d'axe", () => users.some((u) => hasProgramRole(u, "axis_sponsor"))],
    ["chantier_owner", "Sponsor de chantier", () => !!sponsor],
    ["chantier_contributor", "Responsable projet", () => !!owner],
    ["projet_contributor", "Contributeur projet", () => !!contributor],
    [
      "no_clearance",
      "Utilisateur sans habilitation « Confidentiel »",
      () => report.usersWithoutClearance.length > 0,
    ],
    ["company_admin", "Admin d'entreprise", () => users.some((u) => u.isCompanyAdmin)],
  ];
  for (const [role, label, ok] of need) {
    if (ok()) continue;
    report.missingAccounts.push({
      role,
      label,
      action:
        role === "company_admin"
          ? "Admin › Utilisateurs : créer un compte Acme avec l'habilitation « Admin d'entreprise »."
          : role === "no_clearance"
            ? `Admin › Utilisateurs : créer (ou régler) un compte à profil stratégique sur « Excellence Opérationnelle 2026-2028 » avec une habilitation inférieure à « ${CONFIDENTIAL_LEVEL} ».`
            : `Admin › Utilisateurs : créer un compte Acme avec le profil « ${label} » sur le programme « Excellence Opérationnelle 2026-2028 »` +
              (role === "chantier_owner"
                ? ", puis le désigner sponsor du chantier Supply Chain."
                : "."),
    });
  }

  // ── Assemblage (sauvegarde d'abord : un apply interrompu reste nettoyable) ───────────────
  if (backupChanged) {
    writes.push({
      op: "set",
      path: BACKUP_PATH,
      data: {
        companyId: COMPANY_ID,
        programId: PROGRAM_ID,
        createdAt: snap.backup?.createdAt ?? nowDate.toISOString(),
        entries: backupEntries,
      },
    });
  }
  for (const [path, data] of pendingUpdates) writes.push({ op: "update", path, data });
  writes.push(...setWrites);
  return { writes, report };
}

/** Nettoyage : supprime les documents `demo-video-*` et restaure les champs sauvegardés. */
function planDemoStratVideoCleanup(snapshot) {
  const snap = { chantierActions: [], approvals: [], staffing: [], ...snapshot };
  const writes = [];
  const notes = [];
  const collections = [
    ["chantierActions", snap.chantierActions],
    ["strategicApprovals", snap.approvals],
    ["chantierStaffing", snap.staffing],
  ];
  for (const [collection, list] of collections) {
    for (const d of list)
      if (isDemoId(d.id)) writes.push({ op: "delete", path: `${collection}/${d.id}` });
  }
  const restore = new Map();
  for (const e of snap.backup?.entries ?? []) {
    const data = restore.get(e.path) ?? {};
    data[e.field] = e.existed ? e.value : DELETE_FIELD;
    restore.set(e.path, data);
  }
  for (const [path, data] of restore) {
    if (isDemoId(path.split("/")[1])) continue; // document démo déjà supprimé
    writes.push({ op: "update", path, data });
  }
  if (snap.backup) writes.push({ op: "delete", path: BACKUP_PATH });
  else
    notes.push(
      "Aucune sauvegarde demo-video-backup : seuls les documents demo-video-* sont supprimés."
    );
  return { writes, report: { notes } };
}

const SNAPSHOT_KEYS = {
  strategicAxes: "axes",
  chantiers: "chantiers",
  chantierActions: "chantierActions",
  indicators: "indicators",
  chantierStaffing: "staffing",
  strategicApprovals: "approvals",
};

/** Applique `writes` à une copie du snapshot (tests d'idempotence / aperçu). */
function applyWritesToSnapshot(snapshot, writes) {
  const next = JSON.parse(JSON.stringify(snapshot));
  for (const w of writes) {
    const [collection, id] = w.path.split("/");
    if (w.path === BACKUP_PATH) {
      next.backup = w.op === "delete" ? null : JSON.parse(JSON.stringify(w.data));
      continue;
    }
    const apply = (doc) => {
      if (w.op === "set") return JSON.parse(JSON.stringify(w.data));
      const out = { ...doc };
      for (const [k, v] of Object.entries(w.data)) {
        if (v === DELETE_FIELD) delete out[k];
        else out[k] = JSON.parse(JSON.stringify(v));
      }
      return out;
    };
    if (collection === "companies") {
      if (next.company) next.company = apply(next.company);
      continue;
    }
    const key = SNAPSHOT_KEYS[collection];
    if (!key) continue;
    const list = next[key] ?? [];
    const idx = list.findIndex((d) => d.id === id);
    if (w.op === "delete") {
      if (idx >= 0) list.splice(idx, 1);
    } else if (idx >= 0) list[idx] = apply(list[idx]);
    else if (w.op === "set") list.push(apply({}));
    next[key] = list;
  }
  return next;
}

module.exports = {
  PROGRAM_ID,
  COMPANY_ID,
  PREFIX,
  BACKUP_PATH,
  CONFIDENTIAL_LEVEL,
  DELETE_FIELD,
  IDS,
  planDemoStratVideo,
  planDemoStratVideoCleanup,
  applyWritesToSnapshot,
};
