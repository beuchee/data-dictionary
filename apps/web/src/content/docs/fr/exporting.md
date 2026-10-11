<!-- TODO(v2): the "Propose on {{forge.name}}" options are v1 behaviour (copy-paste into the forge editor); v2 replaces them with server drafts and automatic PR/MR. Rewrite once the v2 exports land. -->

# Exporter

## Exporter tous les jeux de concepts

Sur la page principale **Dictionnaire de données** (le datatable listant tous les jeux), cliquez **Exporter** pour ouvrir le modal d’export groupé.

Le modal **Exporter les jeux de concepts** :

| Option | Description |
|---|---|
| **Tout exporter** | Télécharger tous les jeux de concepts en un seul fichier JSON |
| **Filtrer par catégorie** | Exporter les jeux de concepts d’une catégorie spécifique |

## Exporter un jeu de concepts

Depuis la vue détaillée d’un jeu, cliquez **Exporter** pour ouvrir le modal d’export.

### Étape 1 : Choisir une méthode

Le modal **Exporter le jeu de concepts** :

| Option | Description |
|---|---|
| **Télécharger le fichier JSON OHDSI** | Télécharger le jeu de concepts au format JSON OHDSI |
| **Copier le JSON OHDSI** | Copier le jeu de concepts au format JSON OHDSI dans le presse-papiers |
| **Proposer sur {{forge.name}}** | Copier et ouvrir l’éditeur {{forge.name}} |
| **Copier la requête SQL OMOP** | Requête SQL pour extraire les données des tables OMOP CDM, avec conversions d’unités |

- **Télécharger le fichier JSON OHDSI** — Télécharge en fichier `.json`
- **Copier le JSON OHDSI** — Copie le JSON dans le presse-papiers
- **Proposer sur {{forge.name}}** — Copie et ouvre l’éditeur {{forge.name}} (voir [Relecture & {{forge.name}}](?section=reviewing))
- **Copier la requête SQL OMOP** — Génère une requête SQL (voir ci-dessous)

### Étape 2 : Choisir un format

Pour Télécharger et Copier :

| Format | Description |
|---|---|
| **Spécification du jeu de concepts** | Format OHDSI complet avec métadonnées et traductions |
| **ATLAS** | Format compatible ATLAS (expression uniquement) |

Un bouton **Retour** ramène à l’étape 1.

- **[Spécification du jeu de concepts](https://ohdsi.github.io/TAB/Concept-Set-Specification.html)** — Format OHDSI complet (format natif du dictionnaire)
- **ATLAS** — Format compatible ATLAS (expression uniquement)

## Requête SQL OMOP

L’option **Copier la requête SQL OMOP** génère une requête SQL pour extraire les données des tables OMOP CDM pour les concepts résolus du jeu de concepts actuel.

La requête générée :

- Sélectionne dans la table OMOP adaptée au domaine du concept (measurement, condition_occurrence, drug_exposure, procedure_occurrence, observation, device_exposure)
- Filtre sur les IDs de concepts standards résolus
- Inclut les **conversions d’unités** lorsque disponibles — en utilisant les facteurs de conversion définis dans [Paramètres du dictionnaire](?section=dictionary-settings) (onglet Conversions d’unités), la requête convertit les valeurs vers l’**unité recommandée** définie dans l’onglet Unités recommandées

Le SQL est copié dans votre presse-papiers et un aperçu est affiché dans le modal.

## Export projet

Depuis la vue détaillée d’un projet, cliquez **Exporter** pour ouvrir le modal d’export :

Le modal **Exporter le projet** :

| Option | Description |
|---|---|
| **Télécharger** | Télécharger en fichier |
| **Copier** | Copier le contenu dans le presse-papiers |
| **Proposer sur {{forge.name}}** | Copier et ouvrir l’éditeur {{forge.name}} |

L’onglet Jeux de concepts propose également **Exporter CSV** pour télécharger tous les concepts OMOP des jeux de concepts du projet en CSV, utile pour les pipelines d’analyse.
