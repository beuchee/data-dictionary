<!-- TODO(v2): v1 project editing (edit mode saved to localStorage, "Propose on {{forge.name}}"). Rewrite when v2 project pages and editing land; groups, rules and version pinning stay valid. -->

# Gérer les projets

La page **Projets** permet d’organiser les jeux de concepts en projets de recherche. Un projet peut être une étude clinique, un pipeline de machine learning, un tableau de bord, ou toute initiative data-driven.

## Liste des projets

Les projets sont affichés sous forme de cartes montrant le nom, la description, le nombre de jeux de concepts, l’auteur et la date. Utilisez le champ de recherche pour filtrer par nom ou description. Cliquez sur une carte pour ouvrir le projet.

Exemple de carte :

> **Quality Benchmarking Dashboards [Minimal]**
>
> Demonstrates data sharing practices designed to support continuous improvement of clinical practice through quality benchmarking.
>
> 99 jeux de concepts · Falk von Dincklage · 2024-12-01

## Créer un projet

En mode édition, cliquez **Ajouter un projet**. Fournissez un nom et une description courte (multilingues, actuellement EN/FR). L’auteur est pré-rempli depuis votre profil.

Le modal **Nouveau projet** :

| Champ | Exemple |
|---|---|
| Nom * | Quality Benchmarking Dashboards |
| Description courte | Quality benchmarking dashboards for ICU data |
| Créé par | Falk von Dincklage |

Boutons : **Annuler**, **Créer**.

## Vue détaillée du projet

Cliquez sur une carte de projet pour ouvrir sa vue détaillée avec deux onglets :

### Onglet Description

Description longue au format Markdown avec aperçu en direct en mode édition. La description est éditée pour la langue actuellement sélectionnée.

### Onglet Jeux de concepts

En mode lecture, affiche un tableau triable et filtrable des jeux de concepts du projet, organisés par groupe. Chaque ligne montre le groupe auquel elle appartient, la règle du groupe et l’état de la version épinglée. Cliquez sur une ligne pour naviguer vers ce jeu de concepts ; cliquez sur la pastille de groupe ou le badge *Obsolète* pour les actions inline.

| Groupe | Règle du groupe | Nom | Version | Mise à jour |
|---|---|---|---|:-:|
| Constantes | ✱ Tous obligatoires | **Heart rate** | `1.0.0` | ⚠ Obsolète |
| Anticoagulants | ✔ Au moins un | **Enoxaparin sodium** | `1.1.0` | ✓ À jour |

En mode édition, une interface à double panneau vous permet de :

- **Panneau gauche** — Jeux de concepts disponibles (pas encore dans le projet)
- **Panneau droit** — Jeux de concepts assignés au projet, avec leur groupe
- Utilisez les boutons ⊕ (ajouter) et ⊖ (retirer) pour déplacer les jeux entre les panneaux. Les jeux ajoutés atterrissent dans le groupe actif (mis en évidence dans la barre d’outils).
- Sélectionnez plusieurs lignes via les cases à cocher pour les déplacer entre groupes en masse
- Filtrez les deux panneaux par catégorie, sous-catégorie ou nom

**Jeux de concepts disponibles**

| Catégorie | Sous-catégorie | Nom | |
| --- | --- | --- | --- |
| Signes vitaux | Autres signes vitaux | **Température corporelle** | ⊕ |
| Signes vitaux | Autres signes vitaux | **Poids corporel** | ⊕ |
| Laboratoire | Bilan hépatique | **Albumine** | ⊕ |

**Jeux de concepts du projet** (4)

| | Groupe | Catégorie | Sous-catégorie | Nom |
| --- | --- | --- | --- | --- |
| ⊖ | Constantes | Signes vitaux | Hémodynamique | **Fréquence cardiaque** |
| ⊖ | Constantes | Signes vitaux | Hémodynamique | **Pression artérielle** |
| ⊖ | Laboratoire | Laboratoire | Autres labos | **Créatinine** |
| ⊖ | Laboratoire | Laboratoire | Bilan hépatique | **Bilirubine** |

### Groupes et règles d’éligibilité

Les jeux de concepts d’un projet sont organisés en **groupes** nommés. Chaque groupe porte une **règle** d’éligibilité qui documente la manière d’interpréter ce groupe lorsqu’on évalue si un centre de données peut supporter le projet :

