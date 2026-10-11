<!-- TODO(v2): v1 access path (gear menu in the header). In v2 Dev Tools is a sidebar entry; update with the v2 Dev Tools page. -->

# Outils de développement

Accès via le bouton Paramètres (engrenage) en haut à droite du header → Outils de développement.

La page Dev Tools fournit des fonctionnalités avancées pour les développeurs.

## Éditeur SQL

Interrogez directement la base de vocabulaires OHDSI en SQL.

Un menu déroulant propose des requêtes d’exemple préconstruites.

Les résultats s’affichent dans un datatable avec export CSV possible.

La barre d’outils comporte le menu des requêtes d’exemple (*-- Requêtes d’exemple --*) et le bouton **Run** (Ctrl+Enter) ; l’éditeur est à gauche et les résultats à droite (*50 rows*, avec un bouton de téléchargement **CSV**) :

```sql
SELECT concept_id, concept_name
FROM concept
WHERE standard_concept = 'S'
LIMIT 50
```

| concept_id | concept_name |
|--:|---|
| 4239408 | Systolic blood pressure |
| 4302666 | Heart rate |
| 37393863 | Body temperature |
| … | |

## Schéma / ERD

Visualisez le schéma de la base et le diagramme entité-relation des tables de vocabulaires.
