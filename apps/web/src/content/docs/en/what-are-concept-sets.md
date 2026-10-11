# What are Concept Sets?

A **concept set** is a reusable collection of OMOP vocabulary concepts that defines a clinically meaningful variable (e.g., "Heart Rate", "Serum Creatinine", "Norepinephrine"). Rather than working with individual LOINC or SNOMED codes, researchers and data engineers work with concept sets that group related codes under intuitive clinical labels.

## The OHDSI Concept Set Specification

Each concept set follows the [OHDSI Concept Set Specification](https://ohdsi.github.io/TAB/Concept-Set-Specification.html), the standard format used by ATLAS and the OHDSI ecosystem. A concept set expression is a list of items, where each item references an OMOP concept and has three boolean flags:

- **Exclude** — Remove this concept (and optionally its descendants) from the set
- **Descendants** — Include all descendant concepts in the vocabulary hierarchy
- **Mapped** — Include concepts linked via "Maps to" relationships

> [!NOTE]
> **Expression vs. Resolved**\
> The **expression** is what you author — a compact list of selected concepts with flags. The **resolved set** is the expanded result after applying descendants, mapped, and exclusion logic. For example, an expression with one LOINC classification concept + Descendants might resolve to dozens of specific measurement codes.

## Extended Metadata

Beyond the standard OHDSI specification, each concept set in the {{app.name}} library includes additional metadata:

- **Version** — Semantic versioning (e.g. 1.0.0) with a version history log
- **Review status** — Draft, Pending Review, Approved, Needs Revision, or Deprecated
- **Author info** — Creator name, affiliation, profession, ORCID
- **Translations** — Multilingual name, category, and subcategory (currently English and French, extensible to other languages)
- **Expert comments** — Markdown field for clinical guidance and ETL recommendations
- **Statistical profiles** — Expected distributions for data validation
- **Review history** — Reviewer name, date, status, and comments for each review

## Categories

Concept sets are organized into nine clinical categories:

- Demographics & Encounters
- Conditions (diagnoses)
- Clinical Observations (assessment scales)
- Vital Signs
- Laboratory Measurements
- Microbiology
- Ventilation
- Drugs
- Procedures

## Use Cases

These curated, reviewed, and versioned concept sets can be used for:

- **Cohort definition** — As building blocks in ATLAS or custom queries
- **ETL development** — To prioritize and validate concept mappings
- **Study feasibility** — To evaluate data availability across a federated network
