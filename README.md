# combocraft-generation-7896542669536
Shake well before use


# Unique Random Combiner (GitHub Pages)

Application web statique (hébergée sur GitHub Pages) permettant à un utilisateur final de :
- sélectionner **1 à N listes** de données,
- générer une **combinaison aléatoire unique** (non répétée) pour cette sélection,
- obtenir le résultat au **format JSON**,
- copier le JSON via un bouton **Copier**,
- visualiser des compteurs **Total / Restant / Déjà tirées**,
- relancer un cycle via un bouton **Reset** (réinitialise l’unicité pour la sélection actuelle).

> Aucun backend, aucun compte : tout fonctionne en front (statique) + persistance locale.

---

## Fonctionnement (règles produit)

### 1) Sélection dynamique (“recette”)
L’utilisateur peut changer la sélection à chaque tirage :
- Ex. `{Pommes + Couleurs}`
- puis `{Pommes + Temps + Couleurs}`
- puis `{Pommes + Temps + Étoiles}`

Chaque sélection correspond à une **recette** indépendante.

### 2) Unicité
L’application garantit **non-répétition par recette** :
- Pour une même recette, une combinaison déjà tirée ne ressort pas tant qu’il reste des combinaisons possibles.
- Pour une autre recette, l’unicité est gérée séparément.

### 3) Reset
Le bouton **Reset** réinitialise l’unicité **pour la recette active uniquement** (la sélection courante).
- Les listes restent sélectionnées.
- Les compteurs reviennent à l’état initial.

### 4) Compteurs
Pour la recette active :
- **Total possible** = produit des tailles des listes sélectionnées
- **Déjà tirées** = nombre de combinaisons uniques déjà générées pour cette recette
- **Restant** = Total possible − Déjà tirées

Quand **Restant = 0**, le bouton **Générer** est désactivé et l’UI propose un reset.

---

## Stockage (pas d’historique UI, état technique minimal)
L’application n’affiche pas d’historique à l’utilisateur.

Pour garantir l’unicité, elle conserve un registre technique minimal :
- stocké en `localStorage` dans le navigateur
- uniquement des identifiants (hash) des combinaisons déjà tirées par recette

---

## Gestion des listes (repo + end user)

### Mode repo (données versionnées)
Le repo contient un catalogue et des fichiers de listes JSON. C’est le mode idéal pour publier des listes “officielles”.

### Mode end user (import/export local, sans backend)
GitHub Pages est un hébergement statique : l’application ne peut pas écrire dans le repo depuis le navigateur.
Pour permettre à un utilisateur final d’ajouter/modifier des listes, l’app fournit :
- **Importer** des fichiers JSON (catalogue ou liste)
- **Exporter** le catalogue local (index + listes importées)
- **Reset global (local)** : supprime listes importées + état local

Ces éléments sont accessibles dans l’interface via **“Gérer mes listes”** et **“Aide / Format des listes”**.

---

## Contrat de données (format final)

### 1) Catalogue des listes — `data/index.json`
Ce fichier déclare les listes visibles dans le catalogue (cartes).

```json
{
  "version": 1,
  "lists": [
    {
      "id": "kirby_worlds",
      "label": "Univers & mondes – Kirby",
      "description": "Optionnel",
      "tags": ["gaming", "kirby", "worlds"],
      "path": "data/lists/kirby_worlds.json"
    }
  ]
}




Règles :

id unique et stable (snake_case recommandé)

path = chemin exact vers le fichier JSON de la liste

tags utilisés pour recherche/filtre dans l’UI

2) Fichier d’une liste — data/lists/<id>.json

Chaque liste contient des items tirables. On utilise des objets pour rester extensible.


{
  "id": "kirby_worlds",
  "label": "Univers & mondes – Kirby",
  "version": 1,
  "items": [
    {
      "id": "dream_land",
      "label": "Dream Land",
      "tags": ["classic"],
      "weight": 1,
      "meta": {}
    }
  ]
}




Règles :

items[].id unique dans la liste (slug recommandé)

weight optionnel (par défaut 1) — réservé à une pondération future

meta optionnel (hiérarchie, catégorie, source, etc.), sans impact sur le moteur de base

Format du JSON de sortie (généré)

Le générateur produit un JSON exploitable :

recipe_id : identifiant stable de la recette (basé sur les listes sélectionnées)

selected_lists : listes choisies (id + label)

result : mapping list_id -> {id, label} de l’item tiré

combination_id : identifiant unique de la combinaison (hash)

generated_at : timestamp ISO



Structure du repo




/
├─ index.html
├─ assets/
│  ├─ app.js
│  └─ styles.css
└─ data/
   ├─ index.json
   └─ lists/
      ├─ kirby_worlds.json
      └─ software_testing_themes.json






Ajouter une nouvelle liste (sans changer le code)
Option 1 — Dans le repo (publication)

Créer un fichier dans data/lists/ (ex. finance_topics.json)

Ajouter son entrée dans data/index.json (id, label, path, tags)

Déployer (GitHub Pages) : la liste apparaît automatiquement dans l’UI

Option 2 — Côté utilisateur (import local)

Préparer un fichier JSON au format catalogue ou liste

Utiliser Gérer mes listes → Importer

(Optionnel) Exporter ensuite l’état local pour le sauvegarder

Déploiement GitHub Pages

Dans les réglages du repo GitHub :

Settings → Pages

Source : Deploy from a branch

Branch : main (ou master) / folder : / (root)

Enregistrer

Le site devient accessible via l’URL GitHub Pages du repo.

Roadmap technique (MVP)

UI “catalogue de listes” (cartes) + sélection en chips

Import/Export local des listes

Génération aléatoire unique par recette

Compteurs total/restant/déjà tirées

Boutons : Générer / Copier JSON / Reset

Gestion des cas limites : liste vide, aucune liste sélectionnée, épuisement, etc.




Si tu veux, je peux aussi te fournir une version “ultra courte” du README (1 écran) pour la page d’accueil GitHub, et garder la version détaillée dans `/docs/`.





