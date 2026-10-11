<!-- TODO(v2): v1 getting started (browser-only app, header navigation, profile dialog, EN/FR toggle, edits in localStorage shared through the forge workflow). Rewrite for v2: sidebar navigation, login and accounts in server mode, server drafts. -->

# Getting Started

The application runs entirely in the browser — no installation or server required. Simply open the web page and start browsing.

## Quick Tour

The navigation bar at the top provides access to the main sections:

- **Data Dictionary** — Browse and search concept sets ([details](?section=browsing))
- **Concept Mapping** — Evaluate your eligibility to INDICATE projects from your source-to-concept map, and consult mapping recommendations ([details](?section=mapping-projects))
- **Projects** — Group concept sets by research project ([details](?section=projects))
- **Documentation** — This page

## Optional: Import OHDSI Vocabularies

For advanced features (concept search, descendant expansion, hierarchy visualization, concept set optimization), you can import OHDSI vocabulary files into a local DuckDB database that runs in the browser. See [OHDSI Vocabularies](?section=dictionary-settings).

## User Profile

Click your name in the top-right corner to set your profile.

The **Author** tab stores your name, affiliation, profession, and ORCID — this information is embedded in concept sets you create or review.

The **Organisation** tab lets you set the organisation name and URL that will appear in concept set metadata.

The profile dialog (**Edit Profile**) has two tabs:

| Tab | Field | Example |
|---|---|---|
| Author | First Name * | John |
| Author | Last Name * | Doe |
| Author | Affiliation | University Hospital |
| Author | Profession | Intensivist |
| Author | ORCID | 0000-0001-2345-6789 |
| Organisation | Organization Name * | {{organization.name}} |
| Organisation | URL | {{organization.url}} |

## Language

Toggle between English and French using the **EN**/**FR** button in the header. Concept set names, categories, and descriptions are multilingual (currently English and French). Support for additional languages may be added in the future.

## Local Storage

All your edits (concept sets, projects, reviews) are stored in your browser's local storage. They persist across sessions but are local to your browser. To share changes, use the [{{forge.name}} workflow](?section=reviewing).
