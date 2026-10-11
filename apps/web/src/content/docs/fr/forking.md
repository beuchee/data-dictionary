<!-- TODO(v2): describes forking the v1 static SPA (docs/ on GitHub/GitLab Pages, reset.py, update_from_upstream.py, "Propose on GitHub"). Rewrite for v2 deployment (static build or Docker server mode, first-run setup, branding screen) at the cutover. -->

# Forker le dictionnaire

Cette application est un **modèle**. N’importe quelle équipe — une spécialité, un registre, un seul hôpital — peut en dériver son propre dictionnaire de données gouverné : même application, même format, votre contenu, sur un hébergement statique gratuit (GitHub Pages ou GitLab Pages). Aucun serveur à gérer.

> [!NOTE]
> **Guide complet**\
> Cette page est une vue d’ensemble. Le guide détaillé, commande par commande, se trouve dans [FORKING.md]({{repository.blobUrl}}/FORKING.md) à la racine du dépôt (installation initiale, usage quotidien, mises à jour amont, déploiement).

## 1. Créer votre dépôt

Sur GitHub, utilisez **« Use this template »** → *Create a new repository* (cela donne un historique propre, pas un fork lié à INDICATE). Sur GitLab, importez le dépôt par URL — le `.gitlab-ci.yml` fourni fait fonctionner GitLab Pages sans configuration.

## 2. L’approprier : `config.json`

Un seul fichier à la racine identifie le dictionnaire comme le vôtre — titre, organisation, dépôt GitHub, identité visuelle, préfixe de vocabulaire :

```json
{
  "title": "Dictionnaire de mon équipe",
  "repository": { "url": "https://github.com/mon-org/mon-repo",
                  "repo": "mon-org/mon-repo", "branch": "main",
                  "upstream": "https://github.com/indicate-eu/data-dictionary.git" },
  "organization": { "name": "Mon équipe", "url": "https://mon-equipe.example.org" },
  "customVocabulary": { "id": "MONEQUIPE", "codePrefix": "MONEQUIPE-" }
}
```

`repository.upstream` reste pointé vers INDICATE pour pouvoir récupérer les mises à jour de code. `organization` devient l’auteur par défaut des nouveaux jeux de concepts.

## 3. Effacer le contenu INDICATE

Remplacez les éléments de marque dans `docs/` (`logo.png`, `favicon.png`), puis videz le contenu d’exemple :

```bash
python3 reset.py
```

Cela vide `concept_sets/`, `projects/` et réinitialise les compteurs d’id, tout en conservant le contenu générique (conversions d’unités, recommandations de mapping) et votre configuration. Puis reconstruit `docs/data.json`.

## 4. Ajouter votre contenu & déployer

Créez des jeux de concepts dans la SPA (puis *Proposer sur {{forge.name}}*), ou modifiez `concept_sets/<id>.json` directement et lancez `python3 build.py`. Puis activez Pages : GitHub → *Settings → Pages → Deploy from a branch → main / `/docs`*. Chaque push redéploie.

## 5. Rester à jour

INDICATE continue de livrer corrections et fonctionnalités. Récupérez-les dans votre fork sans toucher à votre contenu :

```bash
python3 update_from_upstream.py
```

Il met à jour les fichiers de code (scripts, `docs/*.js|html|css`, skills, `CLAUDE.md`, `FORKING.md`) depuis l’amont et laisse intacts vos `concept_sets/`, `projects/`, `config.json` et votre identité visuelle.

> [!NOTE]
> **Réutiliser, pas réinventer**\
> Les forks ne sont pas des îlots. Vous pouvez **importer des jeux de concepts depuis d’autres dictionnaires** (dont celui d’INDICATE) au lieu de redéfinir les mêmes variables — voir [Partager des jeux de concepts](?section=sharing-concept-sets).
