# Sources

Cette page recense l’ensemble des sources externes utilisées par {{app.name}}, et indique précisément le fichier et la colonne où chaque information est extraite. Elle sert à auditer une valeur, mettre à jour le dictionnaire vis-à-vis d’une nouvelle release, ou ajouter un nouveau jeu de concepts.

## Descriptions des jeux de concepts

Les descriptions des jeux de concepts (sections *Définition & contexte clinique*, *Concepts inclus*, *Concepts exclus*, *Notes de mapping* affichées dans l’onglet Commentaires) sont rédigées à partir de quatre sources terminologiques principales, par ordre de priorité. Quand le jeu de concepts contient des concepts **LOINC**, LOINC est utilisé en priorité — ses *Part descriptions* fournissent des définitions concises et directement exploitables pour le mapping. **SNOMED CT** vient ensuite, en particulier pour les constatations cliniques, les actes et les entités observables. **UMLS** sert de source de repli quand LOINC et SNOMED sont pauvres, et les **sources web** sont mobilisées en dernier recours.

### 1. LOINC

Édité et distribué par le Regenstrief Institute (Indianapolis, États-Unis). Source privilégiée dès lors que le jeu de concepts contient des concepts LOINC — ses *Part descriptions* fournissent des définitions concises et directement exploitables pour le mapping.

