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
 * Tournage à TROIS connexions seulement (options, voir `DEFAULT_CAST`) :
 *  - `cto` (test.cto, cto + strategic_lead) : pilote du plan ;
 *  - `sponsor` (thomas.petit) : sponsor (`Chantier.pilote`) du chantier « Optimisation Supply
 *    Chain » — valide la demande principale (palier 2/2), saisit le NPS, Mon espace ;
 *  - `restrictedUser` (comex.test, membre du COMEX : voit tout le plan sans restriction de périmètre) : reçoit une surcharge individuelle d'habilitation SOUS
 *    « Confidentiel » → ne voit pas l'axe « Talents & Organisation ».
 * Deux comptes « figurants » JAMAIS connectés (`projectOwner`, `contributor`) portent la chaîne
 * responsable projet → sponsor de chantier : ils reçoivent (réversiblement) le profil
 * `chantier_contributor` / `projet_contributor` sur le programme et sont responsable /
 * contributeur d'un projet DÉMO du chantier (aucun projet réel n'est modifié).
 *
 * Principes :
 *  - ids déterministes préfixés `demo-video-` pour tout document CRÉÉ (projets, demandes de
 *    validation, lignes de staffing) → le nettoyage les supprime par préfixe ;
 *  - tout champ d'un document EXISTANT modifié (responsable de saisie du KPI NPS, niveaux de
 *    confidentialité de l'entreprise, niveau de l'axe Talents, `profiles` /
 *    `confidentialityClearance` d'un `adminUsers`, sponsor du chantier si différent) voit sa valeur
 *    d'origine sauvegardée dans `demoData/demo-video-backup` (une seule fois : une relance ne
 *    l'écrase jamais) → le nettoyage la restaure (champ absent à l'origine → supprimé) ;
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

/** Distribution par défaut (surchargée par les options CLI --sponsor, --restricted-user,
 *  --project-owner, --contributor). */
const DEFAULT_CAST = {
  cto: "test.cto",
  sponsor: "thomas.petit",
  restrictedUser: "comex.test",
  projectOwner: "pierre.lefevre",
  contributor: "nadia.klein",
};
/** Ids de rôle de l'app (types/index.ts STRATEGIC_ROLES) des deux figurants. */
const PROJECT_OWNER_ROLE = "chantier_contributor";
const CONTRIBUTOR_ROLE = "projet_contributor";

