<!-- TODO(v2): describes v1, a fully client-side app keeping every edit in localStorage with a "Data Update Available" merge modal and "Reset local data". v2 (server mode) keeps content on the server with drafts; rewrite this page for v2 and keep only what still applies (IndexedDB vocabulary database, static mode). -->

# Données locales

Le {{app.name}} est une **application entièrement côté client**. Toutes les données sont stockées localement dans votre navigateur — rien n’est envoyé vers un serveur.

## Fonctionnement

L’application utilise deux mécanismes de stockage du navigateur :

- **localStorage** — stocke les jeux de concepts, projets, recommandations de mapping, conversions d’unités, unités recommandées, profil utilisateur, relectures et préférences de langue. Toutes vos modifications (ajout, modification, suppression) sont sauvegardées ici.
- **IndexedDB** — stocke la base de vocabulaires OHDSI, propulsée par [DuckDB-WASM](https://duckdb.org/docs/api/wasm/overview). C’est une base SQL complète fonctionnant entièrement dans votre navigateur, permettant la recherche de concepts, la visualisation hiérarchique et la résolution d’expressions sans aucun serveur.

Vos données persistent entre les sessions et les redémarrages du navigateur.

## Mises à jour des données

Quand l’application est déployée sur {{forge.name}} Pages, les données sources (jeux de concepts, projets, etc.) peuvent être mises à jour par les contributeurs via des pull requests.

Lorsque vous visitez l’application et que de nouvelles données sont disponibles, un modal apparaît — **Mise à jour disponible** (*Le dictionnaire de données a été mis à jour.*), avec la liste des *3 jeu(x) de concepts modifié(s) à distance* :

| ID | Nom | Version | Modifié |
|--:|---|---|---|
| 207 | Plasma glucose | 1.0.0 → 1.1.0 | 2025-03-10 → 2025-04-01 |
| 341 | Certoparin | 1.0.0 → 1.0.1 | 2025-03-15 → 2025-04-02 |
| 342 | Decision authority documented | — | **Nouveau** |

Boutons : **Plus tard**, **Appliquer**.

- **Appliquer** — fusionne les mises à jour distantes dans vos données locales. Si vous avez des modifications locales sur les mêmes jeux de concepts, le modal met en évidence les conflits et vous laisse choisir entre votre version locale et la version distante pour chacun.
- **Plus tard** — ferme le modal et conserve vos données locales inchangées. Le message réapparaîtra lors de votre prochaine visite.

## Réinitialiser les données locales

Pour supprimer toutes les modifications locales et repartir avec la dernière version déployée, ouvrez le menu Paramètres (engrenage, en haut à droite du header) et cliquez sur **Réinitialiser les données locales** :

Le menu liste **Paramètres du dictionnaire** et **Outils de développement**, puis, après un séparateur, **Réinitialiser les données locales** (en rouge).

Cela efface toutes les données localStorage (jeux de concepts, projets, relectures, profil, préférences) et recharge l’application avec les données originales de {{forge.name}} Pages.

> [!WARNING]
> **Attention**\
> La réinitialisation est irréversible. Assurez-vous d’**exporter** tout travail que vous souhaitez conserver avant de réinitialiser. Voir [Exporter](?section=exporting) et [Relecture & {{forge.name}}](?section=reviewing).

## Base de vocabulaires OHDSI

La base de vocabulaires stockée dans IndexedDB est indépendante de l’action Réinitialiser les données locales. Pour la gérer, utilisez l’onglet **Vocabulaires OHDSI** dans [Paramètres du dictionnaire](?section=dictionary-settings).
