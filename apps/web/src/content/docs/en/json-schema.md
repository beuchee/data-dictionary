<!-- TODO(docs): the structure below is v1's and predates cross-repo sharing: metadata.organization is now {created, current} and metadata.sourceRepo exists (see concept_set.example.json and docs/data-formats.md). Update it with the v2 format docs. -->

# JSON Schema

Each concept set is stored as a single file `concept_sets/{id}.json`. These files follow the [OHDSI Concept Set Specification](https://ohdsi.github.io/TAB/Concept-Set-Specification.html), with INDICATE-specific extensions grouped under `metadata`. A complete, annotated example file lives at the repository root: [`concept_set.example.json`]({{repository.blobUrl}}/concept_set.example.json).

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

## Key fields

- Top-level `name` / `description` mirror the English translation (`metadata.translations.en.name` / `shortDescription`) and are kept in sync by the app.
- `version` : semantic versioning; bumping it is recorded in `metadata.versions[]`.
- `expression.items[]` : each entry references an OMOP concept plus three flags (`isExcluded`, `includeDescendants`, `includeMapped`).
- `metadata.translations` : language-first (`en`, `fr`), each with `name`, `category`, `subcategory`, `shortDescription`, `longDescription`. There is no cross-language fallback.
- `metadata.reviewStatus` : one of `draft`, `pending_review`, `approved`, `needs_revision`, `deprecated`.
- `metadata.versions[]` : a changelog. Each entry is `{ version, date, author, message }`. This is an INDICATE extension — the OHDSI specification defines the top-level `version` field but no changelog structure.
- `metadata.reviews[]` : review history (reviewer, date, status, comments).
