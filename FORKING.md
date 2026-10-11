# Forking guide

The INDICATE Data Dictionary is meant to be reused: any team can run its own governed dictionary from a copy of this repository. One repository holds both the application and the dictionary content, so a fork is your dictionary.

1. [Create your repository](#1-create-your-repository)
2. [Make it yours](#2-make-it-yours): `config.json`, branding, wiping INDICATE's content
3. [Deploy](#3-deploy): static site or server
4. [OAuth sign-in (server mode)](#oauth-sign-in-server-mode)
5. [Day-to-day](#5-day-to-day)
6. [Updating from upstream](#6-updating-from-upstream)
7. [Sharing concept sets between dictionaries](#7-sharing-concept-sets-between-dictionaries)

> This guide describes v2 (React + FastAPI, branch `v2`). Until the cutover, the published INDICATE site is still v1 (`legacy/`), and a fork of `main` gets v1. See [docs/deployment.md](docs/deployment.md#cutover-v1--v2-on-main).

---

## 1. Create your repository

On GitHub, **Use this template** on <https://github.com/indicate-eu/data-dictionary> gives you a separate history (a fork keeps pointing back at INDICATE). Then clone it:

```bash
git clone git@github.com:<your-org>/<your-repo>.git
cd <your-repo>
```

On GitLab: `New project` → `Import project` → `Repository by URL` with `https://github.com/indicate-eu/data-dictionary.git`.

Local setup (needed to preview, run the scripts, or develop):

```bash
npm install                                               # Node 22
cd apps/api && uv venv --python 3.12 && uv pip install -e ".[dev]" && cd ../..
python3 build.py                                          # static payload, for the static mode
```

## 2. Make it yours

### 2.1. `config.json`

The file at the repo root identifies your dictionary; the app, the scripts and the server all read it. You can edit it by hand, or from the app (**Settings → Branding**), which saves it as a draft you propose or commit like any content.

```json
{
  "title": "My Team Data Dictionary",
  "languages": ["en", "fr"],
  "defaultLanguage": "en",
  "repository": {
    "url": "https://github.com/<your-org>/<your-repo>",
    "branch": "main",
    "upstream": "https://github.com/indicate-eu/data-dictionary.git",
    "upstreamBranch": "main"
  },
  "organization": { "name": "My Team", "url": "https://my-team.example.org" },
  "customVocabulary": { "id": "MYTEAM", "codePrefix": "MYTEAM-" },
  "branding": {
    "logo": "branding/logo.png",
    "favicon": "branding/favicon.png",
    "logoAlt": "My Team",
    "colors": { "primary": "#1f6feb", "secondary": "#6e40c9" }
  },
  "tabs": { "showProjects": true, "showMappingRecommendations": true },
  "access": { "anonymousRead": true }
}
```

- **`title`**: your dictionary's name (browser tab, header).
- **`repository.url`**: *your* repository. Its host decides the forge (github.com → GitHub, anything else → GitLab, or set `repository.forge` to `"github"` / `"gitlab"` for a self-hosted host that says nothing). Proposals, "Propose on …" links and past-version fetches all go there. **The setting most often forgotten on a GitLab fork.**
- **`repository.repo`** *(optional)*: the `<owner>/<project>` slug, derived from `url` when absent. GitLab subgroups work.
- **`repository.branch`**: the content branch (the server's default for `DD_CONTENT_BRANCH`).
- **`repository.upstream` / `upstreamBranch`**: where `update_from_upstream.py` pulls code from. Keep INDICATE's.
- **`organization`**: written into new concept sets (`metadata.organization`).
- **`customVocabulary`**: vocabulary id and code prefix of concepts you create outside OMOP.
- **`branding`**: logo, favicon, alt text, and optionally `appName` and `colors` / `darkColors` (`primary`, `secondary`).
- **`tabs`**: `false` hides Projects or Mapping.
- **`access.anonymousRead`** (server mode): `false` requires a login to read anything. A static site is always public.

The block was called `github` before v1.2.6; that name is still read.

### 2.2. Branding images

**Settings → Branding** uploads a logo and a favicon: they are stored in `branding/` at the repo root (`branding/logo.png`) and named in `config.json`. By hand, put your files in `branding/` and set `branding.logo` / `branding.favicon` to those paths. (INDICATE's own images are still in `legacy/` until the cutover; a bare file name such as `logo.png` is looked up there.)

### 2.3. Wipe INDICATE's content

```bash
python3 reset.py          # --yes to skip the prompt, --no-build to skip build.py
```

It deletes `concept_sets/`, `projects/` and `concept_sets_resolved/`, empties the text of `mapping_recommendations/mapping_recommendations.json`, and resets `id_counters.json` to `{1, 1}` and `concept_sets_versions.json` to `{}`. It keeps `config.json`, `config.local.json`, the unit tables (`units/`, generic), `branding/`, and the application code. On a repository without a first commit it skips `build.py` (which needs a `HEAD`): commit, then run it.

The user documentation shown in the app (`apps/web/src/content/docs/`) talks about "this dictionary" through placeholders filled from `config.json` (`{{app.name}}`, `{{repository.url}}`…), so it follows your configuration.

### 2.4. First commit

```bash
git add -A
git status            # nothing unexpected?
git commit -m "Initialize <my team> dictionary"
git push
```

`git add -A` rather than a list: `reset.py` touches six paths, and forgetting `concept_sets_versions.json` leaves INDICATE's version index in your repo. Generated files (`legacy/data*.js(on)`, `legacy/concept_sets_resolved/`, `apps/web/dist/`) and `config.local.json` are gitignored.

### 2.5. Local terminology paths (optional)

`config.local.json` (gitignored, copy `config.local.example.json`) points the scripts and Claude Code skills at local terminology files: `ohdsiVocab` (an ATHENA export as a folder of CSV or Parquet, or a `.duckdb` file) for `resolve.py`; `loincPath`, `snomedPath`, `umlsPath`, `npuCodesPath` for the `describe-concept-set` skill. All optional. Where to download each: the app's documentation, **Sources** section.

## 3. Deploy

Two modes, from the same repository. Details, variables and the upgrade path: [docs/deployment.md](docs/deployment.md).

- **Static site** (GitHub Pages, GitLab Pages): free, no server, read-only catalogue; contributions go through "Propose on GitHub / GitLab"; each user imports the OMOP vocabulary into their browser. CI builds it (`.github/workflows/v2-static.yml`, `.gitlab-ci.yml`); in GitHub, `Settings → Pages → Source: GitHub Actions`. The build needs Python 3, git and the full history (`fetch-depth: 0`), because `build.py` reads the pinned past versions from git.
- **Server** (Docker): accounts and roles, reviews and edits saved as drafts on the server, proposals opened as pull / merge requests automatically (or committed directly by maintainers), one shared OMOP vocabulary. `docker compose -f docker/docker-compose.yml up -d --build` with `DD_SECRET_KEY` and `DD_CONTENT_REPO_URL` (your repository); the first-run wizard creates the admin account and sets the organization, branding and access.

The server pushes to your repository with a service token (`DD_GIT_TOKEN`: a GitHub fine-grained token with *Contents* and *Pull requests* read/write on the repository, or a GitLab project access token with the `api` and `write_repository` scopes, and a role allowed to push to the content branch if it is protected and maintainers commit directly) or with the forge token of a user who signed in with GitHub or GitLab.

## OAuth sign-in (server mode)

Local accounts always work. Each provider below is enabled when both its client id and secret are set; register one application per provider with **exactly** this callback URL, where `DD_PUBLIC_URL` is the public address of your app (no trailing slash):

| Provider | Callback URL | Where to register | Variables |
|---|---|---|---|
| GitHub | `{DD_PUBLIC_URL}/api/v1/auth/oauth/github/callback` | GitHub → Settings → Developer settings → OAuth Apps → New OAuth App (your organization's settings for an org-owned app). Homepage URL: `DD_PUBLIC_URL`. | `DD_OAUTH_GITHUB_CLIENT_ID`, `DD_OAUTH_GITHUB_CLIENT_SECRET`; `DD_OAUTH_GITHUB_SCOPE=read:user user:email repo` for a private repository |
| GitLab | `{DD_PUBLIC_URL}/api/v1/auth/oauth/gitlab/callback` | GitLab → User settings (or group, or Admin area) → Applications. Confidential, scopes `read_user` and `api`. | `DD_OAUTH_GITLAB_CLIENT_ID`, `DD_OAUTH_GITLAB_CLIENT_SECRET`, `DD_OAUTH_GITLAB_BASE_URL` for a self-hosted GitLab |
| ORCID | `{DD_PUBLIC_URL}/api/v1/auth/oauth/orcid/callback` | ORCID → Developer tools (public API client). | `DD_OAUTH_ORCID_CLIENT_ID`, `DD_OAUTH_ORCID_CLIENT_SECRET`, `DD_OAUTH_ORCID_SANDBOX=true` for sandbox.orcid.org |

- A GitHub or GitLab sign-in also stores the user's token, so their proposals are opened in their own name; ORCID only fills the profile's ORCID iD.
- Accounts created by an OAuth sign-in get `DD_OAUTH_DEFAULT_ROLE` (default `viewer`); an admin raises them in **Settings → Users**. A signed-in user can link further providers to the same account (user menu → *Linked accounts*).
- For local testing, `DD_PUBLIC_URL=http://localhost:3000` and a callback on that address work with GitHub and GitLab.

## 5. Day-to-day

**Editing.** In server mode, edit in the app: concept sets, projects, reviews, unit tables, mapping recommendations and branding are saved as your drafts, then submitted as a proposal (a branch + pull / merge request) or, for maintainers, committed directly. In static mode, edits stay in the browser until "Propose on GitHub / GitLab". Or edit the JSON files directly and open a pull request; formats: [docs/data-formats.md](docs/data-formats.md).

**Resolving.** After changing a concept set's `expression`, its resolved list (`concept_sets_resolved/{id}.json`) must be regenerated and committed: from the app (server or static mode, with a vocabulary loaded), or `python3 resolve.py --id <id>`. CI never resolves.

**Versions.** Projects pin concept set versions, served from the git commits indexed in `concept_sets_versions.json`. A server commit that changes a version indexes it in a second commit, and *Pull* indexes versions merged on the forge. Outside the server (hand edits, static-mode proposals), catch up from a clone:

```bash
python3 snapshot.py --backfill --dry-run   # what is missing
python3 snapshot.py --backfill             # add it, then commit concept_sets_versions.json
```

It only adds: a published `(id, version)` is never repointed. Workflow and pitfalls: [docs/build-pipeline.md](docs/build-pipeline.md).

## 6. Updating from upstream

```bash
python3 update_from_upstream.py --dry-run   # list what would be checked out
python3 update_from_upstream.py             # --yes to skip prompts
git diff --stat && git diff
npm install                                 # if package-lock.json changed
(cd apps/api && uv pip install -e ".[dev]") # if apps/api/pyproject.toml changed
git commit -am "Update from upstream" && git push
```

It adds a remote `upstream` (from `config.json` → `repository.upstream`), fetches `upstreamBranch`, and checks out the code paths listed in `UPSTREAM_PATHS`: `apps/`, `packages/`, `docker/`, `scripts/`, the root `package.json`, `package-lock.json` and `turbo.json`, the Python scripts, `docs/`, the agent and fork guides, CI files, `.claude/skills/`, and v1's `legacy/` code until the cutover. Your content and identity are never touched: `concept_sets/`, `concept_sets_resolved/`, `projects/`, `units/`, `mapping_recommendations/`, `concept_sets_versions.json`, `id_counters.json`, `config.json`, `config.local.json`, `branding/`, and v1's `legacy/logo.png`, `legacy/favicon.png`, `legacy/data_dictionary.png`.

A path you customized (say `apps/web/src/content/docs/`) is overwritten: re-apply your change, or remove the path from `UPSTREAM_PATHS`. A file deleted upstream stays in your fork until you delete it. Before a major upgrade, read the upstream `CHANGELOG.md`. A server instance then upgrades as described in [docs/deployment.md](docs/deployment.md#upgrades) (migrations run at start).

## 7. Sharing concept sets between dictionaries

A concept set authored in one dictionary can be imported into another: the format is the same everywhere.

**Importing.** On the concept set list, **Import** → *from a repository* (another dictionary's repository URL: its published catalogue is listed, each set flagged new, already imported, or another version) or *a single concept set* (a raw JSON URL, or pasted JSON). Sets are matched by lineage (`uniqueId`): a new one is added, another version of one you have replaces it (keeping its local id), the same version is skipped. Each import becomes your draft, to propose or commit like any edit.

**Provenance.** Four fields of `metadata` keep a shared set traceable, written by the app, never by hand:

- **`uniqueId`**: the lineage (UUID), created once and kept across versions, imports and repositories. Unique within a repository. The file's numeric id is local and reassigned on import.
- **`organization`**: `created` (the authoring team, immutable) and `current` (the team maintaining this copy, set on every edit and import).
- **`sourceRepo`**: the repository currently maintaining the set, refreshed on every edit, so provenance survives a copy-paste.
- **`origin`**: written once at import, then frozen: `{uniqueId, repo, version, commit, organization, importedDate}`, enough to fetch back the exact source. `null` for sets created locally.

Importing is a fork of one concept set: shared lineage, your organization, a frozen origin. Two dictionaries can then evolve it independently, and the divergence stays explicit. Format details: [docs/data-formats.md](docs/data-formats.md).
