<!-- TODO(v2): v1 project editing (edit mode saved to localStorage, "Propose on {{forge.name}}"). Rewrite when v2 project pages and editing land; groups, rules and version pinning stay valid. -->

# Managing Projects

The **Projects** page lets you organize concept sets into research projects. A project can be a clinical study, a machine learning pipeline, a dashboard, or any data-driven initiative.

## Projects List

Projects are displayed as cards showing name, description, concept set count, author, and date. Use the search field to filter by name or description. Click a card to open the project.

Example card:

> **Quality Benchmarking Dashboards [Minimal]**
>
> Demonstrates data sharing practices designed to support continuous improvement of clinical practice through quality benchmarking.
>
> 99 concept sets · Falk von Dincklage · 2024-12-01

## Creating a Project

In edit mode, click **Add Project**. Provide a name and short description (multilingual, currently EN/FR). The author is pre-filled from your profile.

The **New Project** modal:

| Field | Example |
|---|---|
| Name * | Quality Benchmarking Dashboards |
| Short description | Quality benchmarking dashboards for ICU data |
| Created By | Falk von Dincklage |

Buttons: **Cancel**, **Create**.

## Project Detail View

Click a project card to open its detail view with two tabs:

### Description Tab

A Markdown-formatted long description with live preview in edit mode. The description is edited for the currently selected language.

### Concept Sets Tab

In read mode, shows a sortable, filterable table of the project's concept sets, organized by group. Each row shows the group it belongs to, the group's rule, and the version pinning status. Click a row to navigate to that concept set; click the group pill or the *Outdated* badge for inline actions.

| Group | Group rule | Name | Pinned | Update |
|---|---|---|---|:-:|
| Vital signs | ✱ All required | **Heart rate** | `1.0.0` | ⚠ Outdated |
| Anticoagulants | ✔ At least one | **Enoxaparin sodium** | `1.1.0` | ✓ Up to date |

In edit mode, a dual-panel interface lets you:

- **Left panel** — Available concept sets (not yet in the project)
- **Right panel** — Concept sets assigned to the project, with their group
- Use the ⊕ (add) and ⊖ (remove) buttons to move concept sets between panels. Added concept sets land in the currently active group (highlighted in the toolbar).
- Select multiple rows via checkboxes to move them between groups in bulk
- Filter both panels by category, subcategory, or name

**Available Concept Sets**

| Category | Subcategory | Name | |
| --- | --- | --- | --- |
| Vitals | Other vitals | **Body temperature** | ⊕ |
| Vitals | Other vitals | **Body weight** | ⊕ |
| Labs | Liver test | **Albumin** | ⊕ |

**Project Concept Sets** (4)

| | Group | Category | Subcategory | Name |
| --- | --- | --- | --- | --- |
| ⊖ | Vital signs | Vitals | Haemodynamics | **Heart rate** |
| ⊖ | Vital signs | Vitals | Haemodynamics | **Blood pressure** |
| ⊖ | Labs | Labs | Other labs | **Creatinine** |
| ⊖ | Labs | Labs | Liver test | **Bilirubin** |

### Groups and Eligibility Rules

Concept sets within a project are organized into named **groups**. Each group carries an eligibility **rule** that documents how the group should be interpreted when checking whether a data provider can support the project:

- **All required** — every concept set in the group must be covered by the data provider's mapping. Use this for variables that are non-negotiable (e.g. heart rate, blood pressure).
- **At least one** — at least one concept set in the group must be covered. Use this for clinically equivalent alternatives (e.g. an anticoagulants group: having any one anticoagulant mapped is enough to be eligible).
- **Optional** — the group is informative; no concept set is required. Use this for nice-to-have variables.

#### Managing groups in edit mode

A toolbar at the top of the variables tab in edit mode lists every group as a row, with controls to add, rename (✎), reorder (↑↓), or delete (🗑) groups, change a group's rule via a dropdown, and select the active group (the one new concept sets are added to — highlighted with a blue outline).

The groups toolbar (**Groups**, with an **Add group** button), here with *Vital signs* active:

| Group | Rule | Actions |
|---|---|---|
| **Vital signs** (12) — active | All required | ✎ ↑ ↓ 🗑 |
| **Anticoagulants** (8) | At least one | ✎ ↑ ↓ 🗑 |

The rule dropdown offers **All required**, **At least one** and **Optional**.

#### Reassigning concept sets to another group

Tick the checkbox of one or several rows in the project-side table to reveal a bulk action bar above the table. Pick a target group and click **Move** — the selected concept sets are reassigned to that group. In read mode you can also click the group pill on a single row to pick another group from an anchored dropdown.

The bulk action bar: *1 selected* · **Move to** [Vital signs ▾] · **Move**

> [!NOTE]
> **Best Practice**\
> Include all concept sets needed for your analysis, even those only used for adjustment or stratification. Use group rules to express what is mandatory vs. nice-to-have — this lets data providers see at a glance whether they can support the project with their current OMOP mapping.

### Updating a pinned concept set

Concept set versions are pinned per project so old reports stay reproducible. When a concept set has a newer version, an *Outdated* badge appears in the Update column. Click it to review what changed and decide whether to update:

The **Update concept set** modal:

> **Heart rate** `v1.0.0` → `v1.1.0`
>
> Resolved concepts: **10** → **12** · **+3** added · **−1** removed
>
> **Added (3)**
>
> - ➕ `4244396` Heart rate by palpation — SNOMED
> - ➕ `4239408` Heart rate by EKG — SNOMED
>
> **Removed (1)**
>
> - ➖ `4034850` Pulse rate (deprecated) — SNOMED

Buttons: **Cancel**, **Update to latest**.

The modal lists the resolved concepts that were **added** in the latest version (green) and the ones that were **removed** (red), so you can assess the impact on your analysis before bumping. Confirm to bump only that concept set in the project — other pinned versions are unaffected.

## Exporting

The project detail view offers two export options:

### JSON Export

Click the **Export** button in the project header to export the project definition as JSON. You can download it as a file, copy to clipboard, or propose changes on {{forge.name}}.

The **Export Project** modal:

| Option | Description |
|---|---|
| **Download File** | Download as a JSON file |
| **Copy to Clipboard** | Copy the project JSON to clipboard |
| **Propose on {{forge.name}}** | Copy to clipboard and open {{forge.name}} editor |

### CSV Export

In the Concept Sets tab (read mode), click the **CSV** button to download all OMOP concepts from the project's concept sets as a CSV file. The export includes concept set metadata (ID, name, category, subcategory) and expression flags (excluded, descendants, mapped) for each concept.
