<!-- TODO(v2): the import flow and "Propose on {{forge.name}}" are v1 (SPA, localStorage). Rewrite when v2 import and server drafts land; the provenance fields (uniqueId, organization, sourceRepo, origin) stay valid. -->

# Partager des jeux de concepts

Les forks ne sont pas isolés. Un jeu de concepts créé dans un dictionnaire — le vôtre, celui d’INDICATE ou tout autre fork — peut être **importé dans un autre**, pour que les équipes réutilisent le travail des autres au lieu de redéfinir les mêmes variables cliniques. Comme tous les dictionnaires partagent le même format JSON, un import n’est qu’une copie du fichier accompagnée d’un peu de traçabilité.

## Importer depuis un autre dictionnaire

Dans la liste des jeux de concepts, cliquez sur **Importer**. Deux modes :

- **Depuis un dépôt** — collez l’URL du dépôt d’un autre dictionnaire (par ex. `https://github.com/indicate-eu/data-dictionary`). L’application charge son catalogue publié et liste tous les jeux de concepts dans un tableau triable et filtrable. Chaque ligne est marquée **Nouveau**, **Déjà importé** ou **Conflit** (vous avez ce jeu dans une version différente — l’import écrase votre copie locale). Cochez ceux voulus et importez.
- **Depuis un seul jeu de concepts** — collez une URL JSON brute (une URL de page GitHub `/blob/` est convertie automatiquement en sa forme brute) et prévisualisez-la, ou collez directement le JSON et importez en un clic.

Les jeux importés arrivent dans votre catalogue local ; relisez-les, puis [Proposez sur {{forge.name}}](?section=reviewing) pour les commiter dans votre dépôt.

## Comment le partage reste traçable

Quatre champs de métadonnées (sous `metadata` dans chaque `concept_sets/<id>.json`) gardent un jeu partagé traçable jusqu’à sa source. Vous ne les modifiez jamais à la main — l’application les écrit à la création, à l’édition et à l’import :

- **`uniqueId`** — un UUID identifiant la *lignée* du jeu de concepts. Généré une fois à la création et **conservé tel quel à l’import**, le même jeu garde donc le même id partout où il voyage. Un `uniqueId` est unique au sein d’un dépôt : importer un id que vous avez déjà l’ignore (même version) ou écrase votre copie (version différente) — jamais de doublon.
- **`organization`** — divisé en `created` (l’équipe auteure, immuable) et `current` (qui maintient le contenu actuel). À l’import, `current` devient *votre* organisation tandis que `created` reste l’auteur d’origine.
- **`sourceRepo`** — le dépôt qui maintient actuellement l’objet, rafraîchi à chaque édition. Vivant dans le JSON, il survit même à un copier-coller manuel.
- **`origin`** — la provenance d’une copie importée, écrite **une seule fois à l’import** puis figée : `{ uniqueId, repo, version, commit, organization, importedDate }`. Le `commit` est le SHA exact de la source, vous pouvez donc toujours récupérer la version précise dont votre copie est tirée. Pour les jeux créés dans votre propre dictionnaire, `origin` vaut `null`.

> [!NOTE]
> **Le modèle de fork, en une ligne**\
> Importer, c’est **forker un seul jeu de concepts** : même `uniqueId` (lignée partagée), votre `organization.current`, un `origin` figé pointant vers la source. Deux dictionnaires peuvent alors faire évoluer le même jeu indépendamment, et `origin` + `uniqueId` rendent la relation — et toute divergence — explicite.

L’id dans le nom du fichier (`concept_sets/383.json`) est un id d’affichage **local**, réattribué à l’import pour éviter les collisions. La correspondance entre dictionnaires se fait toujours sur `uniqueId`, jamais sur ce numéro.
