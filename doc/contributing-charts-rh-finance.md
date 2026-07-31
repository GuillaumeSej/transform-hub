# Brief pour les contributeurs — graphiques RH & Finance

À coller en tête de session (Claude Code ou autre) avant de démarrer un ticket graphique sur les
modules RH ou Finance. But : éviter un graphique qui a l'air juste mais qui recalcule ses propres
chiffres en local au lieu de s'appuyer sur le modèle de données et les moteurs de calcul déjà en
place — ce qui le désynchronise silencieusement du reste de l'app (export Excel, autres widgets,
filtres) dès que les données évoluent.

---

## Prompt à coller

```
Avant d'écrire le moindre JSX de graphique, réponds à ces questions avec des chemins de fichiers
précis — si tu ne peux pas répondre, cherche la fonction qui existe déjà avant d'en écrire une
nouvelle :

1. D'où viennent mes données ? Elles doivent transiter par useBeTrackData(companyId)
   (lib/hooks/useStorage.ts) — jamais un accès Firestore direct dans un composant, jamais de
   données mockées en dur dans le composant. Si la donnée n'existe pas encore dans BeTrackData,
   c'est le hook ou le modèle (types/index.ts) qu'il faut étendre, pas le composant qui doit
   contourner.

2. Le calcul affiché existe-t-il déjà dans un module lib/ ? Les agrégations RH/Finance vivent dans
   lib/hrFinancials.ts, lib/hrEngine.ts, lib/hrDashboardPivot.ts, lib/hrDashboardWidgets.ts,
   lib/dashboardPivot.ts, lib/dashboardWidgets.ts, lib/engine.ts — jamais une somme/moyenne/filtre
   recalculé inline dans le composant React. Si le calcul n'existe pas, ajoute-le dans le module lib/
   concerné (avec un test dans lib/__tests__/), puis appelle-le depuis le composant. Un composant
   ne doit contenir aucune logique métier, seulement de l'affichage.

3. Mon graphique a-t-il une dimension de répartition (géographie, compte P&L, département,
   workstream...) ? Si oui, elle doit être résolue dynamiquement depuis l'arborescence configurée
   par l'entreprise (HierarchyLevelDef / HierarchyNode, lib/hierarchyLogic.ts
   resolveHierarchyPath), pas une liste de catégories figée en dur dans le composant — sinon le
   graphique casse ou ment dès qu'un client a une arborescence différente de la démo. Regarde
   lib/dashboardPivot.ts (getAvailableDimensions) et app/(app)/levers/page.tsx (hierarchyColumns,
   hierarchyFilterDefs) comme référence du pattern attendu.

4. Mon graphique a-t-il des filtres ? Réutilise FilterBar / ActiveFilters
   (components/shared/FilterBar.tsx) avec un tableau de FilterDef construit dynamiquement — pas un
   useState local de filtres qui n'existe que dans ce composant et se désynchronise du reste de la
   page.

5. Mon graphique affiche-t-il un risque ou une alerte ? Passe par engine.computeLeverRisk et
   alertEngine.generateAlerts — jamais un recalcul de seuils en local. Si le risque doit intégrer
   un nouveau facteur, c'est dans lib/alertEngine.ts qu'il s'ajoute (voir les alertes AUTO-DELAY /
   AUTO-COST existantes comme modèle), pas dans le composant graphique.

6. Est-ce que la donnée est multi-tenant ? Vérifie que ce que je lis est bien scopé par companyId
   de bout en bout. Le RH (Employee/WorkforceMovement) est un gap connu et documenté (pas encore
   filtré par entreprise, partagé entre toutes les démos) — si mon graphique RH révèle ou aggrave
   ce problème, je le signale explicitement dans ma PR au lieu de le contourner en silence par un
   filtre client-side bricolé.

7. Ai-je un test ? Toute nouvelle fonction dans lib/ a un test dans lib/__tests__/ correspondant
   (vitest). Un graphique sans logique testable derrière (juste un mapping data -> SVG/Recharts)
   n'a pas besoin de test dédié, mais la fonction de calcul qui l'alimente en a besoin.

Objectif : je dois pouvoir supprimer entièrement le composant graphique et retrouver le même
résultat en appelant la fonction lib/ correspondante depuis un export Excel ou un autre widget —
si ce n'est pas le cas, la logique n'est pas au bon endroit.
```

---

## Pourquoi ce niveau d'exigence

Le modèle de données (arborescences configurables, filtres dynamiques par niveau, risque calculé
automatiquement depuis les alertes, multi-tenance par `companyId`) a été conçu pour que
l'affichage soit une conséquence directe des données, jamais une source de vérité parallèle. Un
graphique qui recalcule ses propres chiffres :

- se désynchronise du reste de l'app (export Excel, autres widgets) dès que la donnée évolue ;
- casse silencieusement pour un client dont l'arborescence a plus/moins de niveaux que la démo
  (voir la refonte des filtres dynamiques P&L/géographie, [doc/demo-script.md](demo-script.md)) ;
- réintroduit des hypothèses figées (statuts, catégories, seuils) que le modèle a justement
  rendues configurables par entreprise.
