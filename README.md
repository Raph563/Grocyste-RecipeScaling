# Grocyste — Quantités et proportions

RecipeScaling adapte les quantités d’une recette à un nombre de parts ou à un ingrédient pivot. Son moteur est aussi utilisé par Budgets et Recette live.

**Manifeste 1.0.0 · Grocy 4.7.1 · CORE >=1.0.0 <2.0.0 · GPL-3.0-only.**

## Installer

Installez le [CORE Grocyste](https://github.com/Raph563/Grocyste), puis ouvrez **Réglages → Grocyste — Assaisonnements** avec un compte administrateur et choisissez ce paquet dans le catalogue signé. Le gestionnaire vérifie signature et dépendances avant activation. La disponibilité publique doit être confirmée par le rapport de publication.

**Dépendances :** Aucun autre addon.

## Utilisation et contrat

Les quantités restent liées aux unités canoniques de Grocy. Températures, numéros d’étape et durées ne sont pas multipliés. Un stock absent ou une conversion inconnue reste qualifié.

## Limites

Les unités d’emballage exigent une contenance prouvée. Une conversion mathématique ne prouve pas une équivalence physique. L’adaptation ne modifie aucune position de recette ni aucun mouvement de stock.

Les addons partagent le contexte JavaScript de Grocy : installez du code auquel vous faites confiance. Le lot cible Grocy 4.7.1 uniquement.

## Développer et vérifier

Node.js 24 ; aucune dépendance npm à installer pour les tests du dépôt.

```sh
npm test
npm run build
```

La CI vérifie tests et construction sans clé privée. Les tests locaux ne remplacent pas la qualification sur une instance Grocy, en cours et à documenter dans le [rapport de compatibilité du CORE](https://github.com/Raph563/Grocyste/blob/main/docs/compatibilite.md).

## Sources et licence

Voir [PROVENANCE.md](PROVENANCE.md) et [LICENSE](LICENSE). Les sources et notices accompagnent le paquet ; `build-files.txt` décrit son contenu exact. Aucun reçu, stock, clé ou donnée privée d’une instance n’est intégré.
