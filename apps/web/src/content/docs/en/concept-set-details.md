<!-- TODO(v2): v1 detail view. Rewrite against the v2 detail page once it lands: the edit mode, the "Propose on {{forge.name}}" button and the local review storage change in v2 (server drafts, automatic PR/MR). -->

# Concept Set Details

The detail view shows everything about a concept set, organized in four tabs: **Concepts**, **Comments**, **Statistics**, and **Review**.

## Concepts Tab

This tab has two modes, toggled with a switch: **Expression** and **Resolved**.

### Expression Mode

Shows the concept set expression — the authored items with their flags.

Each row shows Vocabulary, Concept Name, Concept Code, Domain, Concept Class, Standard status, and three boolean flags: **Exclude**, **Descendants**, and **Mapped**.

These flags control how the expression is resolved into the final set of concepts. See [Editing Concept Sets](?section=editing-concept-sets) for detailed explanations.

Use the column filters (vocabulary, domain, standard, fuzzy name search) to navigate large expressions.

*Example: Heart rate concept set expression.*

| Vocabulary | Concept Name | Domain | Standard | Exclude | Desc. | Mapped |
|---|---|---|---|:-:|:-:|:-:|
| LOINC | Heart rate | Measurement | Classification | No | Yes | Yes |
| LOINC | Heart rate.beat-to-beat \| Heart | Measurement | Classification | No | Yes | Yes |
| SNOMED | Heart rate | Measurement | Standard | No | Yes | Yes |
| SNOMED | Resting heart rate | Measurement | Standard | No | Yes | Yes |
| SNOMED | Fetal heart rate | Measurement | Standard | **Yes** | **Yes** | **Yes** |
| LOINC | Heart rate at First encounter | Measurement | Standard | **Yes** | **Yes** | **Yes** |
| … 38 items total | | | | | | |

### Resolved Mode

Shows the expanded result after applying all expression logic. This is the actual set of OMOP concepts that would be used in a query. Columns include Concept ID, Vocabulary, Name, Code, Domain, Standard, and Concept Class.

If an OHDSI vocabulary database is loaded (see [OHDSI Vocabularies](?section=dictionary-settings)), resolution is computed live in the browser. Otherwise, pre-computed resolved sets from the repository are used.

*Example: Heart rate resolved set — the actual standard OMOP concepts after expansion.*

| Concept ID | Vocabulary | Concept Name | Concept Code | Standard |
|--:|---|---|---|---|
| 3027018 | LOINC | Heart rate | 8867-4 | Standard |
| 36303943 | LOINC | Heart rate --W exercise | 89273-7 | Standard |
| 36305351 | LOINC | Heart rate --during anesthesia | 89278-6 | Standard |
| 3040891 | LOINC | Heart rate --resting | 40443-4 | Standard |
| 40771525 | LOINC | Heart rate --sitting | 69001-6 | Standard |
| 3001376 | LOINC | Heart rate by Pulse oximetry | 8889-8 | Standard |
| 40481601 | SNOMED | Resting heart rate | 444981005 | Standard |
| 35610095 | SNOMED | Heart rate at cardiac apex | 429525003 | Standard |
| … 23 standard concepts resolved (63 total) | | | | |

### Concept Detail Panel

Click any concept row to display a detail panel. It contains three sections:

*Example: "Heart rate --W exercise" (LOINC 89273-7).*

**Concept Details**

| Field | Value |
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

| Relationship | Concept Name | Vocabulary | Class |
|---|---|---|---|
| Is a | Heart rate \| XXX \| Heart rate taken in specific position | LOINC | LOINC Hierarchy |
| Is a | Heart rate positional molecular | LOINC | LOINC Class |
| Has component | Heart rate^W exercise | LOINC | LOINC Component |
| Has property | Number Rate | LOINC | LOINC Property |
| Maps to | Heart rate --W exercise | LOINC | Clinical Observation |

**Hierarchy** (ancestors above, the selected concept at the bottom)

```text
General heart rate [LOINC]
└── Specific heart rate [LOINC]
    ├── Heart rate taken in specific position [LOINC]
    │   └── Heart rate --W exercise [LOINC]   ← selected
    └── Heart rate positional molecular [LOINC]
        └── Heart rate --W exercise [LOINC]   ← selected
```

**Synonyms**

| Synonym | Language |
|---|---|
| Heart rate - W exercise | English |
| Heart rate W exercise | English |
| 心率^采用运动:计数型速率:时间点:XXX:定量型 | Chinese |

