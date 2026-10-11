<!-- TODO(v2): describes forking the v1 static SPA (docs/ on GitHub/GitLab Pages, reset.py, update_from_upstream.py, "Propose on GitHub"). Rewrite for v2 deployment (static build or Docker server mode, first-run setup, branding screen) at the cutover. -->

# Forking the dictionary

This application is a **template**. Any team — a specialty, a registry, a single hospital — can stand up its own governed data dictionary from it: same app, same format, your own content, on free static hosting (GitHub Pages or GitLab Pages). There is no backend to run.

> [!NOTE]
> **Full guide**\
> This page is an overview. The complete, command-by-command guide lives in [FORKING.md]({{repository.blobUrl}}/FORKING.md) at the repository root (initial setup, day-to-day, updating from upstream, deployment).

## 1. Create your repository

On GitHub, use **“Use this template”** → *Create a new repository* (this gives you a clean history, not a fork tied to INDICATE). On GitLab, import the repo by URL — the shipped `.gitlab-ci.yml` makes GitLab Pages work out of the box.

## 2. Make it yours: `config.json`

One file at the repo root identifies the dictionary as yours — title, organization, GitHub repo, branding, custom vocabulary prefix:

```json
{
  "title": "My Team Data Dictionary",
  "repository": { "url": "https://github.com/my-org/my-repo",
                  "repo": "my-org/my-repo", "branch": "main",
                  "upstream": "https://github.com/indicate-eu/data-dictionary.git" },
  "organization": { "name": "My Team", "url": "https://my-team.example.org" },
  "customVocabulary": { "id": "MYTEAM", "codePrefix": "MYTEAM-" }
}
```

`repository.upstream` stays pointed at INDICATE so you can pull code updates later. `organization` becomes the default author of new concept sets.

## 3. Wipe the INDICATE content

Replace the branding assets in `docs/` (`logo.png`, `favicon.png`), then clear the example content:

```bash
python3 reset.py
```

This empties `concept_sets/`, `projects/` and resets the id counters, while keeping generic content (unit conversions, mapping recommendations) and your configuration. It then rebuilds `docs/data.json`.

## 4. Add your content & deploy

Create concept sets in the SPA (then *Propose on {{forge.name}}*), or edit `concept_sets/<id>.json` directly and run `python3 build.py`. Then enable Pages: GitHub → *Settings → Pages → Deploy from a branch → main / `/docs`*. Every push redeploys.

## 5. Stay up to date

INDICATE keeps shipping fixes and features. Pull them into your fork without touching your content:

```bash
python3 update_from_upstream.py
```

It updates code paths (scripts, `docs/*.js|html|css`, skills, `CLAUDE.md`, `FORKING.md`) from upstream and leaves your `concept_sets/`, `projects/`, `config.json` and branding alone.

> [!NOTE]
> **Reuse, don’t reinvent**\
> Forks are not islands. You can **import concept sets from other dictionaries** (including INDICATE’s) instead of redefining the same variables — see [Sharing concept sets](?section=sharing-concept-sets).
