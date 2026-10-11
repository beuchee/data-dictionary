# Les jeux de concepts

Un **jeu de concepts** (concept set) est une collection réutilisable de concepts de vocabulaire OMOP définissant une variable clinique (ex. « Fréquence cardiaque », « Créatinine sérique », « Norépinéphrine »). Plutôt que de manipuler des codes LOINC ou SNOMED individuels, les chercheurs et ingénieurs de données travaillent avec des jeux de concepts qui regroupent les codes associés sous des étiquettes cliniques intuitives.

## La Spécification OHDSI

Chaque jeu de concepts suit la [Spécification OHDSI des Concept Sets](https://ohdsi.github.io/TAB/Concept-Set-Specification.html), le format standard utilisé par ATLAS et l’écosystème OHDSI. Une expression de jeu de concepts est une liste d’éléments, où chacun référence un concept OMOP et possède trois options booléennes :

- **Exclure** — Retirer ce concept (et optionnellement ses descendants) du jeu
- **Descendants** — Inclure tous les concepts descendants dans la hiérarchie du vocabulaire
- **Mappé** — Inclure les concepts liés par des relations « Maps to »

> [!NOTE]
> **Expression vs. Résolus**\
> L’**expression** est ce que vous rédigez — une liste compacte de concepts sélectionnés avec leurs options. Le **jeu résolu** est le résultat étendu après application des descendants, mappés et exclusions. Par exemple, une expression avec un seul concept de classification LOINC + Descendants peut se résoudre en des dizaines de codes de mesure spécifiques.

## Métadonnées étendues

Au-delà de la spécification OHDSI standard, chaque jeu de concepts de la bibliothèque {{app.name}} inclut des métadonnées supplémentaires :

- **Version** — Versioning sémantique (ex. 1.0.0) avec un historique des versions
- **Statut de relecture** — Brouillon, En attente de relecture, Approuvé, À réviser ou Obsolète
- **Informations auteur** — Nom, affiliation, profession, ORCID
- **Traductions** — Nom, catégorie et sous-catégorie multilingues (actuellement anglais et français, extensible à d’autres langues)
- **Commentaires d’experts** — Champ Markdown pour les recommandations cliniques et ETL
- **Profils statistiques** — Distributions attendues pour la validation des données
- **Historique de relectures** — Nom du relecteur, date, statut et commentaires pour chaque relecture

## Catégories

Les jeux de concepts sont organisés en neuf catégories cliniques :

- Démographie & Rencontres
- Pathologies (diagnostics)
- Observations cliniques (échelles d’évaluation)
- Signes vitaux
- Biologie
- Microbiologie
- Ventilation
- Médicaments
- Procédures

## Cas d’utilisation

Ces jeux de concepts expertisés, relus et versionnés peuvent être utilisés pour :

- **Définition de cohortes** — Comme briques de base dans ATLAS ou des requêtes personnalisées
- **Développement ETL** — Pour prioriser et valider les mappings de concepts
- **Faisabilité d’études** — Pour évaluer la disponibilité des données dans un réseau fédéré
