# Plan d’Audit Complet et de Correction — MONARQ ÉCONOMAT

Ce plan détaille l’ensemble des anomalies identifiées lors de l’audit intégral du code source (navigation, formulaires, moteur de stock, import/export Excel, permissions RBAC et adaptateurs de données) ainsi que les correctifs précis qui seront appliqués.

---

## 1. Navigation, Redirections et Synchronisation des Paramètres URL

### Constats de l’audit
1. **Navigation depuis le Tableau de bord (`src/features/dashboard/index.tsx`)** :
   - La fonction `navigateToFilteredUrl` utilise actuellement `window.history.pushState` + `PopStateEvent` au lieu du routeur TanStack Router (`useNavigate`). Cliquer sur une carte KPI ou une action prioritaire ne déclenche pas systématiquement la transition de route TanStack Router vers la page cible avec ses filtres URL.
2. **Bouton « Saisie rapide » dans l’en-tête (`src/components/profile-dropdown.tsx`) et palette de commandes (`src/components/command-menu.tsx`)** :
   - Lorsqu’un utilisateur clique sur *Saisie rapide → Nouvelle entrée* ou *Nouvelle sortie* alors qu’il se trouve déjà sur `/entrees-de-stock` ou `/sorties-de-stock`, le composant ne bascule pas en mode création (`viewMode = 'new'`) car l’événement personnalisé `'monarq:navigate'` n’est pas émis ni écouté sur ces pages.
   - Dans `CommandMenu`, la sélection d’une facture redirige vers `/factures-paiements` sans filtrer sur le numéro de facture sélectionné.
3. **Prise en compte des filtres URL sur les pages cibles** :
   - `src/features/factures-paiements/index.tsx` n’initialise pas ses filtres (`statusFilter`, `supplierFilter`, `search`, `dateFrom`, `dateTo`) depuis les paramètres URL (`?status=unpaid`, `?q=...`, `?from=...`, `?to=...`) envoyés par le Tableau de bord ou la recherche globale (`⌘K`).
   - `src/features/pertes-gaspillage/index.tsx` n’initialise pas `dateFrom` et `dateTo` depuis `?from=...&to=...` lorsqu’on clique sur la carte KPI *Valeur des pertes* du Tableau de bord.
   - `src/features/inventaires/index.tsx` n’ouvre pas directement le détail d’une session lorsqu’on clique sur un mouvement d’inventaire (`?doc=<sessionId>`) depuis le flux *Activité récente* du Tableau de bord.
   - `src/features/etat-des-stocks/index.tsx` n’écoute pas les événements `popstate` / `monarq:navigate` pour mettre à jour ses filtres (`status`, `category`, `priceMissing`, `missingMin`) lors d’une navigation interne.
4. **Redirections de déconnexion et d’expiration de session (`src/components/sign-out-dialog.tsx` & `src/main.tsx`)** :
   - Passent encore `location.href` (qui inclut les paramètres de requête comme `?range=this_month`) au lieu de `location.pathname` dans le paramètre `redirect` de `/sign-in`.

### Correctifs prévus
- Remplacer `navigateToFilteredUrl` dans `src/features/dashboard/index.tsx` par une navigation TanStack Router propre couplée à la synchronisation des paramètres URL et à l’émission de `'monarq:navigate'`.
- Mettre à jour `src/components/profile-dropdown.tsx` et `src/components/command-menu.tsx` pour transmettre proprement les paramètres (`?mode=new`, `?q=<invoice_no>`, `?productId=...`, `?supplierId=...`) et émettre `'monarq:navigate'`.
- Synchroniser les filtres URL à l’initialisation et sur événement `'monarq:navigate'` / `'popstate'` dans :
  - `src/features/factures-paiements/index.tsx` (`status`, `supplier`, `q`, `from`, `to`)
  - `src/features/pertes-gaspillage/index.tsx` (`from`, `to`)
  - `src/features/inventaires/index.tsx` (`doc` pour ouvrir la session correspondante en mode détail ou comptage)
  - `src/features/etat-des-stocks/index.tsx`, `src/features/entrees-de-stock/index.tsx` et `src/features/sorties-de-stock/index.tsx`.
- Utiliser `location.pathname` dans `src/components/sign-out-dialog.tsx` et `src/main.tsx`.

---

## 2. Permissions RBAC, Visibilité des Prix et Appels Réseau par Rôle

