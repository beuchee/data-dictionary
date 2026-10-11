# Introduction

The **{{app.name}}** is a web application for browsing, reviewing, and contributing to a curated library of standardized clinical concept sets for intensive care. It is designed to help harmonize ICU data across European institutions using the OMOP Common Data Model.

> [!NOTE]
> **What is INDICATE?**\
> [INDICATE](https://indicate-europe.eu/) is a European initiative launched in December 2024, co-funded by the EU Digital Europe Programme (Grant No. 101167778). It aims to build a federated infrastructure for secure, cross-border ICU data sharing across 15 data providers in 12 European countries.

## Why a Data Dictionary?

Even with standardized terminologies like LOINC and SNOMED CT, a single clinical idea (e.g. "Heart Rate") can be represented by hundreds of distinct standard concepts, varying by measurement method, specimen type, or clinical context. Selecting appropriate concepts requires combined clinical, data science, and terminology expertise.

The {{app.name}} addresses this by providing expert-curated **concept sets** — reusable collections of OMOP vocabulary concepts that define clinically meaningful variables. It follows the [OHDSI Concept Set Specification](https://ohdsi.github.io/TAB/Concept-Set-Specification.html), ensuring interoperability with ATLAS and the broader OHDSI ecosystem.

## Key Features

- **Concept Set Browser** — Browse concept sets organized by clinical category: vitals, labs, conditions, drugs, ventilation, and more.
- **Concept Explorer** — Navigate inside each concept set, view individual concept details with links to ATHENA and FHIR, and explore vocabulary hierarchies interactively.
- **Expert Guidance** — Each concept set includes expert comments (Markdown) with clinical context and ETL recommendations.
- **Reference Statistics** — Expected distributions (histograms, percentiles) for data validation, with multiple profiles (Adult, Child, Newborn).
- **Peer Review** — Submit reviews with status tracking, and propose changes on {{forge.name}} via pull requests.
- **Projects** — Organize concept sets into research projects and export project-level concept lists as CSV.

## Who is this for?

- **Clinicians & Researchers** — Provide expertise on concept definitions, review clinical relevance, and use curated concept sets for study design and cohort definition.
- **Data Scientists** — Build ETL pipelines and federated queries with validated concept sets.
- **Data Engineers** — Map source data to OMOP CDM using recommended concept sets and unit conversions.

## About the project

Concept set definitions were developed through an iterative, consensus-building process. Use case leaders first identified the variables required for their clinical applications. These requirements were refined in bi-weekly interdisciplinary meetings bringing together clinical experts, data scientists, and interoperability specialists.

The library currently comprises over 330 concept sets organized into nine categories. All content is open source on [{{forge.name}}]({{repository.url}}). Learn more at [indicate-europe.eu](https://indicate-europe.eu/).
