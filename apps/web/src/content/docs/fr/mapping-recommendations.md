<!-- TODO(v2): the "Propose on {{forge.name}}" export and the local edit mode are v1 behaviour; rewrite with v2 editing (server drafts, automatic PR/MR). -->

# Recommandations de mapping

L’onglet **Recommandations de mapping** fournit des recommandations expertisées pour mapper les variables cliniques locales vers les concepts OMOP standards. Il côtoie l’onglet Projets de mapping sur la page Alignement de concepts.

## Que sont les recommandations de mapping ?

Lors d’un processus ETL pour convertir des données cliniques locales vers le CDM OMOP, décider comment mapper chaque variable locale vers des concepts standards est l’une des étapes les plus complexes. Les recommandations de mapping fournissent des conseils structurés pour les variables courantes des bases de données de réanimation.

## Visualisation

Le contenu est rendu en Markdown avec mise en forme riche (tableaux, liens, listes). Une table des matières à droite suit votre position dans le document au fil du défilement.

Deux boutons sont disponibles en haut de la barre latérale droite :

- **Export** — ouvre le modal d’export (voir ci-dessous)
- **Éditer** — passe en mode édition pour modifier le contenu

## Édition

En mode édition, un éditeur ACE avec coloration syntaxique Markdown s’ouvre à côté d’un panneau d’aperçu en direct. Les deux panneaux défilent en synchronisation pour ne pas perdre votre repère sur les longues sections.

Le contenu est multilingue — changer de langue sauvegarde le texte actuel et charge l’autre langue.

## Export

Cliquez sur **Export** pour ouvrir le modal d’export :

| Option | Description |
|---|---|
| **Télécharger** | Télécharger en fichier mapping_recommendations.json |
| **Copier** | Copier le JSON dans le presse-papiers |
| **Proposer sur {{forge.name}}** | Copier et ouvrir l’éditeur {{forge.name}} |

- **Télécharger** — télécharge `mapping_recommendations.json`, à placer dans le dossier `mapping_recommendations/` du dépôt Git
- **Copier** — copie le contenu JSON dans le presse-papiers
- **Proposer sur {{forge.name}}** — copie dans le presse-papiers et ouvre l’éditeur {{forge.name}} pour proposer des modifications via une pull request