### Constats de l’audit
1. **Appels `Promise.all` non protégés par rôle dans plusieurs pages et dans l’adaptateur PocketBase** :
   - Dans PocketBase (`pb_migrations/1700000001_init_monarq_schema.js`), `users` est restreint à `admin`, `suppliers`/`purchases`/`purchase_lines` sont interdits à `cuisine`, et `audit_log` est interdit à `economat` et `cuisine`.
   - Or, `src/features/pertes-gaspillage/index.tsx` (accessible au rôle `cuisine`) appelle inconditionnellement `repository.listSuppliers()`, `repository.listPurchases()` et `repository.listUsers()` dans `Promise.all`.
   - De même, `src/features/factures-paiements/index.tsx`, `src/features/historique-mouvements/index.tsx` et `src/features/rapports/index.tsx` appellent `repository.listUsers()` (et `listAuditLogs()` pour `historique-mouvements`) sans vérifier `canPerformCollectionAction(role, ...)`.
   - Dans `src/data/pocketbase-adapter.ts` (`getDashboardAnalytics`), `this.listSuppliers()` est appelé même lorsque `effectiveRole === 'cuisine'`.
2. **Cohérence de visibilité financière (`cuisine`) et mode lecture seule (`consultation`)** :
   - Vérifier que chaque écran accessible à `cuisine` (`/`, `/produits`, `/etat-des-stocks`, `/sorties-de-stock`, `/pertes-gaspillage`) masque 100 % des prix, coûts unitaires, montants MAD et fournisseurs, et fonctionne sans jamais requêter `purchases` ni `suppliers`.

### Correctifs prévus
- Protéger systématiquement les appels `repository.listUsers()`, `repository.listSuppliers()`, `repository.listPurchases()` et `repository.listAuditLogs()` avec `canPerformCollectionAction(role, collection, 'list')` (avec repli sur tableau vide `Promise.resolve([])`) dans :
  - `src/features/pertes-gaspillage/index.tsx`
  - `src/features/factures-paiements/index.tsx`
  - `src/features/historique-mouvements/index.tsx`
  - `src/features/rapports/index.tsx`
  - `src/data/pocketbase-adapter.ts` (`getDashboardAnalytics`).
- Sécuriser également `listUsers()` et `listAuditLogs()` dans `PocketBaseDataRepository` pour renvoyer `[]` proprement en cas d’erreur 403 si le rôle courant n’est pas autorisé, évitant tout blocage d’interface.

---

## 3. Moteur de Stock, Inventaires et Import / Export Excel

### Constats de l’audit
1. **Invalidation du cache analytique après opérations** :
   - Certaines mutations dans `src/features/entrees-de-stock/index.tsx`, `src/features/sorties-de-stock/index.tsx`, `src/features/inventaires/index.tsx`, `src/features/produits/index.tsx`, `src/features/fournisseurs/index.tsx` et `src/features/import-export/index.tsx` invalident les requêtes React Query de leur module mais n’appellent pas toujours `invalidateDashboardAnalyticsCache()` ni `queryClient.invalidateQueries({ queryKey: ['dashboard-analytics'] })`.
2. **Restauration de sauvegarde complète (`restoreBackup`) dans `src/data/pocketbase-adapter.ts`** :
   - La méthode `restoreBackup` dans `PocketBaseDataRepository` ne restaurait que `settings`. Elle sera complétée pour synchroniser également les collections métier (`products`, `suppliers`, `purchases`, `purchase_lines`, `exits`, `exit_lines`, `inventory_sessions`, `inventory_lines`, `import_batches`) de manière idempotente.
3. **État initial de la base en mémoire (`memory` adapter)** :
   - Conformément à votre choix, la base en mémoire démarre strictement vide (0 produit, 0 fournisseur, 0 mouvement) jusqu’à l’import de votre fichier Excel, tout en conservant les comptes utilisateurs de prévisualisation actifs pour la connexion.

### Correctifs prévus
- Appeler `invalidateDashboardAnalyticsCache()` et invalider `['dashboard-analytics']` après chaque création/modification/contre-passation d’entrée, de sortie, d’inventaire, de produit, de fournisseur ou d’import Excel.
- Compléter `restoreBackup` dans `src/data/pocketbase-adapter.ts`.

---

## 4. Qualité du Code et Messages d’Erreur en Français

### Constats de l’audit
- `src/lib/handle-server-error.ts` contient encore des messages en anglais (`'Something went wrong!'`, `'No content.'`) et un `console.log(error)`, et n’affiche pas `error.message` lorsqu’une instance standard de `Error` est levée par le repository.
- `src/main.tsx` contient un `console.log({ failureCount, error })` résiduel.
- Les boutons d’outils de développement (`ReactQueryDevtools` et `TanStackRouterDevtools` dans `src/routes/__root.tsx`) seront conservés en mode développement conformément à votre choix.

### Correctifs prévus
- Traduire intégralement `src/lib/handle-server-error.ts` en français, extraire `error.message` pour les erreurs métier du repository, et supprimer les `console.log` résiduels dans `src/lib/handle-server-error.ts` et `src/main.tsx`.
- Exécuter la compilation TypeScript (`compile_applet`), le linter (`lint_applet`) et la suite complète de tests unitaires et d’intégration Vitest pour garantir zéro régression.