const IDS = {
  projetLate: `${PREFIX}projet-revue-fournisseurs`,
  projetUpcoming: `${PREFIX}projet-continuite-transport`,
  projetApprovals: `${PREFIX}projet-transport-express`,
  apprSponsorMine: `${PREFIX}appr-sponsor-enveloppe`,
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

/**
 * @param {DemoSnapshot} snapshot
 * @param {{ now?: string, cto?: string, sponsor?: string, restrictedUser?: string,
 *           projectOwner?: string, contributor?: string }} [options]
 */
function planDemoStratVideo(snapshot, options = {}) {
  const { now, ...castOptions } = options;
  const cast = { ...DEFAULT_CAST, ...stripUndefined(castOptions) };
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
    accounts: [],
    missingAccounts: [],
    notes: [],
    usersWithoutClearance: [],
    cast: {},
  };
  const backupEntries = [...(snap.backup?.entries ?? [])];
  let backupChanged = false;

  if (!snap.program) report.notes.push(`Programme ${PROGRAM_ID} introuvable.`);
  if (!snap.company) report.notes.push(`Entreprise ${COMPANY_ID} introuvable.`);

  const allUserByName = new Map(snap.users.map((u) => [u.username, u]));
  const users = snap.users.filter(isActive);
  const userByName = new Map(users.map((u) => [u.username, u]));
  const nameOf = (username) => displayName(userByName.get(username)) ?? username;
  const userPath = (u) => `adminUsers/${u.docId ?? `${u.username}.${COMPANY_ID}`}`;
  const docsByPath = new Map();
  const index = (collection, list) =>
    list.forEach((d) => docsByPath.set(`${collection}/${d.id}`, d));
  index("strategicAxes", snap.axes);
  index("chantiers", snap.chantiers);
  index("chantierActions", snap.chantierActions);
  index("indicators", snap.indicators);
  index("chantierStaffing", snap.staffing);
  index("strategicApprovals", snap.approvals);
  snap.users.forEach((u) => docsByPath.set(userPath(u), u));
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
  /** Utilisateur tel qu'il sera APRÈS application (mises à jour en attente fusionnées). */
  const effectiveUser = (u) => (u ? { ...u, ...(pendingUpdates.get(userPath(u)) ?? {}) } : u);
  /** Crée/remplace un document démo (écrit seulement s'il diffère de l'existant). */
  const setWrites = [];
  function setDoc(path, data) {
    const clean = stripUndefined(data);
    if (deepEqual(docsByPath.get(path), clean)) return;
    setWrites.push({ op: "set", path, data: clean });
  }

  // ── Repères du plan ──────────────────────────────────────────────────────────────────────
  const program = (list) => list.filter((x) => !x.programId || x.programId === PROGRAM_ID);
  const axes = program(snap.axes);
  const chantiers = program(snap.chantiers).sort((a, b) => a.id.localeCompare(b.id));
  const realActions = snap.chantierActions.filter((a) => !isDemoId(a.id));
  const supply =
    chantiers.find((c) => norm(c.name).includes("optimisation supply chain")) ??
    chantiers.find((c) => norm(c.name).includes("supply chain"));
  const talents = axes.find((a) => norm(a.name).includes("talents"));
  if (!supply)
    report.notes.push("Chantier « Optimisation Supply Chain » introuvable : b), c), d) ignorés.");
  if (!talents) report.notes.push("Axe « Talents & Organisation » introuvable : f) partiel.");
  const axisOfSupply = supply ? axes.find((a) => a.id === (supply.axisIds ?? [])[0]) : undefined;

  const pilots = users
    .filter((u) => hasProgramRole(u, "strategic_lead"))
    .map((u) => u.username)
    .sort();
  const isPilotLike = (username) => {
    const u = userByName.get(username);
    return !!u && (hasProgramRole(u, "strategic_lead") || hasProgramRole(u, "cto"));
  };
  const talentsChantierIds = new Set(
    chantiers.filter((c) => talents && (c.axisIds ?? []).includes(talents.id)).map((c) => c.id)
  );
  const isMember = (a, username) =>
    a.owner === username || (a.contributors ?? []).includes(username);
  /** Position nommée sur l'axe Talents (sponsor d'axe, sponsor/projet d'un de ses chantiers). */
  const inTalents = (username) =>
    !!talents &&
    (talents.owner === username ||
      chantiers.some((c) => talentsChantierIds.has(c.id) && c.pilote === username) ||
      realActions.some((a) => talentsChantierIds.has(a.chantierId) && isMember(a, username)));
  /** Détient une position nommée RÉELLE quelque part dans le programme. */
  const holdsPosition = (username) =>
    axes.some((a) => a.owner === username) ||
    chantiers.some((c) => c.pilote === username) ||
    realActions.some((a) => isMember(a, username));

  // ── Distribution : 3 comptes filmés ─────────────────────────────────────────────────────
  const ctoUser = userByName.get(cast.cto);
  const sponsor = userByName.has(cast.sponsor) ? cast.sponsor : undefined;
  if (supply && sponsor && sponsor !== supply.pilote) {
    setField(`chantiers/${supply.id}`, "pilote", sponsor, "sponsor de chantier filmé (--sponsor)");
  }
  const restrictedUser = userByName.get(cast.restrictedUser);

  // ── Figurants (jamais connectés) : responsable projet + contributeur ──────────────────────
  const isStrategicTrackForProgram = (p) =>
    STRATEGIC_ROLES.includes(p.role) && (!p.programId || p.programId === PROGRAM_ID);
  /** Profils VOULUS d'un figurant : exactement UN profil stratégique sur le programme (règle
   *  lib/roleProfiles.ts::assertValidProfiles — un seul profil par (piste, programme), un profil
   *  « tous programmes » non combinable) ; profils des autres pistes/programmes conservés. */
  const desiredProfiles = (u, role) => {
    const profiles = u.profiles ?? [];
    const strategic = profiles.filter(isStrategicTrackForProgram);
    if (
      strategic.length === 1 &&
      strategic[0].role === role &&
      strategic[0].programId === PROGRAM_ID
    )
      return profiles;
    return [
      ...profiles.filter((p) => !isStrategicTrackForProgram(p)),
      { role, programId: PROGRAM_ID },
    ];
  };
  const filmed = [cast.cto, cast.sponsor, cast.restrictedUser];
  const ineligibility = (username, exclude) => {
    const u = userByName.get(username);
    if (!u) return allUserByName.has(username) ? "compte désactivé" : "compte inexistant";
    if (filmed.includes(username)) return "compte filmé";
    if (exclude.includes(username)) return "déjà distribué";
    if (isAdmin(u)) return "administrateur (applique directement, sans validation)";
    if (isPilotLike(username)) return "pilote du plan / CTO";
    if (axisOfSupply?.owner === username) return "sponsor de l'axe du chantier Supply Chain";
    if (inTalents(username)) return "impliqué dans l'axe « Talents & Organisation »";
    return null;
  };
  /** Profil stratégique existant sur le programme qu'il faudrait remplacer (0/1). */
  const profileConflict = (u, role) =>
    (u.profiles ?? []).some(
      (p) => isStrategicTrackForProgram(p) && !(p.role === role && p.programId === PROGRAM_ID)
    )
      ? 1
      : 0;
  function pickHelper(key, requested, role, exclude) {
    const why = ineligibility(requested, exclude);
    if (!why) return requested;
    const candidate = users
      .filter((u) => !ineligibility(u.username, exclude))
      .sort(
        (a, b) =>
          profileConflict(a, role) - profileConflict(b, role) ||
          Number(holdsPosition(a.username)) - Number(holdsPosition(b.username)) ||
          a.username.localeCompare(b.username)
      )[0]?.username;
    report.notes.push(
      `${key} : « ${requested} » écarté (${why})` +
        (candidate
          ? ` → « ${candidate} » retenu automatiquement.`
          : " → aucun remplaçant éligible.")
    );
    return candidate;
  }
  const baseExclude = [axisOfSupply?.owner].filter(Boolean);
  const owner = pickHelper("--project-owner", cast.projectOwner, PROJECT_OWNER_ROLE, baseExclude);
  const contributor = pickHelper("--contributor", cast.contributor, CONTRIBUTOR_ROLE, [
    ...baseExclude,
    owner,
  ]);
  for (const [username, role, label] of [
    [owner, PROJECT_OWNER_ROLE, "responsable projet"],
    [contributor, CONTRIBUTOR_ROLE, "contributeur projet"],
  ]) {
    const u = userByName.get(username);
    if (!u) continue;
    const profiles = desiredProfiles(u, role);
    const replaced = (u.profiles ?? []).filter(
      (p) => isStrategicTrackForProgram(p) && !profiles.includes(p)
    );
    setField(
      userPath(u),
      "profiles",
      profiles,
      `figurant ${label}` +
        (replaced.length
          ? ` — remplace temporairement ${replaced.map((p) => p.role).join(", ")}`
          : "")
    );
  }

  // Projet DÉMO porteur de la chaîne responsable projet → sponsor (aucun projet réel modifié).
  const p1 =
    supply && sponsor && owner && contributor
      ? {
          id: IDS.projetApprovals,
          companyId: COMPANY_ID,
          chantierId: supply.id,
          name: "Fiabilisation du transport express",
          description: "Sécurisation des délais transport express entre entrepôts (démo).",
          owner,
          contributors: [contributor],
          start: addDays(today, -60),
          end: addDays(today, 45),
          status: "in_progress",
          budget: 150000,
          milestones: { currentMilestone: "E2", passedMilestones: ["E0", "E1"], checklists: {} },
        }
      : undefined;
  if (supply && !p1)
    report.notes.push("Sponsor / figurants incomplets : projet démo et demandes c) ignorés.");
  if (p1) setDoc(`chantierActions/${p1.id}`, p1);

  report.cast = stripUndefined({
    cto: cast.cto,
    pilots,
    axisSponsor: axisOfSupply?.owner,
    chantierSponsor: sponsor,
    restrictedUser: cast.restrictedUser,
    projectOwner: owner,
    projectContributor: contributor,
    chantierId: supply?.id,
    projetId: p1?.id,
  });

  // ── a) KPI NPS : responsable de saisie = sponsor filmé ─────────────────────────────────
  const nps = program(snap.indicators).find((i) => /\bnps\b/i.test(norm(i.name)));
  if (!nps) report.notes.push("KPI « NPS » introuvable : a) ignoré.");
  else if (!sponsor) report.notes.push("NPS : sponsor filmé introuvable, a) ignoré.");
  else {
    setField(
      `indicators/${nps.id}`,
      "additionalAuthorizedUserIds",
      [sponsor],
      "responsable de saisie du NPS = sponsor filmé"
    );
    // Aperçu de chaîne attendu (lib/kpiCorrectionRouting.ts : KPI d'axe, auteur hors hiérarchie
    // → plancher « sponsor de chantier » → sponsor d'axe puis pilote).
    const npsAxis = axes.find((a) => a.id === nps.axisId);
    const axisStep = npsAxis?.owner && npsAxis.owner !== sponsor ? [npsAxis.owner] : [];
    const pilotStep = pilots.filter((u) => u !== sponsor && !axisStep.includes(u));
    if (nps.chantierId)
      report.notes.push(
        "NPS : KPI de chantier (pas d'axe) — la chaîne ne sera pas « Sponsor d'axe puis Pilote »."
      );
    else if (!axisStep.length || !pilotStep.length)
      report.notes.push(
        `NPS : chaîne incomplète (sponsor d'axe ${axisStep[0] ?? "absent"}, pilote(s) ${pilotStep.join(", ") || "absent"}).`
      );
    else
      report.notes.push(
        `NPS : saisie de ${sponsor} → « Sera validée par Sponsor d'axe (${axisStep[0]}) puis Pilote du plan stratégique (${pilotStep.join(", ")}) ».`
      );
    const kept = (snap.measurements ?? []).filter((m) => m.indicatorId === nps.id).length;
    report.notes.push(`NPS : historique conservé (${kept} mesure(s), aucune n'est modifiée).`);
  }

  // ── b) + d) Projets démo (chronologie, dépendance FS, Mon espace du sponsor) ─────────────
  if (supply && sponsor) {
    const status = "in_progress";
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
  if (p1) {
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
    const budget = p1.budget;
    const d = (n, h) => isoAt(addDays(today, n), h);
    const approvals = [];

    // A2 — phone : échéance (planning, 1 validation) demandée par le responsable projet.
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
    // A1 — scène principale : contributeur → responsable projet (validé) → sponsor (en attente).
    approvals.push({
      ...base,
      id: IDS.apprContribPending,
      payload: {
        patch: { budget: budget + 40000 },
        before: { budget },
        category: "pilotage",
      },
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
    // Historique : budget refusé par le sponsor au palier 2/2 (visible dans son historique).
    approvals.push({
      ...base,
      id: IDS.apprRejectedBudget,
      payload: {
        patch: { budget: budget + 120000 },
        before: { budget },
        category: "pilotage",
      },
      requestedBy: contributor,
      requestedByName: nameOf(contributor),
      requestedAt: d(-20, 9),
      approverRole: "chantier_owner",
      approverUsername: sponsor,
      approverUsernames: [sponsor],
      status: "rejected",
      decidedBy: sponsor,
      decidedByName: nameOf(sponsor),
      decidedAt: d(-18, 14),
      decisionComment: "Montant non justifié, à retravailler avec les achats.",
      reason: "Renfort prestataire logistique.",
      chain: [
        step("projectOwner", [owner], { by: owner, at: d(-19, 10), status: "approved" }),
        step("chantierSponsor", [sponsor], {
          by: sponsor,
          at: d(-18, 14),
          status: "rejected",
          comment: "Montant non justifié, à retravailler avec les achats.",
        }),
      ],
      stepIndex: 1,
    });
    // Historique : budget approuvé en 2 paliers (cohérent avec le budget actuel du projet).
    approvals.push({
      ...base,
      id: IDS.apprApprovedBudget,
      payload: {
        patch: { budget },
        before: { budget: budget - 25000 },
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
    // « Mes demandes » du sponsor : enveloppe du chantier (pilotage, 2 paliers) approuvée.
    const axisOwner = axisOfSupply?.owner;
    const pilotStep = pilots.filter((u) => u !== sponsor && u !== axisOwner);
    const envelope = supply.allocatedBudget;
    if (typeof envelope !== "number")
      report.notes.push(
        "Chantier Supply Chain sans enveloppe (allocatedBudget) : demande « Mes demandes » du sponsor ignorée."
      );
    else if (!axisOwner || axisOwner === sponsor || !pilotStep.length)
      report.notes.push(
        "Sponsor d'axe ou pilote manquant : demande « Mes demandes » du sponsor ignorée."
      );
    else {
      const decider = pilotStep.includes(cast.cto) ? cast.cto : pilotStep[0];
      approvals.push({
        companyId: COMPANY_ID,
        programId: PROGRAM_ID,
        kind: "chantier_update",
        targetType: "chantier",
        targetId: supply.id,
        targetName: supply.name,
        id: IDS.apprSponsorMine,
        payload: {
          patch: { allocatedBudget: envelope },
          before: { allocatedBudget: Math.max(0, envelope - 50000) },
          category: "pilotage",
        },
        requestedBy: sponsor,
        requestedByName: nameOf(sponsor),
        requestedAt: d(-26, 9),
        approverRole: "strategic_lead",
        approverUsername: pilotStep[0],
        approverUsernames: pilotStep,
        status: "approved",
        decidedBy: decider,
        decidedByName: nameOf(decider),
        decidedAt: d(-23, 17),
        reason: "Renfort de l'enveloppe pour la sécurisation transport.",
        chain: [
          step("axisSponsor", [axisOwner], { by: axisOwner, at: d(-25, 11), status: "approved" }),
          step("pilot", pilotStep, { by: decider, at: d(-23, 17), status: "approved" }),
        ],
        stepIndex: 1,
      });
    }

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
  // Le pilote filmé doit voir l'axe confidentiel (surcharge seulement s'il ne le voit pas déjà).
  if (
    ctoUser &&
    !hasClearanceFor(effectiveUser(ctoUser), CONFIDENTIAL_LEVEL, snap.company, levels)
  ) {
    setField(
      userPath(ctoUser),
      "confidentialityClearance",
      CONFIDENTIAL_LEVEL,
      "le pilote filmé doit voir l'axe confidentiel"
    );
  }
  // Compte restreint : surcharge individuelle (champ de « Surcharges individuelles ») au niveau
  // juste SOUS « Confidentiel » (aucun niveau inférieur → « Aucun accès » = []).
  const confIdx = levels.indexOf(CONFIDENTIAL_LEVEL);
  const restrictedLevel = confIdx > 0 ? levels[confIdx - 1] : [];
  if (restrictedUser) {
    if (isAdmin(restrictedUser))
      report.notes.push(
        `Compte restreint « ${restrictedUser.username} » administrateur : il voit tout, choisir un autre --restricted-user.`
      );
    setField(
      userPath(restrictedUser),
      "confidentialityClearance",
      restrictedLevel,
      "compte restreint : habilitation sous « Confidentiel »"
    );
    const eff = effectiveUser(restrictedUser);
    const hiddenElsewhere = [
      ...axes.filter((a) => a.id !== talents?.id && a.confidentialityLevel),
      ...chantiers.filter((c) => !talentsChantierIds.has(c.id) && c.confidentialityLevel),
    ].filter((x) => !hasClearanceFor(eff, x.confidentialityLevel, snap.company, levels));
    if (hiddenElsewhere.length)
      report.notes.push(
        `Attention : le compte restreint ne verra pas non plus ${hiddenElsewhere.map((x) => x.name).join(", ")}.`
      );
    if (inTalents(restrictedUser.username))
      report.notes.push(
        `Attention : « ${restrictedUser.username} » a une position sur l'axe Talents & Organisation — il la perdra de vue.`
      );
  }
  const strategicUsers = users
    .map(effectiveUser)
    .filter((u) => !isAdmin(u) && STRATEGIC_ROLES.some((r) => hasProgramRole(u, r)));
  report.usersWithoutClearance = strategicUsers
    .filter((u) => !hasClearanceFor(u, CONFIDENTIAL_LEVEL, snap.company, levels))
    .map((u) => u.username)
    .sort();

  // ── g) Comptes : seulement les 3 comptes filmés + les 2 figurants ──────────────────────────
  const account = (key, label, requested, used, filmedAccount, check) => {
    const username = used ?? requested;
    const u = allUserByName.get(username);
    let status = "ok";
    if (!u) status = "absent";
    else if (!isActive(u)) status = "désactivé";
    else if (check) status = check(u) ?? "ok";
    return stripUndefined({
      key,
      label,
      username,
      requested: used && used !== requested ? requested : undefined,
      filmed: filmedAccount,
      status,
    });
  };
  report.accounts = [
    account("cto", "Pilote du plan stratégique (filmé)", cast.cto, undefined, true, (u) =>
      hasProgramRole(u, "strategic_lead") ? null : "profil strategic_lead manquant"
    ),
    account("sponsor", "Sponsor du chantier Supply Chain (filmé)", cast.sponsor, undefined, true),
    account(
      "restrictedUser",
      "Compte restreint — confidentialité (filmé)",
      cast.restrictedUser,
      undefined,
      true,
      (u) => (isAdmin(u) ? "administrateur (voit tout)" : null)
    ),
    account("projectOwner", "Responsable projet (figurant)", cast.projectOwner, owner, false),
    account("contributor", "Contributeur projet (figurant)", cast.contributor, contributor, false),
  ];
  report.missingAccounts = report.accounts
    .filter((a) => a.status !== "ok")
    .map((a) => ({
      ...a,
      action: a.filmed
        ? `Admin › Utilisateurs : vérifier le compte « ${a.username} » (${a.status}).`
        : `Aucun figurant éligible : passer --${a.key === "projectOwner" ? "project-owner" : "contributor"} <identifiant d'un compte existant>.`,
    }));

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
    if (collection === "adminUsers") {
      next.users = (next.users ?? []).map((u) =>
        (u.docId ?? `${u.username}.${COMPANY_ID}`) === id && w.op === "update" ? apply(u) : u
      );
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
  DEFAULT_CAST,
  PROJECT_OWNER_ROLE,
  CONTRIBUTOR_ROLE,
  IDS,
  planDemoStratVideo,
  planDemoStratVideoCleanup,
  applyWritesToSnapshot,
};
