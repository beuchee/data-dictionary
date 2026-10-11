# Sources

This page lists every external source the {{app.name}} draws on, and pinpoints the exact file and column where each piece of information lives. Use it to audit a value, refresh the dictionary against a new release, or extend it with a new concept set.

## Concept set descriptions

Concept set descriptions (the *Definition & Clinical Context*, *Included Concepts*, *Excluded Concepts*, and *Mapping Notes* sections shown in the Comments tab) are written from four primary terminology sources, in priority order. When the concept set contains **LOINC** concepts, LOINC is used first — its *Part description* texts give concise, mapping-ready definitions. **SNOMED CT** comes next, especially for clinical findings, procedures, and observable entities. **UMLS** is used as a fallback when LOINC and SNOMED are thin, and **web sources** as a last resort.

### 1. LOINC

Edited and distributed by the Regenstrief Institute (Indianapolis, USA). Preferred source whenever the concept set includes LOINC concepts — its *Part description* texts give concise, mapping-ready definitions.

- **Download**: [https://loinc.org/downloads/](https://loinc.org/downloads/) (free, registration required).
- **File used**: `LoincTable/Loinc.csv` from the LOINC distribution.
- **Key columns**:
    - `LOINC_NUM` — the LOINC code.
    - `COMPONENT`, `PROPERTY`, `TIME_ASPCT`, `SYSTEM`, `SCALE_TYP`, `METHOD_TYP` — the six axes of the LOINC decomposition.
    - `LONG_COMMON_NAME` — full descriptive name.
    - `CONSUMER_NAME` — patient-friendly name.
    - `RELATEDNAMES2` — related keywords.
    - `EXAMPLE_UCUM_UNITS` — the UCUM unit most commonly observed.
    - `CLASS` — LOINC class.
    - `ORDER_OBS` — order vs observation.
- **Accessory files**: `AccessoryFiles/PartFile/Part.csv` for component (*Part*) descriptions, `AccessoryFiles/ConsumerName/ConsumerName.csv` for patient-friendly names.
- **Web fallback**: per-code pages at `https://loinc.org/{loinc_code}/` — the *Part description* section is the preferred source for defining the measured substance.

### 2. SNOMED CT

Edited by SNOMED International (UK). Distributed in the US by the National Library of Medicine, and in other countries by national release centres. Used in priority for concept sets without LOINC concepts (clinical findings, procedures, observable entities).

- **Download**: [https://www.nlm.nih.gov/healthit/snomedct/international.html](https://www.nlm.nih.gov/healthit/snomedct/international.html) (free, UMLS licence required).
- **Format**: RF2 release ZIP (e.g. `SnomedCT_InternationalRF2_PRODUCTION_20251101T120000Z.zip`).
- **Files used** (inside `Snapshot/Terminology/`):
    - `sct2_Description_Snapshot-en_*.txt` — Fully Specified Names (FSN) and synonyms. Columns:
        - `id` — description identifier.
        - `conceptId` — SNOMED concept identifier.
        - `languageCode` — language (e.g. `en`).
        - `typeId` — description type (`900000000000003001` = FSN, `900000000000013009` = Synonym).
        - `term` — the term itself.
    - `sct2_TextDefinition_Snapshot-en_*.txt` — full text definitions (only present for ~3.6% of concepts). Columns:
        - `conceptId` — SNOMED concept identifier.
        - `term` — the definition text.

### 3. UMLS

UMLS Metathesaurus — edited and distributed by the US National Library of Medicine. Used as a fallback for clinical definitions when LOINC *Part description* and SNOMED are thin or absent.

- **Download**: [https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html](https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html) (free, UMLS licence required). Use the *Metathesaurus Full Subset*.
- **Files used** (RRF format, pipe-delimited):
    - `MRCONSO.RRF` — concept names and synonyms. Filter on `LAT=ENG` and the desired source vocabulary (`SAB`, e.g. `MSH`, `NCI`, `SNOMEDCT_US`) to find the parent CUI for the measured substance.
    - `MRDEF.RRF` — definitions. Lookup by CUI; preferred sources in this order: `MSH` (MeSH), `NCI` (NCI Thesaurus), `CSP` (CRISP), `ICF` (International Classification of Functioning), `HPO` (Human Phenotype Ontology), `MEDLINEPLUS`.
    - `MRSTY.RRF` — semantic type (e.g. *T201 — Clinical Attribute*).
    - `MRREL.RRF` — relationships (parent/child, related concepts).

### 4. Web sources

Last-resort sources cited in the *References* section.

For niche concepts where LOINC, SNOMED, and UMLS provide insufficient context, peer-reviewed clinical guidelines, society position statements, or established medical references (StatPearls, UpToDate, society websites) may be cited. Every web source is recorded in the *References* section of the concept set description (numbered, Vancouver-style, with a clickable URL).

## Recommended units

Stored in `units/recommended_units.json`.

The recommended unit for each measurement concept comes from two sources, in priority order. For laboratory measurements, **NPU** is the primary source — it is the IFCC/IUPAC reference and explicitly publishes the SI / IFCC-recommended unit for each measurand. When NPU does not cover the measurement, **LOINC `EXAMPLE_UCUM_UNITS`** is used as a fallback (the unit most commonly observed in practice for that LOINC code). For non-laboratory measurements (vital signs, anthropometrics, scales, drug doses), no formal source is adopted yet.

### 1. NPU

Primary source for laboratory measurements. *Nomenclature for Properties and Units* (IFCC / IUPAC). NPU is broader than JCTLM (it covers concentrations, activities, ratios, qualitative panels) and explicitly publishes both the SI variant and the conventional variant when both are in use (e.g. `µkat/L` and `U/L` for enzyme activities).

- **Download**: [https://npu-terminology.org/npu-database/](https://npu-terminology.org/npu-database/) (free).
- **File used**: the latest `npu-codes-latest.csv`.
- **Key columns**:
    - `npu_code` — the NPU code.
    - `system` — specimen (e.g. `Plasma`, `Serum`, `Capillary blood`, `Blood`, `Patient(blood)`).
    - `component` — the measured substance (e.g. *Bilirubins*, *Glucose*).
    - `kind_of_property` — type of property (e.g. *substance concentration*, *catalytic activity concentration*).
    - `unit` — full unit name (e.g. *micromole per litre*).
    - `unit_short` — UCUM-like short form (e.g. `µmol/L`, `µkat/L`, `U/L`).
    - `active` — `1` for currently active rows.
- **Filter**: `active = 1` and `component` matching the measured substance. For enzymes, two rows usually exist (SI variant `µkat/L` and conventional variant `U/L`) — both are accepted; pick the variant labs actually report.

### 2. LOINC (fallback)

Used when the measurement is not covered by NPU. The recommended unit is read from the `EXAMPLE_UCUM_UNITS` column of `LoincTable/Loinc.csv`. Note that a unit picked from LOINC alone should not be advertised as the "SI unit" or "IFCC-recommended" — those claims require NPU as a citable source.

- **File**: `LoincTable/Loinc.csv` (LOINC distribution — see Concept set definitions above for download).
- **Column**: `EXAMPLE_UCUM_UNITS` — the UCUM unit most commonly observed in practice for that LOINC code, as published by Regenstrief.
- **Multiple values**: the column may list several units separated by `;` (e.g. `mg/dL;mg/L` for some albumin assays). Pick the one matching the LOINC `PROPERTY` (`µmol/L` for *SCnc* / *Moles/volume*, `mg/dL` for *MCnc* / *Mass/volume*); when the property does not disambiguate, pick the one most commonly used in practice and document the choice.

### 3. Non-laboratory measurements

For vital signs, anthropometrics, scales, drug doses and other non-laboratory measurements, the methodology for choosing a recommended unit is **not yet defined**: LOINC `EXAMPLE_UCUM_UNITS` is sparse in these domains, NPU does not cover them, and no single cross-domain reference has been adopted yet. For the moment, recommended units in these domains are populated on a case-by-case basis (clinical guidelines, common practice).

## Conversion factors

Stored in `units/unit_conversions.json`.

Conversion factors come from the official French national reference for laboratory result exchange:

- **Source**: *Jeu de valeurs Circuit de la biologie*, published by the **Agence du Numérique en Santé (ANS)** as part of the French digital health interoperability framework (CI-SIS).
- **Landing page**: [https://smt.esante.gouv.fr/terminologie-jeu-de-valeurs-circuit-de-la-biologie/](https://smt.esante.gouv.fr/terminologie-jeu-de-valeurs-circuit-de-la-biologie/)
- **Download**: the ZIP archive linked from the page above (e.g. `terminologie-jeu-de-valeurs-circuit-de-la-biologie-1.1.23.zip`). The relevant file is `dat/ANS_JDV_CircuitBio.xlsx`.
- **Sheet**: `1.JDV_CircuitBio` — one row per LOINC code in the French national value set (~7 100 rows in v1.1.23).
- **Header layout**: row 1 is a thematic banner (e.g. *Renseignements prélèvements*, *ANALYSES PORTEUSES DE RESULTAT*), row 2 is the actual column header, data starts at row 3.
- **Key columns**:
    - Column 19 — `LOINC` — the LOINC code of the measurement (e.g. `14749-6`).
    - Column 20 — *Libellés français de référence*.
    - Column 24 — *Unité recommandée* — the recommended unit (e.g. `mmol/L`).
    - Column 25 — *Unité UCUM* — the UCUM-formatted unit.
    - Column 27 — *Correspondance* — the LOINC code of the partner test (same measurement, alternative unit; e.g. `14749-6` Glucose *mmol/L* ↔ `2345-7` Glucose *g/L*).
    - Column 28 — *Facteur de conversion des unités* — the multiplicative factor to convert from this row’s unit to the partner row’s unit (e.g. `0.18` from `mmol/L` Glucose to `g/L`, `5.551` in the reverse direction).
- **Mapping into INDICATE**: each ANS row produces (up to) one entry in `units/unit_conversions.json` with `conceptId` = OMOP concept ID for column 19’s LOINC, `sourceUnitCode` = column 24, `targetUnitCode` = the partner row’s column 24, `conversionFactor` = column 28. Both directions are stored as separate rows (one row per direction, as documented in the schema).
- **Companion documentation**: `doc/Guide_Implementation_JDV_Circuit_de_biologie.pdf` and `doc/ANS_Note_de_version_JDV_Circuit_de_Biologie.pdf` in the ZIP describe the column semantics, the validation workflow, and per-version change notes.

### Affine conversions

Most conversions are purely multiplicative (`target = factor × source`). A few analytes need an **affine** conversion of the form `target = factor × source + offset`. Each entry may carry an optional `offset` field; when it is absent or `0` the conversion is multiplicative (so existing entries are unaffected). Example — HbA1c `NGSP %` ↔ `IFCC mmol/mol`: `IFCC ≈ 10.929 × NGSP − 23.50`. Both the OMOP SQL export and the in-app conversion test apply the offset.

## OMOP vocabulary

Every concept in the dictionary references an OMOP `concept_id`. Concept metadata (`concept_name`, `concept_code`, `vocabulary_id`, `domain_id`, `concept_class_id`, `standard_concept`, `valid_start_date`, `valid_end_date`) is hydrated from the OHDSI Athena vocabulary tables.

- **Download**: [https://athena.ohdsi.org/](https://athena.ohdsi.org/) (free, OHDSI account required). Select the vocabularies needed (LOINC, SNOMED, RxNorm, ATC, UCUM, etc.) and download as CSV.
- **Tables used**: `CONCEPT`, `CONCEPT_ANCESTOR`, `CONCEPT_RELATIONSHIP`, `CONCEPT_SYNONYM`, `RELATIONSHIP`, `VOCABULARY`, `DOMAIN`, `CONCEPT_CLASS`, optionally `DRUG_STRENGTH`.
- **Per-concept lookup**: `https://athena.ohdsi.org/search-terms/terms/{conceptId}` (linked from every concept in the SPA).
- **Local query**: the same CSV files can be loaded into the in-browser DuckDB-WASM database (see [Dictionary Settings](?section=dictionary-settings) → General Settings → Vocabulary import) and queried from [Dev Tools](?section=dev-tools).

## UCUM

All unit codes in the dictionary follow UCUM (*Unified Code for Units of Measure*) syntax. UCUM is also distributed as an OMOP vocabulary (every unit has an OMOP `concept_id`, e.g. `8753 — mmol/L`, `8636 — g/L`, `8554 — %`).

- **Specification**: [https://ucum.org/ucum](https://ucum.org/ucum)
- **Distribution as an OMOP vocabulary**: download via Athena (see above) and look up unit codes with `SELECT * FROM concept WHERE vocabulary_id = 'UCUM';`
