<!-- TODO(v2): v1 settings (gear menu → Dictionary Settings, unit tables edited in localStorage). Rewrite against the v2 settings pages once they land. -->

# Paramètres du dictionnaire

Accès via le bouton Paramètres (engrenage) en haut à droite du header → Paramètres du dictionnaire.

La page comporte trois onglets :

- **Vocabulaires OHDSI** — importer et gérer la base de vocabulaires locale
- **Conversions d’unités** — facteurs de conversion entre unités de mesure
- **Unités recommandées** — unité recommandée par concept de mesure

## Vocabulaires OHDSI

L’application peut importer des fichiers de vocabulaires OHDSI dans une **base DuckDB qui fonctionne entièrement dans votre navigateur**. Cela permet des fonctionnalités avancées sans nécessiter de serveur.

### Ce que ça permet

- **Recherche de concepts** — par nom, ID ou code lors de l’ajout de concepts aux expressions
- **Résolution en direct** — expansion des descendants et concepts mappés en temps réel
- **Graphe hiérarchique** — visualisation interactive des relations entre concepts
- **Optimisation** — simplification des expressions par analyse hiérarchique
- **Requêtes SQL** — éditeur SQL dans les Outils de développement

### Comment importer

1. Téléchargez les vocabulaires depuis [ATHENA](https://athena.ohdsi.org/vocabulary/list) (format CSV ou Parquet)
2. Allez dans **Paramètres** (engrenage) → **Paramètres du dictionnaire** → onglet **Vocabulaires OHDSI**
3. Cliquez **Sélectionner le dossier** et choisissez le dossier contenant les fichiers
4. Attendez la fin de l’import — une barre de progression indique l’état

L’import lit CONCEPT.csv, CONCEPT_RELATIONSHIP.csv, CONCEPT_ANCESTOR.csv et les fichiers associés, les indexe dans DuckDB et sauvegarde la base dans le stockage du navigateur.

### Réimporter et supprimer

Pour mettre à jour la base après avoir téléchargé de nouveaux fichiers, supprimez la base existante puis réimportez en sélectionnant à nouveau le dossier.

- **Delete Database** — supprime entièrement la base locale
- **Select Vocabulary Folder** — réimporter depuis le dossier de vocabulaires

## Conversions d’unités

Gérez les facteurs de conversion entre unités de mesure.

Le tableau affiche les concepts source et cible avec leurs unités et facteurs de conversion.

Utilisez les filtres de colonnes pour rechercher dans chaque colonne.

### Actions

- **Ajouter une conversion** — créer une conversion. Sélectionnez le concept et les unités source/cible via la recherche de concepts intégrée (plus de saisie manuelle d’ID), puis saisissez le facteur de conversion et l’offset optionnel.
- **Modifier le facteur** — cliquez sur la cellule du facteur pour l’éditer en ligne
- **Tester** — ouvrir une calculatrice pour vérifier la conversion (inversion bidirectionnelle)
- **Supprimer** — supprimer une conversion avec confirmation

### Export

Cliquez sur **Export** pour ouvrir le modal d’export :

| Option | Description |
|---|---|
| **Télécharger** | Télécharger en fichier JSON |
| **Copier** | Copier le JSON dans le presse-papiers |

## Unités recommandées

Définissez l’unité recommandée pour chaque concept de mesure.

Ceci garantit un usage cohérent des unités dans le dictionnaire et est utilisé pour les conversions automatiques lors de l’export SQL des jeux de concepts.

Utilisez les filtres de colonnes pour rechercher dans chaque colonne.

### Actions

- **Ajouter une unité recommandée** — associer un concept à son unité recommandée. Sélectionnez le concept et l’unité via la recherche de concepts intégrée (plus de saisie manuelle d’ID).
- **Supprimer** — supprimer une recommandation avec confirmation

### Export

Cliquez sur **Export** pour ouvrir le modal d’export :

| Option | Description |
|---|---|
| **Télécharger** | Télécharger en fichier JSON |
| **Copier** | Copier le JSON dans le presse-papiers |

> [!NOTE]
> **Enrichissement des vocabulaires**\
> Lorsqu’une base de vocabulaires OHDSI est chargée, les noms de concepts des deux tableaux sont automatiquement résolus depuis la base. Si la base n’est pas encore prête à l’ouverture d’un onglet, l’application réessaie automatiquement.
