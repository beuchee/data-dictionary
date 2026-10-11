<!-- TODO(v2): v1 detail view. Rewrite against the v2 detail page once it lands: the edit mode, the "Propose on {{forge.name}}" button and the local review storage change in v2 (server drafts, automatic PR/MR). -->

# Détails d’un jeu de concepts

La vue détaillée affiche toutes les informations d’un jeu de concepts, organisées en quatre onglets : **Concepts**, **Commentaires**, **Statistiques** et **Relecture**.

## Onglet Concepts

Cet onglet propose deux modes, accessibles via un commutateur : **Expression** et **Résolus**.

### Mode Expression

Affiche l’expression du jeu de concepts — les éléments rédigés avec leurs options.

Chaque ligne affiche le Vocabulaire, le Nom du concept, le Code, le Domaine, la Classe de concept, le statut Standard, et trois options booléennes : **Exclure**, **Descendants** et **Mappé**.

Ces options contrôlent la résolution de l’expression en jeu final de concepts. Voir [Modifier un jeu de concepts](?section=editing-concept-sets) pour les explications détaillées.

Utilisez les filtres de colonnes (vocabulaire, domaine, standard, recherche floue par nom) pour naviguer dans les expressions volumineuses.

*Exemple : expression du jeu de concepts Fréquence cardiaque.*

| Vocabulaire | Nom du concept | Domaine | Standard | Exclure | Desc. | Mappé |
|---|---|---|---|:-:|:-:|:-:|
| LOINC | Heart rate | Mesure | Classification | No | Yes | Yes |
| LOINC | Heart rate.beat-to-beat \| Heart | Mesure | Classification | No | Yes | Yes |
| SNOMED | Heart rate | Mesure | Standard | No | Yes | Yes |
| SNOMED | Resting heart rate | Mesure | Standard | No | Yes | Yes |
| SNOMED | Fetal heart rate | Mesure | Standard | **Yes** | **Yes** | **Yes** |
| LOINC | Heart rate at First encounter | Mesure | Standard | **Yes** | **Yes** | **Yes** |
| … 38 éléments au total | | | | | | |

### Mode Résolus

Affiche le résultat étendu après application de toute la logique de l’expression. C’est l’ensemble réel de concepts OMOP qui serait utilisé dans une requête. Les colonnes incluent ID du concept, Vocabulaire, Nom, Code, Domaine, Standard et Classe de concept.

Si une base de vocabulaires OHDSI est chargée (voir [Vocabulaires OHDSI](?section=dictionary-settings)), la résolution est calculée en temps réel dans le navigateur. Sinon, les jeux résolus pré-calculés du dépôt sont utilisés.

*Exemple : jeu résolu Fréquence cardiaque — les concepts OMOP standards après expansion.*

| ID Concept | Vocabulaire | Nom du concept | Code | Standard |
|--:|---|---|---|---|
| 3027018 | LOINC | Heart rate | 8867-4 | Standard |
| 36303943 | LOINC | Heart rate --W exercise | 89273-7 | Standard |
| 36305351 | LOINC | Heart rate --during anesthesia | 89278-6 | Standard |
| 3040891 | LOINC | Heart rate --resting | 40443-4 | Standard |
| 40771525 | LOINC | Heart rate --sitting | 69001-6 | Standard |
| 3001376 | LOINC | Heart rate by Pulse oximetry | 8889-8 | Standard |
| 40481601 | SNOMED | Resting heart rate | 444981005 | Standard |
| 35610095 | SNOMED | Heart rate at cardiac apex | 429525003 | Standard |
| … 23 concepts standards résolus (63 au total) | | | | |

### Panneau de détail concept

Cliquez sur un concept pour afficher le panneau de détails. Il contient trois sections :

*Exemple : « Heart rate --W exercise » (LOINC 89273-7).*

**Détails du concept**

| Champ | Valeur |
|---|---|
| Concept Name | Heart rate --W exercise |
| OMOP Concept ID | 36303943 |
| Vocabulary ID | LOINC |
| FHIR Resource | LOINC |
| Concept Code | 89273-7 |
| Standard | Standard |
| Domain | Measurement |
| Validity | Valid |
| Concept Class | Clinical Observation |

**Related**

| Relation | Nom du concept | Vocabulaire | Classe |
|---|---|---|---|
| Is a | Heart rate \| XXX \| Heart rate taken in specific position | LOINC | LOINC Hierarchy |
| Is a | Heart rate positional molecular | LOINC | LOINC Class |
| Has component | Heart rate^W exercise | LOINC | LOINC Component |
| Has property | Number Rate | LOINC | LOINC Property |
| Maps to | Heart rate --W exercise | LOINC | Clinical Observation |

**Hiérarchie** (ancêtres en haut, concept sélectionné en bas)

```text
General heart rate [LOINC]
└── Specific heart rate [LOINC]
    ├── Heart rate taken in specific position [LOINC]
    │   └── Heart rate --W exercise [LOINC]   ← sélectionné
    └── Heart rate positional molecular [LOINC]
        └── Heart rate --W exercise [LOINC]   ← sélectionné
```

**Synonymes**

| Synonyme | Langue |
|---|---|
| Heart rate - W exercise | English |
| Heart rate W exercise | English |
| 心率^采用运动:计数型速率:时间点:XXX:定量型 | Chinese |

