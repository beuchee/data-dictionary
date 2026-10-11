<!-- TODO(v2): v1 mapping projects (created, imported and stored in the browser's localStorage). In v2 this page keeps only the coverage evaluation of an imported mapping against the dictionary's projects (multi-format import: source_to_concept_map, SSSOM, Usagi, Linkr mapping projects…, see docs/planning/v2-plan.md §7); editing mappings stays in Linkr. Rewrite when that lands. -->

# Mapping projects

A **mapping project** is a local workspace where a data provider imports their `source_to_concept_map` (or any CSV with a column of OMOP `concept_id`) and checks, in seconds, which INDICATE projects their current OMOP mapping can support.

> [!NOTE]
> **Local data**\
> Mapping projects live entirely in your browser (`localStorage`). They are never uploaded to the repository — your source-to-concept map stays on your machine.

## Where to find it

Header navigation → **Concept Mapping** → *My mapping projects* tab.

Mapping projects are displayed as cards showing name, description and the number of concepts last imported. Click a card to open it.

Example card:

> **CHU Rennes — ICU mapping**
>
> Source-to-concept map exported from our OMOP ETL on 2026-05-17.
>
> 341 mapped concepts · 2026-05-17

## Creating a mapping project

Click **+ New mapping project**. The modal asks for a name and an optional description (both bilingual EN / FR, same convention as INDICATE projects — the language you type in is mirrored to the other locale when empty).

The **New mapping project** modal:

| Field | Example |
|---|---|
| Name * | CHU Rennes — ICU mapping |
| Description | Source-to-concept map exported from our OMOP ETL on 2026-05-17. |

Buttons: **Cancel**, **Create**.

## Importing a CSV

Open a mapping project and switch to the *Mapped concepts* tab. Use the **Import CSV** / **Re-import CSV** button at the top to upload a file. Three formats are auto-detected:

- **OMOP `source_to_concept_map`** — standard header with `source_code`, `source_concept_id`, `target_concept_id` etc.
- **CSV with a `concept_id` column** — any CSV that has at least one column named `concept_id` (or `target_concept_id` / `omop_concept_id`) with optional source columns.
- **Single-column list of `concept_id` values** — the simplest shape, no header required.

A preview shows the detected format, the total number of rows with a valid `concept_id`, and the unique count. Confirming commits the import; any previous mapping is replaced.

The **Import mapping CSV** modal (*OMOP source_to_concept_map · CSV with a concept_id column · single-column list of concept_ids — all auto-detected.*), after picking a **CSV file**:

> **OMOP source_to_concept_map**\
> 358 rows with a valid concept_id · **341** unique concepts

Buttons: **Cancel**, **Import**.

## The three internal tabs

### Overview

The dashboard opens with three counters: how many concepts you imported, how many were matched in the INDICATE dictionary, and how many INDICATE projects you are fully eligible for.

| Mapped concepts | Matched in dictionary | Eligible projects |
|:-:|:-:|:-:|
| **341** | **218** | **3 / 6** |

Below the counters, a grid of cards shows your eligibility against each INDICATE project, colour-coded by score:

- 🟩 **100%** all groups satisfied — fully eligible
- 🟨 **75–99%** mostly covered, some gaps
- 🟥 **<75%** significant gaps

| Score | Project | Description |
|:-:|---|---|
| 🟩 100% | **MIMIC-EU [Minimal]** | Atlas of anonymized Acute Care cases for aggregating ICU datasets and developing clinically relevant AI algorithms. |
| 🟨 82% | **Early Detection of Organ Failure [Minimal]** | Machine learning models that predict organ failure using time-series data for clinical evaluation. |
| 🟥 54% | **Prediction of Neonatal and Pediatric Sepsis [Minimal]** | Validates federated infrastructure for pediatric data access, focused on neonatal and pediatric sepsis. |

Click a card to jump to the Eligibility tab pre-filtered on that project.

### Mapped concepts

Datatable of every unique `concept_id` from your CSV. Columns: Vocabulary, `concept_id` (Athena link), Name, Domain, In dictionary (Yes / No).

| Vocabulary | concept_id | Name | Domain | In dictionary |
|---|--:|---|---|:-:|
| LOINC | 3013682 | **Heart rate** | Measurement | Yes |
| SNOMED | 4226798 | **Sepsis** | Condition | Yes |
| RxNorm | 19009166 | **Enoxaparin sodium** | Drug | No |
| LOINC | 3037556 | **Glucose [Mass/volume]** | Measurement | Yes |

Concepts that are not in any INDICATE concept set are looked up against the OHDSI vocabulary database you loaded in **General settings**. While that lookup is in flight, the cells show *Loading…*; if a concept is not in the vocabulary either, the cell falls back to *Not in vocabulary*. If you have never loaded a vocabulary, cells say *Load OHDSI vocabularies to resolve*.

### Eligibility

Pick an INDICATE project with the dropdown at the top. The table lists every concept set of that project with its group, group rule, the number of resolved concepts in that set, and a **Covered** / **Not covered** badge. A row is covered as soon as at least one of its resolved concepts is in your mapping — you do not need every concept of the set.

**Project:** MIMIC-EU [Minimal] ▾ — Coverage: 24 / 28 · Project score: 86%

| Group | Group rule | Concept set | Resolved | Status | Details |
|---|---|---|:-:|:-:|:-:|
| Vital signs | All required | **Heart rate** | 12 | ✓ Covered | 🔍 |
| Anticoagulants | At least one | **Enoxaparin** | 8 | ✓ Covered | 🔍 |
| Anticoagulants | At least one | **Heparin sodium** | 5 | ✗ Not covered | 🔍 |

Click the magnifier in the last column to open a per-concept-set details modal showing the concepts you already have locally (green) versus the other concepts in the set (grey). Click a row anywhere else to jump to the concept set’s detail page in the Data Dictionary.

The details modal for **Heart rate**:

> Resolved concepts in this set: **12** · **4** local · **8** other
>
> **Local concepts in this set (4)**
>
> - ✓ `3013682` Heart rate — LOINC
> - ✓ `8867` Heart rate (clinical) — SNOMED
>
> **Other concepts in this set (8)**
>
> - · `4239408` Heart rate by EKG — SNOMED
> - · `4244396` Heart rate by palpation — SNOMED

## Eligibility scoring

Each group is scored according to its rule:

- **All required** — score = covered / total. The group is satisfied only when every concept set is covered.
- **At least one** — score = 100% as soon as one concept set is covered, 0% otherwise.
- **Optional** — score is informative; the group never blocks eligibility.

The project score is the average of non-optional group scores, rounded to an integer percentage.

> [!NOTE]
> **Best practice**\
> Re-import your `source_to_concept_map` whenever your OMOP ETL changes. The eligibility picture for INDICATE projects evolves with your mapping coverage — keep it fresh so you can spot gaps early.

## Deletion

Mapping projects are stored locally and never appear in the public catalog. To delete one permanently, use the trash action on its card. Clearing your browser data will also remove all mapping projects.
