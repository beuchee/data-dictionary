# Data Dictionary v2 — plan

Branche : `v2` (créée depuis `main` le 2026-10-10).
Objectif : réécrire le dictionnaire en React + FastAPI sur le modèle de Linkr (login, synchronisation git, composants UI), avec tests unitaires, personnalisation par instance, et **compatibilité totale avec les fichiers de contenu actuels**.

Décisions validées le 2026-10-10 : voir § 10. Points restant à trancher : § 11.

---

## 1. Point de départ

### v1 (ce dépôt)
- SPA statique vanilla JS, déplacée de `docs/` vers `legacy/` sur cette branche (~31,8k LOC : `concept-sets.js` 7,8k, `documentation.js` 5k, `app.css` 4,3k, `app.js` 3k…), hébergée sur GitHub Pages.
- Pas de backend : éditions dans `localStorage`, contribution via « Propose on GitHub » (copier-coller dans l'éditeur web de GitHub).
- Scripts Python : `resolve.py`, `build.py`, `snapshot.py`, `reset.py`, `update_from_upstream.py`.
- Contenu : 366 concept sets (+ 366 résolus), 6 projets, `units/recommended_units.json` (3332), `units/unit_conversions.json` (968, dont 118 avec `offset`), `mapping_recommendations/mapping_recommendations.json`, `config.json`, `id_counters.json`, `concept_sets_versions.json`.
- **Aucun test** (seuls des `.pyc` orphelins dans `tests/python/`, `core/`, `scripts/` laissent penser qu'un port Python de l'export SQL a existé).

### Linkr (`../linkr`, branche `feature/fastapi-backend`)
- **Front** `apps/web` : React 19, Vite 7, TS 5.9 strict, Tailwind v4, shadcn/ui (new-york, slate), zustand, react-router 7, i18next, TanStack Table, Monaco, react-markdown, vis-network, DuckDB-WASM, vitest (~200 tests, `node`, pas de tests de composants).
- **Back** `apps/api` : FastAPI, SQLAlchemy 2 async, SQLite par défaut / Postgres, Alembic (migrations auto au démarrage), JWT (access 24h + refresh 30j) + clés API, bcrypt, rôles et permissions `resource:action`, assistant de premier lancement (`/setup`), git par `subprocess` durci (`services/git_service.py`), tokens git chiffrés par utilisateur et par hôte (AES-GCM), pytest (~1450 tests, client httpx ASGI, SQLite mémoire, dépôts git bare temporaires).
- **Double déploiement** : `isServerMode() = !!VITE_API_URL` ; une façade `Storage` (interfaces par entité) implémentée en IndexedDB (statique) ou REST (serveur).
- **Pas de personnalisation** (logo, couleurs, nom) : tout est codé en dur. C'est donc à construire, pas à reprendre.
- Linkr **consomme déjà ce dépôt** : `apps/web/src/lib/data-dictionary/` (`content.ts`, `repo.ts` avec `DEFAULT_DICTIONARY_REPO`, `resolve.ts` port de `resolve.py`, `sql-export.ts`) et côté API `services/data_dictionary_service.py` (synchronisation clé sur `uniqueId`). → contrainte de compatibilité supplémentaire, et code réutilisable.

---

## 2. Principes directeurs

1. **Le dépôt git reste la source de vérité.** Les fichiers JSON (`concept_sets/`, `projects/`, `units/`…) gardent leur format et leur emplacement. La base SQL du serveur ne stocke que ce qui n'appartient pas au contenu (utilisateurs, rôles, brouillons, tokens git, état de synchro, mappings importés) et un **index** reconstructible du contenu pour la recherche.
2. **Écriture byte-identique.** Un fichier lu puis réécrit sans modification doit être identique octet pour octet (indentation 2, UTF-8 non échappé, ordre des clés de `concept_set.example.json`, saut de ligne final). C'est le test de compatibilité central.
3. **Un seul contrat de format, deux implémentations testées l'une contre l'autre.** JSON Schemas dans `packages/dictionary-format/`, validés par pytest (`jsonschema`) *et* vitest (`ajv`) sur les 366 fichiers réels.
4. **Reprendre l'architecture de Linkr, pas son domaine.** On copie les composants UI génériques et les services (auth, git, crypto) ; on réécrit le shell (`Header`, `Sidebar`, `App.tsx`), trop couplé aux workspaces de Linkr.
5. **Tests sur la logique pure et critique** (règle Linkr) : résolution, export SQL/ATLAS/CSV, conversions d'unités, sérialisation, parseurs d'import, fusion, versioning, auth, git. Pas de tests de composants volatils.
6. **Pas de concurrence avec Linkr** : le dictionnaire évalue des mappings, il ne les édite pas.

---

## 3. Architecture cible

### Arborescence (sur la branche `v2`)

```
apps/
  web/                    # React (copie adaptée de linkr/apps/web)
  api/                    # FastAPI (copie adaptée de linkr/apps/api)
packages/
  dictionary-format/      # JSON Schemas + types TS + golden fixtures, partagés
concept_sets/             # inchangé
concept_sets_resolved/    # inchangé
projects/ units/ mapping_recommendations/   # inchangés
config.json               # étendu (branding.colors…), rétrocompatible
concept_sets_versions.json, id_counters.json # inchangés
docker/                   # compose : web (nginx) + api
docs/                     # doc développeur (formats, pipeline, architecture, plans), comme linkr/docs
legacy/                   # SPA v1 (ex-docs/), live jusqu'à la bascule puis supprimée
AGENTS.md                 # point d'entrée court pour les agents ; CLAUDE.md = `@AGENTS.md`
```

Le code applicatif et le contenu cohabitent comme aujourd'hui (une instance = un dépôt), ce qui garde `reset.py` / `update_from_upstream.py` pertinents.

**Fait le 2026-10-10** :
- SPA v1 déplacée de `docs/` vers `legacy/` (`build.py`, CI GitHub et GitLab, `.gitignore`, `update_from_upstream.py`, README, FORKING, skill `build-catalog` mis à jour ; `build.py` vérifié).
- `docs/` = doc développeur : `data-formats.md`, `build-pipeline.md`, `legacy-spa.md`, `planning/`.
- `AGENTS.md` court qui renvoie vers `docs/` ; `CLAUDE.md` se réduit à `@AGENTS.md`.

À ajouter dans `docs/` au fil des phases : `architecture.md`, `conventions.md`, `ui-patterns.md` (adaptés de Linkr), `deployment.md`, `testing.md`.

### Modes de déploiement : les deux, comme Linkr

| | Serveur (FastAPI) | Statique (GitHub/GitLab Pages, WASM) |
|---|---|---|
| Lecture du catalogue | API (index SQLite du clone) | `data.json` généré au build, comme aujourd'hui |
| Login | oui | non (lecture seule, ou éditions locales IndexedDB) |
| Édition / review | brouillons serveur → PR/MR, ou commit direct (mainteneurs) | « Proposer » (comme v1) |
| Vocabulaire OMOP | DuckDB serveur (import ATHENA, repris de Linkr) | DuckDB-WASM (comme v1) |
| Import de mappings | parsing serveur, mappings stockés en base | parsing navigateur, IndexedDB |
| Versioning | snapshot automatique au commit | `build.py` en CI |

Façade `Storage` de Linkr, bien plus petite ici (~8 entités au lieu de 48).

### Backend (`apps/api`)

Repris de Linkr presque tel quel :
- `core/` : `config.py` (préfixe `DD_`), `database.py`, `security.py` (bcrypt, politique de mot de passe), `deps.py` (`get_current_user`, `require_permission`), `crypto.py`, `security_headers.py`, migrations Alembic auto.
- `models/` : `user`, `role`, `api_token`, `git_credential`, `git_sync_state`, `app_settings`.
- `routes/` : `auth`, `setup` (assistant de premier lancement), `users`, `roles`, `api_tokens`, `git`.
- `services/git_service.py` : repris tel quel (clone, status, diff, commit_push avec ancre `synced_oid`, SSRF guard, tokens injectés par appel).

Nouveau, propre au dictionnaire :
- `services/repo_store.py` : **le cœur**. Clone de travail du dépôt de contenu dans `DATA_DIR/content/`, lecture/écriture des JSON avec sérialiseur byte-identique, réindexation incrémentale en SQLite (tables `concept_set_index`, `project_index` : id, uniqueId, version, statut, catégories, noms par langue, pour la recherche et les filtres).
- `services/resolver.py` : port de `resolve.py` (même algorithme, même sortie) ; `resolve.py` devient un wrapper CLI qui l'appelle.
- `services/versioning.py` : port de `snapshot.py`. En mode serveur, **le snapshot se fait au moment du commit** (on connaît le SHA juste après `git commit`) → fin du workflow en deux commits. `--backfill` reste disponible en CLI.
- `services/catalog_build.py` : port de `build.py` (génère le `data.json` du mode statique) ; `build.py` devient un wrapper.
- `services/vocabulary.py` : repris de `vocabulary_library.py` de Linkr (import ATHENA CSV/Parquet → Parquet), une seule bibliothèque par instance (pas de workspaces).
- `services/mapping_import/` : parseurs de mappings (§ 7).
- `routes/` : `concept-sets`, `projects`, `units`, `unit-conversions`, `mapping-recommendations`, `mappings`, `vocabulary`, `branding`, `drafts`, `reviews`.

**Modèle d'écriture git (décidé)** : un utilisateur édite un **brouillon** (stocké en base, pas dans le dépôt). « Soumettre » → le serveur écrit les fichiers, commite sur une branche `proposal/<user>-<slug>` et ouvre une PR (GitHub) ou MR (GitLab) via l'API du forge. Seul le rôle `maintainer` peut commiter directement sur la branche principale (et fusionner les propositions depuis l'app). Les champs de provenance (`modifiedBy`, `organization.current`, `sourceRepo`, `createdByDetails`) sont remplis depuis le profil de l'utilisateur connecté.

**Login (décidé)** : comptes locaux (repris de Linkr) **plus OAuth GitHub, GitLab et ORCID**, à construire car Linkr n'en a pas (Authlib côté FastAPI, flux authorization code + PKCE).
- Un utilisateur peut lier plusieurs identités à son compte (table `user_identity` : provider, subject, email, profil).
- **GitHub / GitLab** : le token OAuth (scope `repo` / `api`, chiffré comme les tokens git de Linkr) sert aussi à pousser la branche et ouvrir la PR/MR **au nom de l'utilisateur**. Sans lui, la proposition passe par le token de service de l'instance, avec l'auteur en `Co-authored-by`.
- **ORCID** : identité seulement ; remplit automatiquement l'ORCID du profil, utilisé dans `createdByDetails` et les reviews.
- Providers activés et identifiants clients en variables d'environnement (`DD_OAUTH_GITHUB_CLIENT_ID`…), jamais dans le dépôt. GitLab auto-hébergé : URL de base configurable.

**Lecture anonyme (décidé)** : autorisée, mais paramétrable dans `config.json` (`access.anonymousRead`, défaut `true`). À `false`, toute page exige un login. Le mode statique est par nature public.

Rôles : `viewer` (lecture, défaut anonyme si `anonymousRead`), `reviewer` (reviews), `editor` (brouillons + propositions), `maintainer` (commit direct, fusion, unités, branding), `admin` (utilisateurs, configuration serveur).

### Frontend (`apps/web`)

Copié depuis Linkr (dépendances limitées à `@/lib/utils` et aux fichiers voisins) :
- `components/ui/` : primitives shadcn personnalisées, `data-table`, `table-primitives`, `dialog-shell`, `page-header`, `list-page-toolbar`, `search-input`, `section-label`, `empty-state`, `truncated-text`, `form-field`, `multi-select-filter`, `column-visibility-menu`, `notice-banner`, `stat-card`, `color-picker-popover`, `file-drop-zone`, `password-input`, `new-password-fields`…
- `components/editor/` : `CodeEditor` (Monaco, découplé de `app-store`), `MarkdownRenderer`, `SplitEditorPreview`, `MarkdownToolbar`.
- `components/versioning/` : `GitSyncPanel`, `GitDiffDialog`, `GitTokenDialog`, `GitConfigDialog`, adaptés au modèle « un dépôt par instance ».
- Auth : `api-client.ts` (Bearer + refresh), `auth-store.ts`, `AuthGate`, `LoginPage`, `SetupWizard`.
- Domaine OMOP : `ConceptDetailSheet` (graphe de hiérarchie vis-network), `fuzzy-search.ts`, `concept-detail-queries.ts`, `lib/duckdb/engine.ts`, `lib/data-dictionary/{resolve,sql-export,parse}.ts`.
- Import de fichiers : le sélecteur de colonnes de `CreateMappingProjectDialog.tsx` (papaparse, xlsx, aperçu, rôles de colonnes, devinette des en-têtes), extrait en composant générique.
- À réécrire : `App.tsx`, `Header`, `Sidebar` (couplés aux workspaces de Linkr), et les gros écrans `ConceptSetsTab` / `TargetConceptPanel`, à reconstruire à partir de leurs morceaux.

**Licence** : le code repris de Linkr (AGPL-3.0) est relicencié en EUPL-1.2 par son auteur. Les fichiers copiés gardent une trace de leur origine (`// from linkr@<sha>`) pour pouvoir reporter les correctifs.

### Personnalisation (branding)

`config.json` étendu, **rétrocompatible** (toutes les nouvelles clés optionnelles) :

```json
"branding": {
  "logo": "logo.png",
  "favicon": "favicon.png",
  "logoAlt": "INDICATE",
  "appName": "INDICATE Data Dictionary",
  "colors": {
    "primary": "#1f6feb",
    "secondary": "#6e40c9"
  },
  "darkColors": { "primary": "#58a6ff" },
  "font": "Inter"
}
```

- Seules `primary` et `secondary` sont personnalisables (décidé le 2026-10-11) : dans shadcn, `--accent` est la surface de survol des menus et boutons fantômes, une couleur de marque saturée y teinterait chaque survol. `accent` reste donc le token neutre d'`index.css` ; une clé `colors.accent` reste acceptée par le schéma (compatibilité) et est ignorée.
- Au démarrage, le front injecte les couleurs dans les tokens CSS (`--primary`, `--secondary`, `--ring`, `--sidebar-primary`…) ; à partir d'une couleur de base, `lib/theme.ts` dérive la variante d'avant-plan et la variante sombre (calcul OKLCH, contraste AA vérifié). Fonction pure → testée.
- Écran admin « Personnalisation » : upload du logo/favicon, sélecteurs de couleur avec aperçu en direct, nom, langues, organisation, onglets visibles, vocabulaire custom. En mode serveur, l'enregistrement **commite `config.json` + les images** (la personnalisation suit le dépôt, donc aussi le build statique).
- L'assistant de premier lancement couvre : compte admin → dépôt de contenu (URL, branche, token) → organisation → branding → contenu (partir du dépôt INDICATE, d'un dépôt vide, ou d'un fork). Il remplace `reset.py` pour un nouveau dictionnaire.

### Internationalisation
- UI : i18next, un fichier par espace de noms et par langue (`locales/{en,fr}/<namespace>.json`, pour que les fonctionnalités développées en parallèle ne se marchent pas dessus) ; règle Linkr : tout texte via `t()`.
- Contenu : langues de `config.json` (`languages`), structure *language-first* inchangée, toujours **sans repli** d'une langue sur l'autre.

---

## 4. Compatibilité des fichiers — stratégie de test

1. **Schémas** (`packages/dictionary-format/schemas/`) : concept set, concept set résolu, projet, recommended unit, unit conversion, mapping recommendations, config, versions index, id counters. Valident les 366 + 366 + 6 fichiers réels dans les deux suites de tests.
2. **Round-trip** : lecture → sérialisation → comparaison octet par octet, sur **tous** les fichiers du dépôt (Python et TS).
3. **Parité avec v1** :
   - `resolver.py` vs `resolve.py` actuel sur un mini-vocabulaire de fixtures (DuckDB) : même `resolvedConcepts`.
   - `catalog_build` vs `build.py` actuel : même `data.json` (hors `dataVersion`).
   - Export SQL, ATLAS JSON, CSV de projet, calcul d'éligibilité : golden files générés **depuis la v1** (en exécutant ses fonctions JS sous Node) avant de la retirer ; reprendre les cas de l'ancienne suite `test_sql_export` (155 mg/dL vs mmol/L, offsets affines 184/330, multi-domaine 318, mixte 305).
4. **Compatibilité Linkr** : un test vérifie que `linkr/apps/web/src/lib/data-dictionary/content.ts` peut toujours lire un dépôt produit par la v2 (même arborescence, mêmes champs).
5. **Champs inconnus préservés** : un champ ajouté par un fork ou une version future survit à un cycle lecture/écriture.

---

## 5. Tests et CI

- **Python** (`apps/api/tests/`) : pytest + pytest-asyncio, `conftest.py` repris de Linkr (SQLite mémoire, `DATA_DIR` en `tmp_path`, dépôts git bare locaux, bcrypt à 4 rounds). Cibles : auth / setup / permissions, git (commit, push, PR, conflit `pull_required`), `repo_store` (round-trip, index), resolver, versioning (snapshot au commit, backfill), parseurs d'import de mappings, branding, endpoints CRUD.
- **TS** (`apps/web`, vitest, environnement `node`) : schémas, sérialisation, résolution, export SQL / ATLAS / CSV, conversions d'unités, parseurs d'import et détection de format, éligibilité, fusion brouillon/distant, thème (dérivation de couleurs, contraste), recherche floue.
- **CI GitHub Actions** (contrairement à Linkr, les tests tournent en CI) : `lint + typecheck + vitest`, `ruff + pytest`, build statique, build des images Docker sur tag. Le workflow de déploiement Pages actuel (`legacy/`) reste en place jusqu'à la bascule.

---

## 6. Parité fonctionnelle (checklist v1 → v2)

**Concept sets**
- [ ] Liste : badges de catégories (`?category=`), filtres par colonne, recherche floue, pagination, colonnes visibles, sélection multiple, masquage
- [ ] Création / métadonnées : nom, catégorie/sous-catégorie en cascade, descriptions par langue
- [ ] Détail : bandeau de version épinglée, garde contre les modifications non enregistrées, statut (5 slugs), modale de version (suggestion semver, historique), vue JSON
- [ ] Onglet Concepts : expression / résolu, édition (exclude / descendants / mapped), import ATLAS JSON, ajout de concepts (recherche OHDSI + concept custom `customVocabulary`), « Optimize expression », résolution live
- [ ] Panneau concept : lien Athena, `$lookup` FHIR, historique de navigation, Related / Hierarchy (graphe) / Synonyms
- [ ] Commentaires (Markdown par langue, éditeur scindé + aperçu, scroll synchronisé)
- [ ] Statistiques (`distributionStats`, profils, histogramme, édition JSON)
- [ ] Reviews (liste, ajout, statut, Markdown) → en v2 : liées au compte connecté
- [ ] Export : INDICATE JSON, ATLAS JSON, SQL OMOP avec unité de référence et conversions (option « drop other units »)
- [ ] Import inter-dépôts (repo entier ou set unique, classement par `uniqueId`, `origin` figé, `organization.current`)

**Projets** : cartes, CRUD, description Markdown, groupes (règles `all_required` / `at_least_one` / `optional`, réordonnancement), versions épinglées + diff à la mise à jour, export CSV et JSON.

**Mapping** : recommandations Markdown bilingues avec table des matières ; évaluation de la couverture d'un mapping existant, avec import multi-format (§ 7). L'édition de mappings reste dans Linkr.

**Paramètres** : conversions d'unités (test de conversion, sélecteur de concept), unités recommandées, vocabulaires (import ATHENA).

**Dev tools** : éditeur SQL DuckDB + exemples, ERD des tables de vocabulaire.

**Documentation** : reste dans l'app. Aujourd'hui 5k LOC de HTML en dur → fichiers Markdown par langue (`apps/web/src/content/docs/{en,fr}/*.md`) rendus par `MarkdownRenderer`, avec variables injectées depuis `config.json` (organisation, vocabulaire custom).

**Nouveau en v2** : login et rôles, brouillons serveur, PR/MR automatiques, snapshot automatique, écran de personnalisation, assistant de premier lancement, synchro git visible (statut, diff, pull), import de mappings multi-format.

---

## 7. Couverture de mapping : import multi-format

### Ce que fait la v1 (`legacy/mapping.js`)
- `parseCSV` (séparateur deviné : tab, `;`, `,`) puis `detectFormat` : `stcm`, `concept_id_with_source` ou `concept_id_list`, selon des noms de colonnes fixes.
- Seuls les `concept_id` cibles (entiers non nuls) sont gardés ; codes source, statut et équivalence sont perdus.
- Éligibilité (`evaluateProject`) : un concept set est couvert si l'un de ses concepts résolus (à la version épinglée) est mappé ; règles de groupe `all_required` (score = couverts/n, satisfait si tous), `at_least_one` (0 ou 1), `optional` (toujours satisfait) ; score projet = moyenne des groupes non optionnels.

### Cible v2
Un **import de mapping** = un fichier → un ensemble normalisé de lignes, stocké avec ses métadonnées (nom, fichier source, format, date, auteur) :

```ts
type MappingRow = {
  sourceVocabularyId?: string
  sourceCode?: string
  sourceName?: string
  sourceConceptId?: number      // 2 milliards si concept custom
  targetConceptId: number       // 0 = non mappé
  equivalence?: string          // CURIE skos:exactMatch… si dispo
  status?: string               // approved / unchecked / flagged…
  frequency?: number
}
```

On garde la source et le statut : ça permet d'afficher **quels codes locaux** couvrent un concept set, de filtrer sur les mappings approuvés, et de lister les cibles non standard ou invalides.

### Formats d'entrée

| Format | Détection | Cible | Remarques |
|---|---|---|---|
| **Générique CSV/TSV/XLSX/Parquet** | choix manuel des colonnes | colonne choisie | Sélecteur repris de Linkr (`CreateMappingProjectDialog`) : délimiteur, encodage, feuille, aperçu 10 lignes, rôles (code source, vocabulaire, libellé, concept_id cible, statut, fréquence), devinette des en-têtes. Plusieurs cibles dans une cellule (`;`, `,`, `\|`) via `parseTargetIds`. |
| **source_to_concept_map** | en-têtes OMOP (`source_code`, `target_concept_id`…) | `target_concept_id` | Variante ETL Linkr avec `source_domain_id` en plus. `0` = non mappé. |
| **CONCEPT + CONCEPT_RELATIONSHIP** | deux fichiers ou ZIP (export « C/CR » de Linkr) | `concept_id_2` des lignes `Maps to` (et `Maps to value`) valides | Source = concepts 2 milliards de `CONCEPT`. Ignorer `invalid_reason` renseigné. |
| **SSSOM TSV** | bloc YAML `#` + en-tête `subject_id`… | `object_id` après le préfixe (`OHDSI:`, `OMOP:`…, lu dans `curie_map`) | `sssom:NoTermFound` = non mappé ; `predicate_modifier: Not` = exclu ; `predicate_id` → équivalence. Linkr exporte `subject_id = VOCAB:CODE`. |
| **Usagi CSV** | en-têtes `sourceCode`, `conceptId`, `mappingStatus` | `conceptId` | Couverture par défaut sur `mappingStatus = APPROVED` et `conceptId > 0` (option pour tout compter). |
| **Projet de mapping Linkr** (ZIP ou dépôt git) | `entity.json` + `mappings.json` | `targetConceptId` | Le plus riche : statut, équivalence, reviewers. En mode serveur, peut se lier à un dépôt git et se resynchroniser. |
| **ATLAS** | JSON d'expression ou CSV « Included Concepts » / « Included Source Codes » | colonne Concept ID | Un concept set ATLAS n'est pas un mapping : on l'interprète comme « liste de concepts disponibles dans mon entrepôt ». À valider (§ 11). |
| **Liste de concept_id** | une colonne d'entiers | la colonne | Comportement v1 conservé. |

La détection automatique propose un format, l'utilisateur confirme ; le sélecteur de colonnes reste toujours accessible pour corriger.

### Stockage (décidé)
- Mode serveur : les imports sont **partagés dans l'instance** (visibles par tous les utilisateurs connectés, créés par un `editor` ou plus), stockés en base, **pas versionnés dans le dépôt**.
- Mode statique : IndexedDB, local au navigateur (comme v1).

### Implémentation
- Un parseur par format, **pur et testé**, en TS (mode statique) *et* en Python (mode serveur), avec les **mêmes fixtures** dans `packages/dictionary-format/fixtures/mappings/` : exemples réels générés par les exporteurs de Linkr (`ccr-export.ts`, `stcm-export.ts`, `export.ts`) + fichiers ATLAS/Usagi réels à récupérer.
- Éligibilité : port de `evaluateProject` avec golden tests v1, étendu d'un filtre de statut et d'une vue « codes source qui couvrent ce concept set ».

---

## 8. Phases

| # | Livrable | Contenu |
|---|---|---|
| 0 | Socle | Monorepo (npm workspaces + turbo, `npm run dev:all`, `docker/docker-compose.yml`), copie du kit UI + shell réécrit, i18n, thème dynamique, `packages/dictionary-format` + tests de compatibilité (schémas, round-trip), CI, `docs/architecture.md` / `conventions.md` / `ui-patterns.md`. *Rien de visible, mais les filets de sécurité existent avant la première ligne métier.* |
| 1 | Catalogue en lecture | `repo_store` + index, API lecture, pages liste / détail concept set (concepts, résolu, commentaires, stats, reviews en lecture), projets en lecture, exports (JSON, ATLAS, SQL, CSV) avec goldens v1. Build statique équivalent au site actuel. |
| 2 | Auth + édition + git | Setup wizard, login local + OAuth GitHub / GitLab / ORCID, lecture anonyme paramétrable, rôles, profils (remplacent le profil `localStorage`), brouillons, édition des métadonnées / commentaires / statut / version, reviews, PR/MR + commit direct mainteneur, snapshot au commit, panneau de synchro. |
| 3 | Vocabulaire | Import ATHENA serveur, recherche, panneau concept + hiérarchie, édition d'expression, ajout de concepts, résolution serveur (port `resolve.py`), optimize. Mode statique : DuckDB-WASM. |
| 4 | Le reste de la parité | Projets en édition (groupes, versions épinglées, diff), unités et conversions, recommandations de mapping, import inter-dépôts, couverture de mapping multi-format (§ 7), dev tools. |
| 5 | Personnalisation & fork | Écran branding, assistant « nouveau dictionnaire », remplacement de `reset.py` / `update_from_upstream.py` côté UI, `FORKING.md` réécrit. |
| 6 | Bascule | Documentation migrée en Markdown, images Docker publiées sur tag, déploiement de l'instance INDICATE, redirections des anciennes URL hash (`#/concept-sets?id=…`), suppression de `legacy/`, mise à jour de `README.md` / `AGENTS.md`, vérification côté Linkr. |

Chaque phase se termine par des tests verts et une démo utilisable.

**État au 2026-10-10** : phase 0 en grande partie faite. Monorepo, `apps/api` (auth, setup, rôles, 88 tests), `apps/web` (shell, kit UI, thème dynamique, 116 tests), `packages/dictionary-format` (9 schémas, sérialiseur byte-identique TS + Python, 44 + 44 tests), Docker, CI. Reste : AuthGate et page de login côté web, lecture anonyme, `docs/architecture.md`.

**État au 2026-10-11** : phase 0 terminée, socle de la phase 1 posé. Accent non personnalisable (§ 10) ; i18n découpée par espace de noms ; `content_store` + routes de lecture `/api/v1` (catalogue rechargé sur changement, versions passées via git, lecture anonyme paramétrable) ; couche `DictionarySource` côté web (API ou payload statique de `build.py`, versions passées via l'endpoint raw du forge) + `catalog-store` ; login, assistant de premier lancement (compte admin), menu utilisateur (profil, mot de passe), `AppErrorBoundary` ; `docs/architecture.md`. Tests : API 157, web 195, format 44 + 44. Reste pour la phase 1 : index SQLite, pages liste / détail, exports. `repo_store` du § 3 s'appelle `content_store` (lecture seule pour l'instant).