- **Téléchargement** : [https://loinc.org/downloads/](https://loinc.org/downloads/) (gratuit, inscription requise).
- **Fichier utilisé** : `LoincTable/Loinc.csv` dans la distribution LOINC.
- **Colonnes clés** :
    - `LOINC_NUM` — le code LOINC.
    - `COMPONENT`, `PROPERTY`, `TIME_ASPCT`, `SYSTEM`, `SCALE_TYP`, `METHOD_TYP` — les six axes de la décomposition LOINC.
    - `LONG_COMMON_NAME` — nom complet développé.
    - `CONSUMER_NAME` — nom grand public.
    - `RELATEDNAMES2` — mots-clés associés.
    - `EXAMPLE_UCUM_UNITS` — unité UCUM la plus fréquemment observée.
    - `CLASS` — classe LOINC.
    - `ORDER_OBS` — prescription / observation.
- **Fichiers complémentaires** : `AccessoryFiles/PartFile/Part.csv` pour les descriptions de composants (*Part*), `AccessoryFiles/ConsumerName/ConsumerName.csv` pour les noms grand public.
- **Complément web** : pages par code à l’URL `https://loinc.org/{loinc_code}/` — la section *Part description* est la source préférée pour définir la grandeur mesurée.

### 2. SNOMED CT

Édité par SNOMED International (Royaume-Uni). Distribué aux États-Unis par la National Library of Medicine, et dans les autres pays par les centres nationaux de release. Utilisé en priorité pour les jeux de concepts sans concepts LOINC (constatations cliniques, actes, entités observables).

- **Téléchargement** : [https://www.nlm.nih.gov/healthit/snomedct/international.html](https://www.nlm.nih.gov/healthit/snomedct/international.html) (gratuit, licence UMLS requise).
- **Format** : archive RF2 (par ex. `SnomedCT_InternationalRF2_PRODUCTION_20251101T120000Z.zip`).
- **Fichiers utilisés** (dans `Snapshot/Terminology/`) :
    - `sct2_Description_Snapshot-en_*.txt` — Fully Specified Names (FSN) et synonymes. Colonnes :
        - `id` — identifiant de la description.
        - `conceptId` — identifiant du concept SNOMED.
        - `languageCode` — langue (par ex. `en`).
        - `typeId` — type de description (`900000000000003001` = FSN, `900000000000013009` = Synonyme).
        - `term` — le libellé.
    - `sct2_TextDefinition_Snapshot-en_*.txt` — définitions textuelles complètes (disponibles seulement pour ~3,6 % des concepts). Colonnes :
        - `conceptId` — identifiant du concept SNOMED.
        - `term` — le texte de la définition.

### 3. UMLS

UMLS Metathesaurus — édité et distribué par la US National Library of Medicine. Utilisé comme source de repli pour les définitions cliniques quand la *Part description* LOINC et SNOMED sont pauvres ou absentes.

- **Téléchargement** : [https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html](https://www.nlm.nih.gov/research/umls/licensedcontent/umlsknowledgesources.html) (gratuit, licence UMLS requise). Utiliser le *Metathesaurus Full Subset*.
- **Fichiers utilisés** (format RRF, séparateur pipe) :
    - `MRCONSO.RRF` — noms et synonymes des concepts. Filtrer sur `LAT=ENG` et le vocabulaire source souhaité (`SAB`, par ex. `MSH`, `NCI`, `SNOMEDCT_US`) pour remonter au CUI parent de la grandeur mesurée.
    - `MRDEF.RRF` — définitions. Recherche par CUI ; sources préférées par ordre : `MSH` (MeSH), `NCI` (NCI Thesaurus), `CSP` (CRISP), `ICF`, `HPO`, `MEDLINEPLUS`.
    - `MRSTY.RRF` — type sémantique (par ex. *T201 — Clinical Attribute*).
    - `MRREL.RRF` — relations (parent/enfant, concepts liés).

### 4. Sources web

Sources de dernier recours, citées dans la section *Références*.

Pour les concepts de niche où LOINC, SNOMED et UMLS sont insuffisants, des recommandations cliniques révisées par les pairs, des prises de position de sociétés savantes ou des références médicales établies (StatPearls, UpToDate, sites de sociétés savantes) peuvent être citées. Toute source web est consignée dans la section *Références* de la description (numérotée, format Vancouver, avec URL cliquable).

## Unités recommandées

Stockées dans `units/recommended_units.json`.

L’unité recommandée pour chaque concept de mesure provient de deux sources, par ordre de priorité. Pour les mesures de laboratoire, **NPU** est la source primaire — il s’agit de la référence IFCC/IUPAC qui publie explicitement l’unité SI / IFCC recommandée pour chaque mesurande. Quand NPU ne couvre pas la mesure, **LOINC `EXAMPLE_UCUM_UNITS`** est utilisé en repli (l’unité la plus fréquemment observée en pratique pour ce code LOINC). Pour les mesures non biologiques (signes vitaux, anthropométrie, scores, doses médicamenteuses), aucune source formelle n’est encore retenue.

### 1. NPU

Source primaire pour les mesures de laboratoire. *Nomenclature for Properties and Units* (IFCC / IUPAC). NPU est plus large que JCTLM (il couvre les concentrations, activités, ratios, panels qualitatifs) et publie explicitement à la fois la variante SI et la variante conventionnelle quand les deux sont en usage (ex. `µkat/L` et `U/L` pour les activités enzymatiques).

- **Téléchargement** : [https://npu-terminology.org/npu-database/](https://npu-terminology.org/npu-database/) (gratuit).
- **Fichier utilisé** : la dernière version `npu-codes-latest.csv`.
- **Colonnes clés** :
    - `npu_code` — le code NPU.
    - `system` — échantillon (ex. `Plasma`, `Serum`, `Capillary blood`, `Blood`, `Patient(blood)`).
    - `component` — la grandeur mesurée (ex. *Bilirubins*, *Glucose*).
    - `kind_of_property` — type de propriété (ex. *substance concentration*, *catalytic activity concentration*).
    - `unit` — nom complet de l’unité (ex. *micromole per litre*).
    - `unit_short` — forme courte type UCUM (ex. `µmol/L`, `µkat/L`, `U/L`).
    - `active` — `1` pour les lignes actives.
- **Filtre** : `active = 1` et `component` correspondant à la grandeur mesurée. Pour les enzymes, deux lignes existent généralement (variante SI `µkat/L` et variante conventionnelle `U/L`) — les deux sont acceptées ; choisir la variante réellement rapportée par les laboratoires.

### 2. LOINC (repli)

Utilisé quand la mesure n’est pas couverte par NPU. L’unité recommandée est lue dans la colonne `EXAMPLE_UCUM_UNITS` de `LoincTable/Loinc.csv`. Une unité choisie à partir de LOINC seul ne doit pas être présentée comme l’« unité SI » ou « recommandée par l’IFCC » — ces affirmations requièrent NPU comme source citable.

- **Fichier** : `LoincTable/Loinc.csv` (distribution LOINC — voir section précédente pour le téléchargement).
- **Colonne** : `EXAMPLE_UCUM_UNITS` — l’unité UCUM la plus fréquemment observée en pratique pour ce code LOINC, telle que publiée par Regenstrief.
- **Valeurs multiples** : la colonne peut lister plusieurs unités séparées par `;` (ex. `mg/dL;mg/L` pour certains dosages d’albumine). Choisir celle qui correspond au `PROPERTY` LOINC (`µmol/L` pour *SCnc* / *Moles/volume*, `mg/dL` pour *MCnc* / *Mass/volume*) ; quand le *property* ne désambiguïse pas, choisir celle la plus utilisée en pratique et documenter le choix.

### 3. Mesures non biologiques

Pour les signes vitaux, l’anthropométrie, les scores cliniques, les doses médicamenteuses et autres mesures non biologiques, la méthodologie pour choisir une unité recommandée n’est **pas encore définie** : la colonne LOINC `EXAMPLE_UCUM_UNITS` est peu renseignée dans ces domaines, NPU ne les couvre pas, et aucune référence transversale n’a été retenue à ce jour. Pour l’instant, les unités recommandées dans ces domaines sont renseignées au cas par cas (recommandations cliniques, usage courant).

## Facteurs de conversion

Stockés dans `units/unit_conversions.json`.

Les facteurs de conversion proviennent de la référence nationale française pour les échanges de résultats de biologie :

- **Source** : *Jeu de valeurs Circuit de la biologie*, publié par l’**Agence du Numérique en Santé (ANS)** dans le cadre du Cadre d’Interopérabilité des Systèmes d’Information de Santé (CI-SIS).
- **Page de présentation** : [https://smt.esante.gouv.fr/terminologie-jeu-de-valeurs-circuit-de-la-biologie/](https://smt.esante.gouv.fr/terminologie-jeu-de-valeurs-circuit-de-la-biologie/)
- **Téléchargement** : l’archive ZIP liée depuis la page ci-dessus (par ex. `terminologie-jeu-de-valeurs-circuit-de-la-biologie-1.1.23.zip`). Le fichier exploité est `dat/ANS_JDV_CircuitBio.xlsx`.
- **Feuille** : `1.JDV_CircuitBio` — une ligne par code LOINC présent dans le jeu de valeurs national (~7 100 lignes en v1.1.23).
- **Mise en page de l’en-tête** : la ligne 1 est un bandeau thématique (ex. *Renseignements prélèvements*, *ANALYSES PORTEUSES DE RESULTAT*), la ligne 2 contient les en-têtes de colonnes, les données commencent ligne 3.
- **Colonnes clés** :
    - Colonne 19 — `LOINC` — le code LOINC de la mesure (ex. `14749-6`).
    - Colonne 20 — *Libellés français de référence*.
    - Colonne 24 — *Unité recommandée* — l’unité recommandée (ex. `mmol/L`).
    - Colonne 25 — *Unité UCUM* — l’unité au format UCUM.
    - Colonne 27 — *Correspondance* — le code LOINC du test partenaire (même mesure, unité alternative ; ex. `14749-6` Glucose *mmol/L* ↔ `2345-7` Glucose *g/L*).
    - Colonne 28 — *Facteur de conversion des unités* — le facteur multiplicatif pour convertir l’unité de la ligne courante vers l’unité de la ligne partenaire (ex. `0,18` de `mmol/L` Glucose vers `g/L`, `5,551` dans le sens inverse).
- **Mapping vers INDICATE** : chaque ligne ANS produit (au plus) une entrée dans `units/unit_conversions.json` avec `conceptId` = ID OMOP du code LOINC en colonne 19, `sourceUnitCode` = colonne 24, `targetUnitCode` = colonne 24 de la ligne partenaire, `conversionFactor` = colonne 28. Les deux directions sont stockées comme deux lignes distinctes (une ligne par direction, conformément au schéma documenté).
- **Documentation associée** : `doc/Guide_Implementation_JDV_Circuit_de_biologie.pdf` et `doc/ANS_Note_de_version_JDV_Circuit_de_Biologie.pdf` dans le ZIP décrivent la sémantique des colonnes, le workflow de validation et les notes de version.

### Conversions affines

La plupart des conversions sont purement multiplicatives (`cible = facteur × source`). Quelques analytes nécessitent une conversion **affine** de la forme `cible = facteur × source + offset`. Chaque entrée peut porter un champ optionnel `offset` ; lorsqu’il est absent ou égal à `0`, la conversion reste multiplicative (les entrées existantes ne sont donc pas affectées). Exemple — HbA1c `NGSP %` ↔ `IFCC mmol/mol` : `IFCC ≈ 10,929 × NGSP − 23,50`. L’export SQL OMOP et le testeur de conversion intégré appliquent tous deux l’offset.

## Vocabulaire OMOP

Chaque concept du dictionnaire est associé à un `concept_id` OMOP. Les métadonnées des concepts (`concept_name`, `concept_code`, `vocabulary_id`, `domain_id`, `concept_class_id`, `standard_concept`, `valid_start_date`, `valid_end_date`) sont chargées à partir des tables vocabulaire OHDSI Athena.

- **Téléchargement** : [https://athena.ohdsi.org/](https://athena.ohdsi.org/) (gratuit, compte OHDSI requis). Sélectionnez les vocabulaires nécessaires (LOINC, SNOMED, RxNorm, ATC, UCUM, etc.) et téléchargez-les au format CSV.
- **Tables utilisées** : `CONCEPT`, `CONCEPT_ANCESTOR`, `CONCEPT_RELATIONSHIP`, `CONCEPT_SYNONYM`, `RELATIONSHIP`, `VOCABULARY`, `DOMAIN`, `CONCEPT_CLASS`, optionnellement `DRUG_STRENGTH`.
- **Recherche par concept** : `https://athena.ohdsi.org/search-terms/terms/{conceptId}` (lié depuis chaque concept dans l’application).
- **Requête locale** : les mêmes CSV peuvent être chargés dans la base DuckDB-WASM intégrée au navigateur (voir [Paramètres du dictionnaire](?section=dictionary-settings) → Paramètres généraux → Import du vocabulaire) puis interrogés depuis [Outils de développement](?section=dev-tools).

## UCUM

Tous les codes d’unités du dictionnaire suivent la syntaxe UCUM (*Unified Code for Units of Measure*). UCUM est également distribué comme un vocabulaire OMOP (chaque unité a un `concept_id` OMOP, par ex. `8753 — mmol/L`, `8636 — g/L`, `8554 — %`).

- **Spécification** : [https://ucum.org/ucum](https://ucum.org/ucum)
- **Distribution comme vocabulaire OMOP** : téléchargement via Athena (voir ci-dessus) puis recherche des codes avec `SELECT * FROM concept WHERE vocabulary_id = 'UCUM';`
