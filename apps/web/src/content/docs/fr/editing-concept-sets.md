<!-- TODO(v2): describes v1 editing (edits kept in the browser's localStorage, exported or proposed on {{forge.name}} by hand). Rewrite when v2 editing lands: server drafts, roles, automatic PR/MR. The expression flags and resolution algorithm stay valid. -->

# Modifier les jeux de concepts

Toutes les modifications sont sauvegardées dans le stockage local de votre navigateur. Elles persistent entre les sessions mais sont liées à votre navigateur.

> [!WARNING]
> **Avertissement stockage local**\
> Si vous effacez les données de votre navigateur, les modifications locales seront perdues. Pensez à **exporter** votre travail en JSON et/ou **proposer des modifications sur {{forge.name}}** via une pull request pour les préserver. Voir [Exporter](?section=exporting) et [Relecture & {{forge.name}}](?section=reviewing).

Cette section couvre deux niveaux d’édition : d’abord, la gestion de la liste des jeux de concepts (ajout, suppression, renommage) ; puis, l’édition des détails d’un jeu de concepts (expression, commentaires, statistiques).

## Modifier la liste des jeux de concepts

Ces actions s’appliquent au tableau principal du Dictionnaire de données.

### Entrer en mode édition

Cliquez sur le bouton **Éditer** dans la barre d’outils (à côté de **Exporter**).

La barre d’outils change pour afficher les contrôles de sélection, d’ajout et de sauvegarde/annulation : **Tout sélectionner**, **Désélectionner**, **Supprimer** (icône corbeille), un compteur *0 sélectionné(s)*, **Annuler**, **Enregistrer** et **Ajouter un jeu de concepts**.

### Ajouter un jeu de concepts

En mode édition, cliquez sur **Ajouter un jeu de concepts** (bouton vert). Un modal s’ouvre où vous fournissez un nom et une catégorie (obligatoires), et optionnellement une sous-catégorie et une description. Utilisez le bouton **+** à côté de la catégorie ou sous-catégorie pour en créer une nouvelle.

Le modal **Nouveau jeu de concepts**, rempli :

| Champ | Exemple |
|---|---|
| Nom * | Heart rate |
| Catégorie * | Signes vitaux (**+** pour en créer une) |
| Sous-catégorie | Hémodynamique (**+** pour en créer une) |
| Description | Nombre de battements cardiaques par minute (bpm). |

Boutons : **Annuler**, **Créer**.

### Sélectionner, modifier & supprimer

En mode édition, deux colonnes supplémentaires apparaissent sur chaque ligne : une **case à cocher** pour la sélection et une **icône crayon** pour modifier ce jeu.

| ☐ | ✎ | Catégorie | Sous-catégorie | Nom | Version | Statut |
|:-:|:-:|---|---|---|:-:|:-:|
| ☐ | ✎ | Signes vitaux | Hémodynamique | **Fréquence cardiaque** | 1.0.1 | Approuvé |
| ☑ | ✎ | Signes vitaux | Hémodynamique | **Pression artérielle systolique** | 1.0.0 | Approuvé |
| ☐ | ✎ | Signes vitaux | Hémodynamique | **Pression artérielle moyenne** | 1.0.0 | Brouillon |

- ✎ **Modifier** — Ouvre le modal d’édition (même formulaire que « Nouveau jeu de concepts », pré-rempli).
- **Tout sélectionner / Désélectionner** — Basculer la sélection sur toutes les lignes.
- **Supprimer** (icône corbeille) — Supprimer les jeux de concepts sélectionnés.

### Enregistrer & Annuler

Toutes les modifications en mode édition sont en attente jusqu’à ce que vous agissiez explicitement :

- **Enregistrer** — Valide toutes les modifications en attente dans le stockage local
- **Annuler** — Annule toutes les modifications, restaurant la liste à son état avant l’entrée en mode édition. Cela défait tout : ajouts, modifications et suppressions.

## Modifier les détails d’un jeu de concepts

Ouvrez un jeu de concepts, puis cliquez sur **Éditer** dans l’en-tête. Les boutons Éditer et Exporter sont remplacés par **Importer**, **Annuler** et **Enregistrer**.

### Options de l’expression

Chaque concept de l’expression a trois options que vous pouvez basculer directement dans le tableau. Ces options suivent la [Spécification OHDSI des Concept Sets](https://ohdsi.github.io/TAB/Concept-Set-Specification.html) :

*Exemple : expression Fréquence cardiaque en mode édition. Les interrupteurs contrôlent chaque option. L’icône corbeille supprime un élément.*

| Vocabulaire | Nom du concept | Classe | Standard | Exclure | Desc. | Mappé | |
|---|---|---|---|:-:|:-:|:-:|:-:|
| LOINC | Heart rate | LOINC Hierarchy | Classification | non | oui | oui | 🗑 |
| SNOMED | Heart rate | Observable Entity | Standard | non | oui | oui | 🗑 |
| SNOMED | Fetal heart rate | Observable Entity | Standard | **oui** | oui | oui | 🗑 |
| LOINC | Heart rate at First encounter | Clinical Observation | Standard | **oui** | oui | oui | 🗑 |
| … 38 éléments au total | | | | | | | |

**Descendants** — Lorsque coché, tous les concepts descendants dans la hiérarchie du vocabulaire sont automatiquement inclus. Les vocabulaires OMOP organisent les concepts en arbres hiérarchiques via les relations « Is a » / « Subsumes » (stockées dans la table CONCEPT_ANCESTOR). Par exemple, le concept hiérarchique LOINC « Heart rate » a des dizaines de descendants comme « Heart rate ––resting », « Heart rate ––sitting », « Heart rate by Pulse oximetry », etc. Cocher Descendants sur un concept parent les capture tous sans les lister individuellement.

**Mappé** — Lorsque coché, les concepts non standards liés au concept sélectionné via les relations « Maps to » / « Mapped from » sont également inclus. Dans le vocabulaire OMOP, chaque idée clinique a un seul concept désigné **Standard** (marqué « S »). Les autres codes de vocabulaire représentant la même idée sont **non standards** et liés au concept Standard via « Maps to ». Par exemple, SNOMED « Heart rate » (ID 4239408, non standard) mappe vers LOINC « Heart rate » (ID 3027018, Standard). Cocher Mappé garantit que les concepts non standards d’autres vocabulaires sont capturés avec le concept standard.

**Exclure** — Lorsque coché, ce concept est retiré du jeu résolu. Si Descendants est également coché, tous ses descendants sont aussi exclus. Cela permet d’inclure un concept parent large avec ses descendants, puis d’exclure sélectivement certaines branches. Par exemple, dans le jeu Fréquence cardiaque, « Fetal heart rate » est exclu avec Descendants pour retirer les mesures spécifiques au fœtus.

> [!NOTE]
> **Algorithme de résolution**\
> Le jeu de concepts est résolu en trois étapes :
> 1. Construire l’**ensemble d’inclusion** à partir de tous les éléments où Exclure est décoché, en étendant via Descendants et Mappé selon la configuration
> 2. Construire l’**ensemble d’exclusion** à partir des éléments où Exclure est coché, avec la même logique d’expansion
> 3. Résultat final = **ensemble d’inclusion moins ensemble d’exclusion**

### Ajouter des concepts

En mode édition, la barre d’outils de l’expression affiche des boutons supplémentaires : **Tout sélectionner**, **Désélectionner**, **Supprimer** (icône corbeille), un compteur *0 sélectionné(s)*, **Ajouter des concepts** et **Optimiser**.

Cliquez sur **Ajouter des concepts** pour ouvrir un modal plein écran avec deux onglets, **Vocabulaires OHDSI** et **Concept personnalisé** :

- **Vocabulaires OHDSI** — Recherchez et ajoutez des concepts OMOP standards depuis la base de vocabulaires OHDSI (SNOMED, LOINC, RxNorm, etc.). C’est la méthode principale pour construire les expressions.
- **Concept personnalisé** — Créez manuellement un concept hors OMOP quand aucun concept standard n’existe. À utiliser en dernier recours — les concepts personnalisés ne sont pas interopérables avec l’écosystème OHDSI.

#### Vocabulaires OHDSI

Recherchez dans la base de vocabulaires OHDSI locale par nom, ID ou code. Nécessite l’[import des vocabulaires](?section=dictionary-settings). La recherche utilise une **correspondance floue** sur les noms.

La barre de recherche comporte le champ de saisie (*Rechercher par nom, code ou ID...*, ici `heart rate`), les boutons **Rechercher** et **Filtres**, et une case **Limite 10K** (cochée par défaut).

Le bouton **Filtres** ouvre un popup pour affiner les résultats :

| Filtre | Par défaut |
|---|---|
| Vocabulaire | Tous |
| Domaine | Tous |
| Classe | Tous |
| Standard | Standard |
| Valides uniq. | ☑ |

Boutons : **Effacer**, **Appliquer**.

**Limite 10K** limite les résultats à 10 000 pour éviter de surcharger le tableau.

Les résultats sont affichés dans un tableau avec filtres par colonne :

| ☐ | ID Concept | Nom du concept | Vocabulaire | Code | Domaine | Classe | Standard |
|:-:|--:|---|---|---|---|---|:-:|
| ☑ | 3027018 | Heart rate | LOINC | 8867-4 | Mesure | Clinical Observation | Standard |
| ☐ | 3040891 | Heart rate --resting | LOINC | 40443-4 | Mesure | Clinical Observation | Standard |
| ☐ | 3001376 | Heart rate by Pulse oximetry | LOINC | 8889-8 | Mesure | Clinical Observation | Standard |
| ☐ | 4239408 | Heart rate | SNOMED | 364075005 | Mesure | Observable Entity | Non-standard |

Sous le tableau, deux panneaux affichent les détails du concept sélectionné :

- **Détails du concept** — Métadonnées complètes, liens ATHENA et FHIR
- **Hiérarchie** — Graphe interactif des ancêtres, descendants et concepts liés

En bas, configurez les options et ajoutez le(s) concept(s) sélectionné(s) : une case **Sélection multiple**, les interrupteurs **Exclure**, **Descendants** et **Mappé**, un compteur *1 sélectionné* et le bouton **Ajouter des concepts**.

Cochez **Sélection multiple** pour sélectionner plusieurs concepts avec les cases à cocher du tableau, puis les ajouter en une seule fois.

#### Concept personnalisé

Créez des concepts hors OMOP quand aucun concept standard n’existe. À utiliser avec parcimonie.

| Champ | Exemple | Remarque |
|---|---|---|
| ID Concept | 2100000003 | Auto-attribué à partir de 2 100 000 000 |
| Nom du concept * | ICDSC Score | |
| Domaine * | Measurement | |
| Vocabulaire | {{customVocabulary.id}} | Les concepts personnalisés utilisent le vocabulaire {{customVocabulary.id}} |
| Classe * | Clinical Observation | |
| Code du concept | | *Code du concept (optionnel)...* |
| Standard Concept | Non-standard | |

Seule l’option **Exclure** est disponible pour les concepts personnalisés, car Descendants et Mappé reposent sur des relations de vocabulaire OMOP inexistantes pour les entrées personnalisées. Le pied du modal n’affiche alors que l’interrupteur **Exclure** et le bouton **Ajouter le concept**.

### Importer un JSON

Cliquez sur **Importer** (bouton violet) pour coller une expression au format ATLAS ou INDICATE. L’importateur accepte les noms de champs en MAJUSCULES (ATLAS) et en camelCase (INDICATE), déduplique par ID de concept, et rapporte les compteurs d’ajouts/ignorés.

### Supprimer des concepts

Utilisez l’icône corbeille sur chaque ligne, ou sélectionnez plusieurs lignes avec les cases à cocher et cliquez sur le bouton rouge corbeille dans la barre d’outils.

### Optimiser l’expression

Cliquez sur **Optimiser** pour simplifier l’expression en utilisant l’analyse de la hiérarchie du vocabulaire (nécessite une base de vocabulaires OHDSI). L’optimiseur :

- Supprime les descendants déjà couverts par l’option « Inclure les descendants » d’un parent (descendant)
- Supprime les éléments parents qui n’élargissent pas le périmètre (ascendant)
- Affiche une comparaison avant/après avec les éléments qui seraient supprimés ou ajoutés
- Avertit si l’optimisation modifie le jeu résolu

### Modifier les commentaires

Dans l’onglet Commentaires, le mode édition ouvre un éditeur ACE avec coloration syntaxique Markdown et un panneau d’aperçu en direct. Utilisez Cmd/Ctrl+S pour enregistrer. Les commentaires sont stockés par langue.

### Modifier les statistiques

Dans l’onglet Statistiques, le mode édition ouvre un éditeur JSON. Un modèle avec la structure attendue est fourni. Vous pouvez définir des données numériques (min, max, moyenne, médiane, ÉT, percentiles, histogramme), des données catégorielles, la fréquence de mesure et des profils de population multiples.

### Version & Statut

Lors de l’enregistrement des modifications, vous pouvez mettre à jour la version (suggestion : incrément patch) et ajouter un résumé de version. Le statut de relecture peut être modifié via le badge de statut dans l’en-tête.