La grille **Détails du concept** affiche toutes les métadonnées, avec des liens vers [ATHENA](https://athena.ohdsi.org/) (via l’ID du concept) et le [serveur de terminologie FHIR](https://tx.fhir.org/r4/) (via la Ressource FHIR).

Trois onglets sous les métadonnées fournissent des informations complémentaires :

- **Related** — Relations avec d’autres concepts (Is a, Has component, Maps to, etc.). Filtrables par type de relation, vocabulaire et nom.
- **Hiérarchie** — Graphe interactif force-directed (vis.js) montrant ancêtres, descendants et concepts liés. Cliquez sur un nœud pour naviguer vers ce concept.
- **Synonymes** — Noms alternatifs du concept depuis le vocabulaire OMOP (y compris des traductions dans d’autres langues).

## Onglet Commentaires

Affiche les recommandations d’experts en Markdown. Les commentaires décrivent généralement :

- La signification clinique et le contexte du jeu de concepts
- Quels concepts privilégier dans des scénarios spécifiques
- Les pièges courants lors de l’ETL
- Les différences entre concepts similaires de différents vocabulaires

En mode édition, un éditeur double panneau avec aperçu Markdown en direct est disponible.

*Exemple : commentaires du jeu Fréquence cardiaque (condensé).*

> **Définition & Contexte clinique**
>
> La fréquence cardiaque est le nombre de battements par minute (bpm). Valeurs normales : 60–100 bpm chez l’adulte, 110–160 bpm chez le nouveau-né. Ce jeu capture uniquement les valeurs numériques, excluant la morphologie du pouls, la classification du rythme et la fréquence cardiaque fœtale.
>
> **Concepts inclus**
>
> 22 concepts standards (20 LOINC + 2 SNOMED) organisés par contexte :
>
> - **Général** — *3027018 / 8867-4 Heart rate* : concept par défaut
> - **Par méthode** — ex. *3001376 / 8889-8 Heart rate by Pulse oximetry*, *21490670 / 60978-4 Heart rate Intra arterial line*
> - **Par position** — ex. *40771524 / 68999-2 Heart rate ––supine*
> - **Par condition** — ex. *3040891 / 40443-4 Heart rate ––resting*
> - **Dépistage néonatal** — oxymétrie pré- et post-ductale
>
> **Concepts exclus**
>
> - **Forme d’onde & intensité du pouls** — observations morphologiques
> - **Fréquence cardiaque fœtale** — jeu de concepts dédié
> - **Agrégats temporels** — résumés Holter/télémétrie
> - **Différences calculées** — ex. delta orthostatique
>
> **Notes de mapping**
>
> - **Par défaut** : « HR », « Pouls », « FC » → *Heart rate (3027018)*
> - **SpO2** : « SpO2 PR », « Pleth HR » → *Heart rate by Pulse oximetry (3001376)*
> - **Ligne artérielle** : « Art line HR » → *Heart rate Intra arterial line (21490670)*

Pour les recommandations plus générales concernant plusieurs jeux de concepts (bonnes pratiques ETL, stratégies de mapping), consultez la page [Recommandations de mapping](?section=mapping-recommendations).

## Onglet Statistiques

> [!WARNING]
> **En cours de développement**\
> Cette fonctionnalité est encore en discussion et n’a pas encore été mise en œuvre en pratique. Le format et le contenu des profils statistiques pourront évoluer.

Affiche les distributions attendues des données pour aider à valider vos données lors de l’ETL :

- **Données numériques** — Min, P5, P25 (Q1), Médiane, Moyenne, P75 (Q3), P95, Max, ÉT, CV
- **Histogrammes** — Diagrammes en barres horizontales de la distribution des valeurs
- **Données catégorielles** — Catégories avec effectifs et pourcentages
- **Profils multiples** — ex. Adulte, Enfant, Nouveau-né avec des plages de référence différentes
- **Fréquence de mesure** — Intervalle d’enregistrement typique (horaire, quotidien, etc.)

## Onglet Relecture

Affiche l’historique des relectures pour ce jeu de concepts. Chaque relecture enregistre le relecteur, la date, le statut, la version relue et les commentaires.

Le panneau **Relectures** les liste dans un tableau, surmonté des boutons **Proposer sur {{forge.name}}** et **Ajouter une relecture** :

| Relecteur | Date | Statut | Version | Commentaires |
|---|---|---|---|---|
| Jane Smith | 2026-03-15 | Approuvé | 1.0.1 | Jeu de concepts complet. Bonne couverture de la hiérarchie LOINC. L’exclusion de la fréquence cardiaque fœtale dans un jeu dédié est pertinente, car la FC fœtale est enregistrée au niveau maternel et pourrait être confondue avec celle de la mère lors de l’alignement des données. |
| John Doe | 2026-01-10 | À réviser | 1.0.0 | La fréquence cardiaque fœtale devrait être exclue de ce jeu. Elle est enregistrée au niveau maternel (dans le dossier obstétrical de la mère), ce qui crée un risque de confusion avec la FC de la mère. Je suggère de la déplacer dans un jeu de concepts dédié pour éviter de mélanger les valeurs fœtales et maternelles lors de l’alignement. |

Voir [Relecture & {{forge.name}}](?section=reviewing) pour le workflow complet de soumission de relectures et de proposition de modifications sur {{forge.name}}.

## Métadonnées de l’en-tête

L’en-tête de la vue détaillée affiche :

- **Badge de version** — Cliquez pour afficher l’historique des versions
- **Badge de statut de relecture** — Cliquez pour modifier le statut (en mode édition)
- **Exporter** — Télécharger ou copier en JSON, proposer sur {{forge.name}}, ou générer une requête SQL OMOP avec conversions d’unités (voir [Exporter](?section=exporting))
