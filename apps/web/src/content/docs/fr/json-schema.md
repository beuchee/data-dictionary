<!-- TODO(docs): the structure below is v1's and predates cross-repo sharing: metadata.organization is now {created, current} and metadata.sourceRepo exists (see concept_set.example.json and docs/data-formats.md). Update it with the v2 format docs. -->

# Schéma JSON

Chaque jeu de concepts est stocké dans un fichier unique `concept_sets/{id}.json`. Ces fichiers suivent la [OHDSI Concept Set Specification](https://ohdsi.github.io/TAB/Concept-Set-Specification.html), avec des extensions propres à INDICATE regroupées sous `metadata`. Un fichier exemple complet et commenté se trouve à la racine du dépôt : [`concept_set.example.json`]({{repository.blobUrl}}/concept_set.example.json).

## Structure

```jsonc
{
  "id": 10,
  "name": "...",              // mirror of metadata.translations.en.name
  "description": "...",       // mirror of metadata.translations.en.shortDescription
  "version": "1.0.0",         // semantic versioning
  "createdBy": "...",
  "createdDate": "2026-01-01",
  "modifiedBy": "...",
  "modifiedDate": "2026-01-01",
  "createdByTool": "...",
  "expression": {
    "items": [
      {
        "concept": {
          "conceptId": 3027018,
          "conceptName": "Heart rate",
          "vocabularyId": "LOINC",
          "domainId": "Measurement",
          "conceptClassId": "...",
          "standardConcept": "S",      // S | C | null - read from the OMOP vocabulary
          "conceptCode": "8867-4",
          "validStartDate": "...",
          "validEndDate": "...",
          "invalidReason": null
        },
        "isExcluded": false,
        "includeDescendants": false,
        "includeMapped": false
      }
    ]
  },
  "tags": [],
  "metadata": {
    "uniqueId": "uuid",
    "organization": {
      "name": "...",
      "url": "..."
    },
    "reviewStatus": "draft",   // draft | pending_review | approved | needs_revision | deprecated
    "origin": null,
    "translations": {
      "en": {
        "name": "...",
        "category": "...",
        "subcategory": "...",
        "shortDescription": "...",
        "longDescription": "..."
      },
      "fr": {
        "name": "...",
        "category": "...",
        "subcategory": "...",
        "shortDescription": "...",
        "longDescription": "..."
      }
    },
    "createdByDetails": {
      "firstName": "...",
      "lastName": "...",
      "affiliation": "...",
      "profession": "...",
      "orcid": "..."
    },
    "reviews": [],
    "versions": [
      {
        "version": "1.0.0",
        "date": "2026-01-01",
        "author": "...",
        "message": "Initial version."
      }
    ],
    "distributionStats": null
  }
}
```

## Champs clés

- Les champs racine `name` / `description` reflètent la traduction anglaise (`metadata.translations.en.name` / `shortDescription`) et sont maintenus synchronisés par l’application.
- `version` : versionnage sémantique ; toute incrémentation est consignée dans `metadata.versions[]`.
- `expression.items[]` : chaque entrée référence un concept OMOP ainsi que trois indicateurs (`isExcluded`, `includeDescendants`, `includeMapped`).
- `metadata.translations` : organisé par langue (`en`, `fr`), chacune avec `name`, `category`, `subcategory`, `shortDescription`, `longDescription`. Il n’y a aucun repli d’une langue à l’autre.
- `metadata.reviewStatus` : l’une des valeurs `draft`, `pending_review`, `approved`, `needs_revision`, `deprecated`.
- `metadata.versions[]` : un journal des modifications. Chaque entrée est `{ version, date, author, message }`. C’est une extension INDICATE — la spécification OHDSI définit le champ `version` racine mais aucune structure de journal.
- `metadata.reviews[]` : l’historique des relectures (relecteur, date, statut, commentaires).
