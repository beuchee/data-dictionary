<!-- TODO(v2): the "Propose on {{forge.name}}" export and the local edit mode are v1 behaviour; rewrite with v2 editing (server drafts, automatic PR/MR). -->

# Mapping recommendations

The **Mapping recommendations** tab provides expert-curated guidance for mapping common local ICU variables to OMOP standard concepts. It lives next to the Mapping projects tab on the Concept Mapping page.

## What are mapping recommendations?

During an ETL process to convert local clinical data to the OMOP CDM, deciding how to map each local variable to standard concepts is one of the most challenging steps. Mapping recommendations provide structured guidance for common variables found in ICU databases.

## Viewing

The content is rendered as Markdown, allowing rich formatting with tables, links, and structured guidance. A table of contents in the right sidebar tracks the section you are reading as you scroll.

Two buttons live at the top of the right sidebar:

- **Export** — opens the export modal (see below)
- **Edit** — enters edit mode to modify the content

## Editing

In edit mode, an ACE editor with Markdown syntax highlighting opens alongside a live preview panel. The two panes scroll in sync so you keep your bearings while editing long sections.

Content is multilingual — switching language saves the current text and loads the other language.

## Exporting

Click **Export** to open the export modal (**Export Mapping Recommendations**):

| Option | Description |
|---|---|
| **Download File** | Download as mapping_recommendations.json |
| **Copy to Clipboard** | Copy JSON to clipboard |
| **Propose on {{forge.name}}** | Copy to clipboard and open {{forge.name}} editor |

- **Download File** — downloads `mapping_recommendations.json`, which belongs in the `mapping_recommendations/` folder of the Git repository
- **Copy to Clipboard** — copies the JSON content to your clipboard
- **Propose on {{forge.name}}** — copies to clipboard and opens the {{forge.name}} editor to propose changes via a pull request. Select all (Ctrl+A) in the editor and paste to replace the file before committing
