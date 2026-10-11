<!-- TODO(v2): v1 access path (gear menu in the header). In v2 Dev Tools is a sidebar entry; update with the v2 Dev Tools page. -->

# Dev Tools

Access via the Settings button (gear icon) in the top-right corner of the header → Dev Tools.

The Dev Tools page provides advanced features for developers and power users.

## SQL Editor

Query the OHDSI vocabulary database directly using SQL.

A dropdown provides pre-built example queries.

Results are displayed in a datatable with an option to export as CSV.

The toolbar holds the example-queries dropdown (*-- Example queries --*) and the **Run** button (Ctrl+Enter); the editor sits on the left and the results on the right (*50 rows*, with a **CSV** download button):

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

## Schema / ERD

View the database schema and entity-relationship diagram for the vocabulary tables.