- **Tous obligatoires** — chaque jeu de concepts du groupe doit être couvert par le mapping du centre. À utiliser pour les variables non négociables (ex. : fréquence cardiaque, pression artérielle).
- **Au moins un** — au moins un jeu de concepts du groupe doit être couvert. À utiliser pour des alternatives cliniquement équivalentes (ex. : un groupe « anticoagulants » : avoir un seul anticoagulant mappé suffit à être éligible).
- **Optionnel** — le groupe est informatif ; aucun jeu n’est requis. À utiliser pour les variables nice-to-have.

#### Gérer les groupes en mode édition

Une barre d’outils en haut de l’onglet variables liste chaque groupe sur une ligne, avec les contrôles pour ajouter, renommer (✎), réordonner (↑↓) ou supprimer (🗑) un groupe, changer sa règle via un menu déroulant, et sélectionner le groupe actif (celui dans lequel atterrissent les nouveaux jeux de concepts — mis en évidence par un contour bleu).

La barre d’outils des groupes (**Groupes**, avec un bouton **Ajouter un groupe**), ici avec *Constantes* actif :

| Groupe | Règle | Actions |
|---|---|---|
| **Constantes** (12) — actif | Tous obligatoires | ✎ ↑ ↓ 🗑 |
| **Anticoagulants** (8) | Au moins un | ✎ ↑ ↓ 🗑 |

Le menu de règle propose **Tous obligatoires**, **Au moins un** et **Optionnel**.

#### Réaffecter des jeux de concepts à un autre groupe

Cochez la case d’une ou plusieurs lignes du panneau projet pour faire apparaître une barre d’action au-dessus du tableau. Choisissez un groupe cible et cliquez sur **Déplacer** — les jeux de concepts sélectionnés sont réassignés à ce groupe. En mode lecture, vous pouvez aussi cliquer sur la pastille de groupe d’une seule ligne pour choisir un autre groupe via un menu déroulant ancré.

La barre d’action groupée : *1 sélectionné* · **Déplacer vers** [Constantes ▾] · **Déplacer**

> [!NOTE]
> **Bonne pratique**\
> Incluez tous les jeux de concepts nécessaires à votre analyse, même ceux utilisés uniquement pour l’ajustement ou la stratification. Utilisez les règles de groupes pour exprimer ce qui est obligatoire vs. nice-to-have — cela permet aux centres de voir d’un coup d’œil s’ils peuvent supporter le projet avec leur mapping OMOP actuel.

### Mettre à jour un jeu de concepts épinglé

Les versions des jeux de concepts sont épinglées par projet pour que les anciens rapports restent reproductibles. Quand un jeu a une version plus récente, un badge *Obsolète* apparaît dans la colonne « Mise à jour ». Cliquez-le pour examiner le différentiel et décider de mettre à jour ou non :

Le modal **Mettre à jour le concept set** :

> **Heart rate** `v1.0.0` → `v1.1.0`
>
> Concepts résolus : **10** → **12** · **+3** ajoutés · **−1** retirés
>
> **Ajoutés (3)**
>
> - ➕ `4244396` Heart rate by palpation — SNOMED
> - ➕ `4239408` Heart rate by EKG — SNOMED
>
> **Retirés (1)**
>
> - ➖ `4034850` Pulse rate (deprecated) — SNOMED

Boutons : **Annuler**, **Mettre à jour**.

Le modal liste les concepts résolus **ajoutés** dans la dernière version (vert) et ceux qui ont été **retirés** (rouge), pour que vous puissiez évaluer l’impact sur votre analyse avant de valider. Confirmer ne met à jour que ce jeu de concepts dans le projet — les autres versions épinglées ne sont pas affectées.

## Export

La vue détaillée du projet propose deux options d’export :

### Export JSON

Cliquez sur le bouton **Export** dans l’en-tête du projet pour exporter la définition du projet en JSON. Vous pouvez télécharger le fichier, copier dans le presse-papiers ou proposer des modifications sur {{forge.name}}.

Le modal **Exporter le projet** :

| Option | Description |
|---|---|
| **Télécharger le fichier** | Télécharger en tant que fichier JSON |
| **Copier dans le presse-papiers** | Copier le JSON du projet dans le presse-papiers |
| **Proposer sur {{forge.name}}** | Copier dans le presse-papiers et ouvrir l’éditeur {{forge.name}} |

### Export CSV

Dans l’onglet Jeux de concepts (mode lecture), cliquez sur le bouton **CSV** pour télécharger tous les concepts OMOP des jeux du projet en fichier CSV. L’export inclut les métadonnées du jeu (ID, nom, catégorie, sous-catégorie) et les options de l’expression (exclu, descendants, mappé) pour chaque concept.
