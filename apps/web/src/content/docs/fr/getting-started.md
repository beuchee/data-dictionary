<!-- TODO(v2): v1 getting started (browser-only app, header navigation, profile dialog, EN/FR toggle, edits in localStorage shared through the forge workflow). Rewrite for v2: sidebar navigation, login and accounts in server mode, server drafts. -->

# Prise en main

L’application fonctionne entièrement dans le navigateur — aucune installation ni serveur requis. Ouvrez simplement la page web et commencez à naviguer.

## Visite rapide

La barre de navigation en haut donne accès aux sections principales :

- **Dictionnaire de données** — Parcourir et rechercher les jeux de concepts ([détails](?section=browsing))
- **Alignement de concepts** — Évaluer l’éligibilité aux projets INDICATE à partir de votre source-to-concept map, et consulter les recommandations de mapping ([détails](?section=mapping-projects))
- **Projets** — Grouper les jeux de concepts par projet de recherche ([détails](?section=projects))
- **Documentation** — Cette page

## Optionnel : Importer les vocabulaires OHDSI

Pour les fonctionnalités avancées (recherche de concepts, expansion des descendants, visualisation hiérarchique, optimisation des expressions), vous pouvez importer les fichiers de vocabulaires OHDSI dans une base DuckDB locale qui fonctionne dans le navigateur. Voir [Vocabulaires OHDSI](?section=dictionary-settings).

## Profil utilisateur

Cliquez sur votre nom en haut à droite pour configurer votre profil.

L’onglet **Auteur** contient votre nom, affiliation, profession et ORCID — ces informations sont intégrées aux jeux de concepts que vous créez ou relisez.

L’onglet **Organisation** permet de définir le nom et l’URL de l’organisation qui apparaîtront dans les métadonnées des jeux de concepts.

La fenêtre de profil (**Modifier le profil**) comporte deux onglets :

| Onglet | Champ | Exemple |
|---|---|---|
| Auteur | Prénom * | John |
| Auteur | Nom * | Doe |
| Auteur | Affiliation | University Hospital |
| Auteur | Profession | Intensivist |
| Auteur | ORCID | 0000-0001-2345-6789 |
| Organisation | Nom de l’organisation * | {{organization.name}} |
| Organisation | URL | {{organization.url}} |

## Langue

Basculez entre anglais et français avec le bouton **EN**/**FR** dans l’en-tête. Les noms, catégories et descriptions des jeux de concepts sont multilingues (actuellement anglais et français). Le support d’autres langues pourra être ajouté à l’avenir.

## Stockage local

Toutes vos modifications (jeux de concepts, projets, relectures) sont stockées dans le stockage local de votre navigateur. Elles persistent entre les sessions mais restent locales à votre navigateur. Pour partager des modifications, utilisez le [workflow {{forge.name}}](?section=reviewing).
