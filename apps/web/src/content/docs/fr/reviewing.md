<!-- TODO(v2): v1 contribution workflow (reviews kept in the browser, "Propose on {{forge.name}}" copy-paste into the forge editor). Rewrite when v2 reviews, server drafts and automatic PR/MR land. The repository structure and build pipeline below also predate v2 (docs/ is now legacy/, plus apps/ and packages/); update them with the v2 cutover. -->

# Relecture & Proposition sur {{forge.name}}

Le {{app.name}} utilise un workflow {{forge.name}} pour contribuer des modifications. Tout le contenu est stocké en fichiers JSON dans le dépôt [{{repository.slug}}]({{repository.url}}).

## Soumettre une relecture

Ouvrez un jeu de concepts, allez dans l’onglet **Relecture**, et cliquez sur **Ajouter une relecture**. Un éditeur plein écran s’ouvre :

L’éditeur **Ajouter une relecture** : un en-tête avec le sélecteur **Statut** (ici *À réviser*) et le bouton **Soumettre la relecture**, puis l’**Éditeur** Markdown à gauche et son **Aperçu** en direct à droite. Exemple de contenu saisi dans l’éditeur :

```markdown
La fréquence cardiaque fœtale devrait être exclue de ce jeu.

Elle est enregistrée au **niveau maternel** (dans le dossier obstétrical de la mère), créant un risque de confusion avec la fréquence cardiaque propre de la mère.

Je suggère de la déplacer dans un jeu de concepts dédié.
```

Sélectionnez un **statut** (Approuvé ou À réviser), rédigez vos commentaires en Markdown dans l’éditeur de gauche avec un aperçu en direct à droite, puis cliquez sur **Soumettre la relecture**.

Votre relecture est stockée dans la session actuelle du navigateur et apparaît dans l’onglet Relecture.

## Proposer des modifications sur {{forge.name}}

Vous pouvez proposer des modifications sur {{forge.name}} de deux manières :

- Dans l’onglet **Relecture**, après avoir soumis une relecture, un bouton **Proposer sur {{forge.name}}** apparaît
- Depuis **n’importe quel onglet**, cliquez sur **Exporter** et choisissez l’option {{forge.name}}

Dans les deux cas, cliquer sur le bouton :

1. Copie le JSON complet mis à jour dans votre presse-papiers
2. Ouvre l’éditeur {{forge.name}} pour ce fichier — si vous n’avez pas les droits d’écriture, vous serez invité à **forker** le dépôt
3. Collez le JSON depuis votre presse-papiers, en remplaçant le contenu du fichier
4. Committez sur une nouvelle branche et ouvrez une **pull request**

> [!NOTE]
> **Pas de compte {{forge.name}} ?**\
> Vous pouvez toujours parcourir et utiliser le dictionnaire localement. Le workflow {{forge.name}} n’est nécessaire que pour contribuer des modifications à la bibliothèque partagée.

## Que pouvez-vous contribuer ?

- **Nouveaux jeux de concepts** — Pour les variables cliniques pas encore couvertes
- **Ajout/suppression de concepts** — Améliorer les expressions existantes
- **Commentaires d’experts** — Recommandations cliniques pour l’ETL et le mapping
- **Données statistiques** — Distributions de référence pour la validation
- **Relectures** — Approuver ou demander la révision de jeux de concepts
- **Traductions** — Améliorer ou ajouter des traductions
- **Signalement de bugs** — [Ouvrir un ticket]({{repository.url}}/issues)

## Structure du dépôt

Le dépôt [{{repository.slug}}]({{repository.url}}) est organisé comme suit :

| Chemin | Contenu |
|---|---|
| `concept_sets/` | Un fichier JSON par jeu de concepts ({id}.json) |
| `concept_sets_resolved/` | Jeux de concepts résolus (générés par resolve.py) |
| `projects/` | Un fichier JSON par projet ({id}.json) |
| `mapping_recommendations/` | Recommandations de mapping (JSON multilingue) |
| `units/` | unit_conversions.json + recommended_units.json |
| `docs/` | Site statique {{forge.name}} Pages (HTML, JS, CSS, fichiers de données générés) |
| `build.py` | Agrège tous les JSON dans docs/data.json et docs/data_inline.js |
| `resolve.py` | Résout les expressions des jeux de concepts avec les vocabulaires OMOP |
| `snapshot.py` | Enregistre les SHA de commit des versions incrémentées dans concept_sets_versions.json (appelé par build.py) |

## Pipeline de build

Trois scripts Python maintiennent les fichiers de données utilisés par l’application web. Ce sont des étapes indépendantes — en particulier, `build.py` ne **re-résout pas** les jeux de concepts ; il lit les fichiers `concept_sets_resolved/` existants tels quels.

