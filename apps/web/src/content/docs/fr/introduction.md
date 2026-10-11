# Introduction

Le **{{app.name}}** est une application web permettant de parcourir, relire et contribuer à une bibliothèque de jeux de concepts cliniques standardisés pour la réanimation. Il utilise le modèle OMOP CDM pour harmoniser les données de soins intensifs à travers les institutions européennes.

> [!NOTE]
> **Qu’est-ce qu’INDICATE ?**\
> [INDICATE](https://indicate-europe.eu/) est une initiative européenne lancée en décembre 2024, cofinancée par le programme Europe Numérique de l’UE (Convention n° 101167778). Le projet vise à construire une infrastructure fédérée pour le partage sécurisé de données de réanimation à travers 15 fournisseurs dans 12 pays.

## Pourquoi un dictionnaire de données ?

Même avec des terminologies standardisées comme LOINC et SNOMED CT, une seule idée clinique (ex. « Fréquence cardiaque ») peut être représentée par des centaines de concepts standards distincts. Le dictionnaire fournit des **jeux de concepts** expertisés, conformes à la [Spécification OHDSI des Concept Sets](https://ohdsi.github.io/TAB/Concept-Set-Specification.html).

## Fonctionnalités principales

- **Navigateur de jeux de concepts** — Parcourez les jeux de concepts par catégorie clinique : signes vitaux, biologie, pathologies, médicaments, ventilation, etc.
- **Explorateur de concepts** — Naviguez dans chaque jeu de concepts, consultez les détails de chaque concept avec des liens vers ATHENA et FHIR, et explorez les hiérarchies de vocabulaires.
- **Recommandations d’experts** — Chaque jeu de concepts inclut des commentaires cliniques en Markdown pour guider l’ETL.
- **Statistiques de référence** — Distributions attendues (histogrammes, percentiles) pour la validation des données.
- **Relecture par les pairs** — Soumettez des relectures avec suivi de statut et proposez des modifications via {{forge.name}}.
- **Projets** — Organisez les jeux de concepts en projets de recherche et exportez les listes en CSV.

## À qui s’adresse cette application ?

- **Cliniciens & Chercheurs** — Apportez votre expertise sur les définitions des concepts, relisez leur pertinence, et utilisez les jeux de concepts pour la conception d’études et la définition de cohortes.
- **Data Scientists** — Construisez des pipelines ETL et des requêtes fédérées avec des jeux validés.
- **Ingénieurs de données** — Mappez vos données sources vers l’OMOP CDM avec les jeux recommandés.

## À propos du projet

Les définitions des jeux de concepts ont été développées par un processus itératif de consensus. Les responsables de cas d’usage ont d’abord identifié les variables nécessaires à leurs applications cliniques. Ces exigences ont été affinées lors de réunions bimensuelles interdisciplinaires réunissant experts cliniques, data scientists et spécialistes d’interopérabilité.

La bibliothèque comprend actuellement plus de 330 jeux de concepts organisés en neuf catégories. Tout le contenu est open source sur [{{forge.name}}]({{repository.url}}). En savoir plus sur [indicate-europe.eu](https://indicate-europe.eu/).
