<!-- TODO(v2): describes v1 editing (edits kept in the browser's localStorage, exported or proposed on {{forge.name}} by hand). Rewrite when v2 editing lands: server drafts, roles, automatic PR/MR. The expression flags and resolution algorithm stay valid. -->

# Editing Concept Sets

All edits are saved to your browser’s local storage. They persist across sessions but are tied to your browser.

> [!WARNING]
> **Local storage warning**\
> If you clear your browser data, local edits will be lost. Remember to **export** your work as JSON and/or **propose changes on {{forge.name}}** via a pull request to preserve them. See [Exporting](?section=exporting) and [Reviewing & {{forge.name}}](?section=reviewing).

This section covers two levels of editing: first, managing the list of concept sets (adding, deleting, renaming); then, editing the details of an individual concept set (expression, comments, statistics).

## Editing the Concept Set List

These actions apply to the main Data Dictionary table.

### Entering Edit Mode

Click the **Edit** button in the toolbar (next to **Export**).

The toolbar changes to show selection, add, and save/cancel controls: **Select All**, **Unselect All**, **Delete** (trash icon), a *0 selected* counter, **Cancel**, **Save** and **Add Concept Set**.

### Adding a Concept Set

In edit mode, click **Add Concept Set** (green button). A modal opens where you provide a name and category (required), and optionally a subcategory and description. Use the **+** button next to category or subcategory to create a new one.

The **New Concept Set** modal, filled in:

| Field | Example |
|---|---|
| Name * | Heart rate |
| Category * | Vital Signs (**+** to create a new one) |
| Subcategory | Haemodynamics (**+** to create a new one) |
| Description | Number of heartbeats per minute (bpm). |

Buttons: **Cancel**, **Create**.

### Selecting, Editing & Deleting

In edit mode, two extra columns appear on each row: a **checkbox** for selection and a **pen icon** to edit that concept set.

| ☐ | ✎ | Category | Subcategory | Name | Version | Status |
|:-:|:-:|---|---|---|:-:|:-:|
| ☐ | ✎ | Vital Signs | Haemodynamics | **Heart rate** | 1.0.1 | Approved |
| ☑ | ✎ | Vital Signs | Haemodynamics | **Systolic blood pressure** | 1.0.0 | Approved |
| ☐ | ✎ | Vital Signs | Haemodynamics | **Mean arterial pressure** | 1.0.0 | Draft |

- ✎ **Edit** — Opens the edit modal (same form as "New Concept Set", pre-filled with the existing values).
- **Select All / Unselect All** — Toggle selection on all rows.
- **Delete** (trash icon) — Remove all selected concept sets.

### Saving & Cancelling

All changes made in edit mode (additions, edits, deletions) are pending until you explicitly act:

- **Save** — Commits all pending changes to local storage
- **Cancel** — Discards all pending changes, restoring the list to its state before entering edit mode. This undoes everything: additions, edits, and deletions.

## Editing a Concept Set’s Details

Open a concept set, then click **Edit** in the detail header. The Edit and Export buttons are replaced by **Import**, **Cancel**, and **Save**.

### Expression Flags

Each concept in the expression has three flags that you can toggle directly in the table. These flags follow the [OHDSI Concept Set Specification](https://ohdsi.github.io/TAB/Concept-Set-Specification.html):

*Example: Heart rate expression in edit mode. Toggle switches control each flag. The trash icon deletes individual items.*

| Vocabulary | Concept Name | Concept Class | Standard | Exclude | Desc. | Mapped | |
|---|---|---|---|:-:|:-:|:-:|:-:|
| LOINC | Heart rate | LOINC Hierarchy | Classification | off | on | on | 🗑 |
| SNOMED | Heart rate | Observable Entity | Standard | off | on | on | 🗑 |
| SNOMED | Fetal heart rate | Observable Entity | Standard | **on** | on | on | 🗑 |
| LOINC | Heart rate at First encounter | Clinical Observation | Standard | **on** | on | on | 🗑 |
| … 38 items total | | | | | | | |

**Descendants** — When checked, all descendant concepts in the vocabulary hierarchy are automatically included. OMOP vocabularies organize concepts in hierarchical trees using "Is a" / "Subsumes" relationships (stored in the CONCEPT_ANCESTOR table). For example, the LOINC hierarchy concept "Heart rate" has dozens of descendants like "Heart rate ––resting", "Heart rate ––sitting", "Heart rate by Pulse oximetry", etc. Checking Descendants on a parent concept captures all of them without listing each one individually.

**Mapped** — When checked, non-standard concepts that are linked to the selected concept via "Maps to" / "Mapped from" relationships are also included. In the OMOP vocabulary, each clinical idea has one designated **Standard** concept (marked "S"). Other vocabulary codes representing the same idea are **non-standard** and are linked to the Standard concept via "Maps to". For example, SNOMED "Heart rate" (concept ID 4239408, non-standard) maps to LOINC "Heart rate" (concept ID 3027018, Standard). Checking Mapped ensures that non-standard concepts from other vocabularies are captured alongside the standard concept.

**Exclude** — When checked, this concept is removed from the resolved set. If Descendants is also checked, all its descendant concepts are excluded too. This allows you to include a broad parent concept with its descendants, then selectively exclude specific branches. For example, in the Heart rate concept set, "Fetal heart rate" is excluded with Descendants to remove fetal-specific measurements from the set.

> [!NOTE]
> **Resolution Algorithm**\
> The concept set is resolved in three steps:
> 1. Build the **inclusion set** from all items where Exclude is unchecked, expanding via Descendants and Mapped as configured
> 2. Build the **exclusion set** from items where Exclude is checked, with the same expansion logic
> 3. Final result = **inclusion set minus exclusion set**

### Adding Concepts

In edit mode, the expression toolbar shows additional buttons: **Select All**, **Unselect All**, **Delete** (trash icon), a *0 selected* counter, **Add Concepts** and **Optimize**.

Click **Add Concepts** to open a fullscreen modal with two tabs, **OHDSI Vocabularies** and **Custom Concept**:

- **OHDSI Vocabularies** — Search and add existing OMOP standard concepts from the OHDSI vocabulary database (SNOMED, LOINC, RxNorm, etc.). This is the primary way to build concept set expressions.
- **Custom Concept** — Create a non-OMOP concept manually when no standard concept exists in the OHDSI vocabularies. Use as a last resort — custom concepts are not interoperable with the OHDSI ecosystem.

#### OHDSI Vocabularies

Search the local OHDSI vocabulary database by name, concept ID, or code. Requires [importing vocabularies](?section=dictionary-settings) first. The search uses **fuzzy matching** on concept names.

The search bar holds the query field (*Search concepts by name, code, or ID...*, here `heart rate`), the **Search** and **Filters** buttons, and a **Limit 10K** checkbox (checked by default).

The **Filters** button opens a popup to narrow results:

| Filter | Default |
|---|---|
| Vocabulary | All |
| Domain | All |
| Class | All |
| Standard | Standard |
| Valid only | ☑ |

Buttons: **Clear**, **Apply**.

**Limit 10K** caps results at 10,000 to avoid overloading the table.

Results are displayed in a datatable with column filters:

| ☐ | Concept ID | Concept Name | Vocabulary | Code | Domain | Class | Standard |
|:-:|--:|---|---|---|---|---|:-:|
| ☑ | 3027018 | Heart rate | LOINC | 8867-4 | Measurement | Clinical Observation | Standard |
| ☐ | 3040891 | Heart rate --resting | LOINC | 40443-4 | Measurement | Clinical Observation | Standard |
| ☐ | 3001376 | Heart rate by Pulse oximetry | LOINC | 8889-8 | Measurement | Clinical Observation | Standard |
| ☐ | 4239408 | Heart rate | SNOMED | 364075005 | Measurement | Observable Entity | Non-standard |

Below the table, two panels show details for the selected concept:

- **Concept Details** — Full metadata, ATHENA and FHIR links
- **Hierarchy** — Interactive graph of ancestors, descendants, and related concepts

At the bottom, configure the flags and add the selected concept(s): a **Multiple Selection** checkbox, the **Exclude**, **Descendants** and **Mapped** toggles, a *1 selected* counter and the **Add Concepts** button.

Check **Multiple Selection** to select several concepts at once using checkboxes in the table, then add them all in one click.

#### Custom Concept

Create non-OMOP concepts when no standard concept exists. Use sparingly — custom concepts break interoperability.

| Field | Example | Note |
|---|---|---|
| Concept ID | 2100000003 | Auto-assigned from 2,100,000,000 |
| Concept Name * | ICDSC Score | |
| Domain * | Measurement | |
| Vocabulary | {{customVocabulary.id}} | Custom concepts use the {{customVocabulary.id}} vocabulary |
| Concept Class * | Clinical Observation | |
| Concept Code | | *Enter concept code (optional)...* |
| Standard Concept | Non-standard | |

Only the **Exclude** toggle is available for custom concepts, since Descendants and Mapped rely on OMOP vocabulary relationships that do not exist for custom entries. The footer then shows the **Exclude** toggle and the **Add Custom Concept** button.

### Import JSON

Click **Import** (purple button) to paste an ATLAS-format or INDICATE-format concept set expression. The importer accepts both UPPERCASE (ATLAS) and camelCase (INDICATE) field names, deduplicates by concept ID, and reports added/skipped counts.

### Deleting Concepts

Use the trash icon on each row, or select multiple rows with checkboxes and click the red trash button in the toolbar.

### Optimizing the Expression

Click **Optimize** to simplify the expression using vocabulary hierarchy analysis (requires an OHDSI vocabulary database). The optimizer:

- Removes descendants already covered by a parent's "Include Descendants" flag (top-down)
- Removes parent items that don't broaden scope (bottom-up)
- Shows a before/after comparison with the items that would be removed or added
- Warns if the optimization changes the resolved set

### Editing Comments

In the Comments tab, edit mode opens an ACE editor with Markdown syntax highlighting and a live preview panel. Use Cmd/Ctrl+S to save. Comments are stored per language.

### Editing Statistics

In the Statistics tab, edit mode opens a JSON editor. A template with the expected structure is provided. You can define numeric data (min, max, mean, median, SD, percentiles, histogram), categorical data, measurement frequency, and multiple population profiles.

### Version & Status

When saving changes, you can update the version (suggested: patch increment) and add a version summary. The review status can be changed via the status badge in the header.