### resolve.py

Résout les expressions des jeux de concepts en étendant les descendants et les concepts mappés en utilisant les tables de vocabulaires OMOP. À exécuter uniquement après avoir modifié l’expression d’un jeu de concepts.

```bash
python3 resolve.py --vocab /path/to/ohdsi_vocabularies.duckdb
python3 resolve.py --vocab /path/to/athena_folder      # CSV ou Parquet
python3 resolve.py --vocab /path/to/folder --id 10     # résout un seul jeu
```

La source `--vocab` est détectée automatiquement : un fichier DuckDB (`.duckdb`), ou un dossier de fichiers Athena CSV ou Parquet (CONCEPT, CONCEPT_ANCESTOR, CONCEPT_RELATIONSHIP). Omettez `--vocab` pour utiliser la clé `ohdsiVocab` de `config.local.json` ; utilisez `--id` pour résoudre un seul jeu.

Pour chaque jeu de concepts, il :

1. Partitionne les éléments de l’expression en inclus et exclus
2. Étend chaque ensemble avec les descendants et concepts mappés selon la configuration
3. Calcule : inclus − exclus
4. Écrit le jeu résolu dans `concept_sets_resolved/{id}.json` — ces fichiers pré-calculés permettent de parcourir l’onglet Résolus sans importer de base de vocabulaires localement

### snapshot.py

Enregistre, dans `concept_sets_versions.json`, le SHA du commit Git où vit chaque paire `(id, version)`, afin de pouvoir récupérer plus tard les versions historiques épinglées par les projets. Il est appelé automatiquement par `build.py`, vous le lancez donc rarement directement. Comme le SHA qu’il enregistre doit pointer vers un commit contenant déjà la nouvelle version sur le disque, le workflow se fait en deux commits : (1) incrémentez le champ version et commitez-le, (2) lancez `build.py` (qui crée le snapshot), puis commitez le `concept_sets_versions.json` mis à jour. Un jeu de concepts ayant des modifications non commitées est ignoré (avec un avertissement) — sinon le SHA enregistré ne correspondrait pas au contenu du fichier.

Ce mode par défaut ne voit que la version présente sur le disque : les versions incrémentées sans que personne ne crée de snapshot sont donc manquées — typiquement les contributions fusionnées via « Proposer sur {{forge.name}} », puisque la CI lance `build.py` mais ne commite jamais l’index. Pour rattraper, parcourez l’historique Git :

```bash
python3 snapshot.py --backfill --dry-run
python3 snapshot.py --backfill
```

Cette commande lit le champ `version` à chaque commit ayant touché le jeu de concepts et enregistre le commit qui a *introduit* chaque version — plus précis que l’approximation par HEAD, et cela récupère les versions intermédiaires invisibles au mode par défaut. Les jeux supprimés sont inclus, car un projet peut encore en épingler un. Elle ne fait qu’*ajouter* : une paire déjà indexée conserve son SHA même si le parcours en trouve un autre, car les SHA publiés sont résolus à l’exécution par l’application et en repointer un modifierait une version déjà citée. Ces écarts sont signalés comme divergences (`--show-divergences` les liste) et laissés intacts. Le parcours prend quelques secondes : il reste donc optionnel et n’est jamais appelé par `build.py`.

### build.py

Appelle `snapshot.py`, puis agrège tous les fichiers JSON sources dans les fichiers de données consommés par le site statique. Aucune base de vocabulaires requise.

```bash
python3 build.py
```

Produit :

- `docs/data.json` — JSON compact pour un usage programmatique
- `docs/data_inline.js` — Mêmes données sous forme `const DATA={...};` pour inclusion directe par script

> [!NOTE]
> **Rebuild complet**\
> Après modification des fichiers de données sources, exécutez les deux scripts :\
> `python3 resolve.py --vocab /path/to/vocabularies.duckdb && python3 build.py`\
> La source de vocabulaire peut aussi être un dossier de fichiers Athena CSV ou Parquet.

## Skills Claude Code

Si vous utilisez [Claude Code](https://github.com/anthropics/claude-code) pour travailler sur ce dépôt, trois skills (commandes slash) sont disponibles :

- `/resolve-concept-sets` — Exécute resolve.py pour résoudre un ou tous les jeux de concepts
- `/build-catalog` — Exécute build.py pour regénérer les fichiers de données du site statique
- `/describe-concept-set` — Génère une description clinique détaillée pour un jeu de concepts

Ceux-ci automatisent le pipeline de build et assistent la rédaction de la documentation.
