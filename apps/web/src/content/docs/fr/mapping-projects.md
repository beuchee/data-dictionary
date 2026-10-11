<!-- TODO(v2): v1 mapping projects (created, imported and stored in the browser's localStorage). In v2 this page keeps only the coverage evaluation of an imported mapping against the dictionary's projects (multi-format import: source_to_concept_map, SSSOM, Usagi, Linkr mapping projects…, see docs/planning/v2-plan.md §7); editing mappings stays in Linkr. Rewrite when that lands. -->

# Projets de mapping

Un **projet de mapping** est un espace de travail local où un centre de données importe son `source_to_concept_map` (ou tout CSV avec une colonne de `concept_id` OMOP) et vérifie en quelques secondes à quels projets INDICATE son mapping OMOP actuel permet de participer.

> [!NOTE]
> **Données locales**\
> Les projets de mapping vivent entièrement dans le navigateur (`localStorage`). Ils ne sont jamais envoyés au dépôt — votre source-to-concept map reste sur votre machine.

## Où le trouver ?

Navigation → **Alignement de concepts** → onglet *Projets de mapping*.

Les projets de mapping sont affichés sous forme de cartes montrant le nom, la description et le nombre de concepts importés. Cliquez sur une carte pour l’ouvrir.

Exemple de carte :

> **CHU Rennes — ICU mapping**
>
> Source-to-concept map exporté depuis notre ETL OMOP le 2026-05-17.
>
> 341 concepts mappés · 2026-05-17

## Créer un projet de mapping

Cliquez sur **+ Nouveau projet de mapping**. Le modal demande un nom et une description optionnelle (bilingues EN / FR, même convention que les projets INDICATE — la langue dans laquelle vous saisissez est dupliquée dans l’autre locale si elle est vide).

Le modal **Nouveau projet de mapping** :

| Champ | Exemple |
|---|---|
| Nom * | CHU Rennes — ICU mapping |
| Description | Source-to-concept map exporté depuis notre ETL OMOP le 2026-05-17. |

Boutons : **Annuler**, **Créer**.

## Importer un CSV

Ouvrez un projet de mapping et passez sur l’onglet *Concepts mappés*. Utilisez le bouton **Importer un CSV** / **Réimporter un CSV** en haut pour téléverser un fichier. Trois formats sont détectés automatiquement :

- **`source_to_concept_map` OMOP** — en-tête standard avec `source_code`, `source_concept_id`, `target_concept_id`, etc.
- **CSV avec une colonne `concept_id`** — tout CSV ayant au moins une colonne nommée `concept_id` (ou `target_concept_id` / `omop_concept_id`) et éventuellement une colonne source.
- **Liste mono-colonne de `concept_id`** — le format le plus simple, sans en-tête.

Un aperçu affiche le format détecté, le nombre total de lignes valides et le nombre d’ids uniques. Confirmer remplace le mapping précédent.

Le modal **Importer un CSV de mapping** (*source_to_concept_map OMOP · CSV avec colonne concept_id · liste mono-colonne de concept_id — tous auto-détectés.*), après le choix du **Fichier CSV** :

> **source_to_concept_map OMOP**\
> 358 lignes avec un concept_id valide · **341** concepts uniques

Boutons : **Annuler**, **Importer**.

## Les trois onglets internes

### Aperçu

Le dashboard s’ouvre sur trois indicateurs : combien de concepts vous avez importés, combien sont présents dans le dictionnaire INDICATE, et pour combien de projets INDICATE vous êtes pleinement éligible.

| Concepts mappés | Présents dans le dictionnaire | Projets éligibles |
|:-:|:-:|:-:|
| **341** | **218** | **3 / 6** |

Sous les indicateurs, une grille de cartes montre l’éligibilité à chaque projet INDICATE, codée par couleur :

- 🟩 **100%** tous les groupes satisfaits — pleinement éligible
- 🟨 **75–99%** majoritairement couvert, quelques manques
- 🟥 **<75%** manques importants

| Score | Projet | Description |
|:-:|---|---|
| 🟩 100% | **MIMIC-EU [Minimal]** | Atlas de cas de soins aigus anonymisés pour agréger des jeux de données de réanimation et développer des algorithmes d’IA cliniquement pertinents. |
| 🟨 82% | **Early Detection of Organ Failure [Minimal]** | Modèles d’apprentissage automatique prédisant la défaillance d’organes à partir de séries temporelles cliniques. |
| 🟥 54% | **Prediction of Neonatal and Pediatric Sepsis [Minimal]** | Validation de l’infrastructure fédérée pour l’accès aux données pédiatriques, centrée sur le sepsis néonatal et pédiatrique. |

Cliquez sur une carte pour aller directement sur l’onglet Éligibilité avec ce projet déjà sélectionné.

### Concepts mappés

Datatable de chaque `concept_id` unique importé. Colonnes : Vocabulaire, `concept_id` (lien Athena), Nom, Domain, Présent dans le dictionnaire (Oui / Non).

| Vocabulaire | concept_id | Nom | Domain | Dans le dictionnaire |
|---|--:|---|---|:-:|
| LOINC | 3013682 | **Heart rate** | Measurement | Oui |
| SNOMED | 4226798 | **Sepsis** | Condition | Oui |
| RxNorm | 19009166 | **Enoxaparin sodium** | Drug | Non |
| LOINC | 3037556 | **Glucose [Mass/volume]** | Measurement | Oui |

Les concepts absents de tout concept set INDICATE sont résolus contre la base OHDSI chargée dans **Paramètres généraux**. Pendant la résolution les cellules affichent *Loading…* ; si le concept n’est pas trouvé dans la base non plus, la cellule indique *Not in vocabulary*. Si aucune base de vocabulaires n’a été chargée, les cellules affichent *Load OHDSI vocabularies to resolve*.

### Éligibilité

Choisissez un projet INDICATE avec le menu déroulant en haut. La table liste chaque concept set du projet avec son groupe, sa règle, le nombre de concepts résolus, et un badge **Couvert** / **Non couvert**. Une ligne est couverte dès qu’au moins un de ses concepts résolus figure dans votre mapping — vous n’avez pas besoin de tous les concepts du set.

**Projet :** MIMIC-EU [Minimal] ▾ — Couverture : 24 / 28 · Score : 86%

| Groupe | Règle du groupe | Concept set | Résolus | Statut | Détails |
|---|---|---|:-:|:-:|:-:|
| Vital signs | Tous obligatoires | **Heart rate** | 12 | ✓ Couvert | 🔍 |
| Anticoagulants | Au moins un | **Enoxaparin** | 8 | ✓ Couvert | 🔍 |
| Anticoagulants | Au moins un | **Heparin sodium** | 5 | ✗ Non couvert | 🔍 |

Cliquez sur la loupe dans la dernière colonne pour ouvrir le modal de détail par concept set, affichant les concepts déjà présents localement (vert) et les autres concepts du set (gris). Cliquez sur une ligne en dehors de la loupe pour passer à la fiche détaillée du concept set dans le dictionnaire.

Le modal de détail pour **Heart rate** :

> Concepts résolus dans ce set : **12** · **4** local · **8** autres
>
> **Concepts locaux dans ce set (4)**
>
> - ✓ `3013682` Heart rate — LOINC
> - ✓ `8867` Heart rate (clinical) — SNOMED
>
> **Autres concepts du set (8)**
>
> - · `4239408` Heart rate by EKG — SNOMED
> - · `4244396` Heart rate by palpation — SNOMED

## Calcul du score

Chaque groupe est noté selon sa règle :

- **Tous obligatoires** — score = couverts / total. Le groupe n’est satisfait que lorsque tous les concept sets sont couverts.
- **Au moins un** — score = 100% dès qu’un concept set est couvert, 0% sinon.
- **Optionnel** — score informatif, n’affecte pas l’éligibilité.

Le score du projet est la moyenne des scores des groupes non optionnels, arrondi en pourcentage entier.

> [!NOTE]
> **Bonne pratique**\
> Réimportez votre `source_to_concept_map` à chaque évolution de votre ETL OMOP. La photographie de l’éligibilité aux projets INDICATE évolue avec votre couverture de mapping — gardez-la à jour pour détecter les manques tôt.

## Suppression

Les projets de mapping sont stockés localement et n’apparaissent jamais dans le catalogue public. Pour en supprimer un définitivement, utilisez l’action poubelle sur sa carte. Effacer les données du navigateur supprime également tous les projets de mapping.