The **Concept Details** grid shows the full metadata with links to [ATHENA](https://athena.ohdsi.org/) (via Concept ID) and the [FHIR Terminology Server](https://tx.fhir.org/r4/) (via FHIR Resource).

Three tabs below the metadata provide additional information:

- **Related** — Relationships to other concepts (Is a, Has component, Maps to, etc.). Filterable by relationship type, vocabulary, and name.
- **Hierarchy** — Interactive force-directed graph (vis.js) showing ancestors, descendants, and related concepts. Click any node to navigate to that concept.
- **Synonyms** — Alternative names for the concept from the OMOP vocabulary (including translations in other languages).

## Comments Tab

Displays expert guidance in Markdown. Comments typically describe:

- The clinical meaning and context of the concept set
- Which concepts to prefer in specific scenarios
- Common pitfalls during ETL
- Differences between similar concepts across vocabularies

In edit mode, a dual-pane editor with live Markdown preview is available.

*Example: Heart rate concept set comments (condensed).*

> **Definition & Clinical Context**
>
> Heart rate is the number of heartbeats per unit of time (bpm). Normal ranges: 60–100 bpm in adults, 110–160 bpm in neonates. This concept set captures numeric heart rate values only, excluding pulse waveform morphology, rhythm classification, and fetal heart rate.
>
> **Included Concepts**
>
> 22 standard concepts (20 LOINC + 2 SNOMED) organised by clinical context:
>
> - **General** — *3027018 / 8867-4 Heart rate*: default concept when source does not specify method or site
> - **By method** — e.g. *3001376 / 8889-8 Heart rate by Pulse oximetry*, *21490670 / 60978-4 Heart rate Intra arterial line by Invasive*
> - **By position** — e.g. *40771524 / 68999-2 Heart rate ––supine*
> - **By condition** — e.g. *3040891 / 40443-4 Heart rate ––resting*
> - **Neonatal screening** — pre- and postductal pulse oximetry
>
> **Excluded Concepts**
>
> - **Pulse waveform & intensity** — morphology observations, not numeric rates
> - **Fetal heart rate** — covered by a dedicated concept set
> - **Timed aggregates** — Holter/telemetry summaries (max, mean, min over hours)
> - **Calculated differences** — e.g. orthostatic heart rate delta
>
> **Mapping Notes**
>
> - **Default**: "HR", "Pulse", "FC" → *Heart rate (3027018)*
> - **SpO2-derived**: "SpO2 PR", "Pleth HR" → *Heart rate by Pulse oximetry (3001376)*
> - **Arterial line**: "Art line HR" → *Heart rate Intra arterial line (21490670)*

For broader recommendations that apply across multiple concept sets (e.g. general ETL guidance, mapping strategies), see the [Mapping Recommendations](?section=mapping-recommendations) page.

## Statistics Tab

> [!WARNING]
> **Work in Progress**\
> This feature is still under discussion and has not yet been implemented in practice. The format and content of statistical profiles may evolve.

Shows expected data distributions to help validate your data during ETL:

- **Numeric data** — Min, P5, P25 (Q1), Median, Mean, P75 (Q3), P95, Max, SD, CV
- **Histograms** — Horizontal bar charts of the value distribution
- **Categorical data** — Categories with counts and percentages
- **Multiple profiles** — e.g. Adult, Child, Newborn with different reference ranges
- **Measurement frequency** — Typical recording interval (hourly, daily, etc.)

## Review Tab

Displays the review history for this concept set. Each review records the reviewer, date, status, version reviewed, and comments.

The **Reviews** panel lists them in a table, with the **Propose on {{forge.name}}** and **Add Review** buttons above it:

| Reviewer | Date | Status | Version | Comments |
|---|---|---|---|---|
| Jane Smith | 2026-03-15 | Approved | 1.0.1 | Concept set is comprehensive. Good coverage of the LOINC hierarchy. The exclusion of fetal heart rate with a dedicated concept set makes sense, as fetal HR is recorded at the maternal level and could be confused with the mother's own heart rate during data alignment. |
| John Doe | 2026-01-10 | Needs Revision | 1.0.0 | Fetal heart rate should be excluded from this set. It is recorded at the maternal level (in the mother's obstetric record), creating a risk of confusion with the mother's own heart rate. I suggest moving it to a dedicated concept set to prevent mixing fetal and maternal values during data alignment. |

See [Reviewing & {{forge.name}}](?section=reviewing) for the full workflow on submitting reviews and proposing changes on {{forge.name}}.

## Header Metadata

The detail header shows:

- **Version badge** — Click to view the version history log
- **Review status badge** — Click to change status (in edit mode)
- **Export** — Download or copy as JSON, propose on {{forge.name}}, or generate an OMOP SQL query with unit conversions (see [Exporting](?section=exporting))
