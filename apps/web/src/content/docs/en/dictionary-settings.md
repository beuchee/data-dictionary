<!-- TODO(v2): v1 settings (gear menu → Dictionary Settings, unit tables edited in localStorage). Rewrite against the v2 settings pages once they land. -->

# Dictionary Settings

Access via the Settings button (gear icon) in the top-right corner of the header → Dictionary Settings.

The page has three tabs:

- **OHDSI Vocabularies** — import and manage the local vocabulary database
- **Unit Conversions** — conversion factors between measurement units
- **Recommended Units** — recommended unit per measurement concept

## OHDSI Vocabularies

The application can import OHDSI vocabulary files into a **DuckDB database that runs entirely in your browser**. This enables powerful features without requiring any server.

### What it Enables

- **Concept search** — Search OMOP concepts by name, ID, or code when adding concepts to expressions
- **Live resolution** — Resolve concept set expressions in real-time (expand descendants and mapped concepts)
- **Hierarchy visualization** — Interactive graphs of concept ancestors, descendants, and relationships
- **Expression optimization** — Simplify expressions using vocabulary hierarchy analysis
- **SQL queries** — Query the vocabulary database directly in the Dev Tools SQL editor

### How to Import

1. Download vocabulary files from [ATHENA](https://athena.ohdsi.org/vocabulary/list) (CSV or Parquet format)
2. Go to **Settings** (gear icon) → **Dictionary Settings** → **OHDSI Vocabularies** tab
3. Click **Select Vocabulary Folder** and choose the folder containing the vocabulary files
4. Wait for the import to complete — a progress bar shows per-file status

The import reads CONCEPT.csv, CONCEPT_RELATIONSHIP.csv, CONCEPT_ANCESTOR.csv, and related files, indexes them in DuckDB, and saves the database to browser storage.

### Re-importing and Deleting

To update the vocabulary database after downloading new files, delete the existing database and re-import by selecting the folder again.

- **Delete Database** — removes the local vocabulary database entirely
- **Select Vocabulary Folder** — re-import from the vocabulary files folder

## Unit Conversions

Manage conversion factors between measurement units.

The table shows source and target concepts with their units and conversion factors.

Use the column filters to search within each column.

### Actions

- **Add Conversion** — create a new conversion. Pick the concept and the source/target units with the built-in concept search (no manual ID typing), then enter the conversion factor and optional offset.
- **Edit factor** — click a conversion factor cell to edit it inline
- **Test** — open a calculator to verify the conversion (supports bidirectional swap)
- **Delete** — remove a conversion with confirmation

### Export

Click **Export** to open the export modal:

| Option | Description |
|---|---|
| **Download File** | Download as JSON file |
| **Copy to Clipboard** | Copy JSON to clipboard |

## Recommended Units

Define the recommended unit for each measurement concept.

This helps ensure consistent unit usage across the dictionary, and is used for automatic unit conversions when exporting concept sets as SQL.

Use the column filters to search within each column.

### Actions

- **Add Recommended Unit** — associate a concept with its recommended unit. Pick both the concept and the unit with the built-in concept search (no manual ID typing).
- **Delete** — remove a recommendation with confirmation

### Export

Click **Export** to open the export modal:

| Option | Description |
|---|---|
| **Download File** | Download as JSON file |
| **Copy to Clipboard** | Copy JSON to clipboard |

> [!NOTE]
> **Vocabulary Enrichment**\
> When an OHDSI vocabulary database is loaded, concept names in both tables are automatically resolved from the database. If the database is not yet ready when you open a tab, the application retries automatically.
