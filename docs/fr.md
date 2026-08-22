# Météo France

Cette intégration fournit à Gladys les **prévisions météo** et la **vigilance officielle** de Météo France. Elle alimente le widget météo du tableau de bord, l'assistant vocal et les scènes déclenchées par une alerte météo.

## Prêt à l'emploi

**Aucune configuration n'est nécessaire.** Les prévisions et la vigilance passent par le service public de Météo France : installez l'intégration, elle fonctionne immédiatement.

Une clé d'API optionnelle permet d'afficher en plus la carte de vigilance nationale (voir plus bas).

## Ce que l'intégration fournit

- **Prévisions heure par heure** sur les 24 prochaines heures : température, ressenti, humidité, pression, vent (vitesse, rafales, direction), pluie et probabilité de précipitations.
- **Prévisions journalières** sur 8 jours : températures mini/maxi, conditions, cumul de pluie, indice UV, lever et coucher du soleil.
- **Vigilance officielle** : les neuf phénomènes de Météo France (vent violent, pluie-inondation, orages, crues, neige-verglas, canicule, grand froid, avalanches, vagues-submersion), avec le nom du département et le bulletin complet.
- **Carte de vigilance** du jour et du lendemain (nécessite la clé d'API).

## Icône d'une journée

L'icône d'une journée résume le **phénomène le plus marquant** de cette journée,
et non le temps qu'il fait à midi.

Météo France publie deux informations différentes : les prévisions heure par
heure, et un résumé daté de midi. Ce résumé décrit le ciel à un instant précis,
si bien qu'il peut annoncer « Ensoleillé » sur une journée dont les heures
portent de la pluie et plusieurs millimètres de cumul. L'intégration se fonde
donc sur les heures de la journée, comme le fait le site de Météo France, et
retient le phénomène qui la caractérise le mieux : une averse l'emporte sur une
éclaircie, un orage sur une averse.

Au-delà du quatrième jour, Météo France ne publie plus le détail horaire :
l'icône provient alors du résumé de midi, seule information disponible.

L'icône peut malgré tout différer de celle de l'application Météo France :
Gladys dispose d'un jeu d'icônes plus restreint, et plusieurs ciels distincts y
partagent la même image.

## Scènes déclenchées par la vigilance

Vous pouvez créer une scène qui se déclenche quand une vigilance est émise, par exemple pour recevoir un SMS en cas de vigilance orange.

Dans l'éditeur de scène, ajoutez un déclencheur **« Alerte météo émise »** ou **« Alerte météo terminée »**, puis choisissez la maison, éventuellement le type de phénomène et le niveau minimum.

Gladys vérifie les alertes toutes les 30 minutes. Cette intégration surveille en plus la vigilance toutes les 15 minutes et prévient Gladys dès qu'elle change : votre scène se déclenche donc en quelques secondes plutôt qu'en attendant la vérification suivante.

## Carte de vigilance (optionnel)

L'affichage de la carte nationale nécessite une clé d'API personnelle, gratuite :

1. Créez un compte sur le [portail API de Météo France](https://portail-api.meteofrance.fr/).
2. Souscrivez à l'API **« Données Publiques de Vigilance »** (gratuite). Elle apparaît aussi sous le nom **« Bulletin Vigilance »**, et `DPVigilance` dans les adresses techniques : c'est la même API.
3. Sur l'écran de configuration de l'API, choisissez le type de token **API Key** (et non OAuth2), saisissez une **durée** de validité longue, puis générez la clé — voir les deux points ci-dessous, c'est là que ça se joue.
4. Dans Gladys, ouvrez l'écran **Configuration** de l'intégration Météo France, collez la clé et enregistrez.

### Clé d'API, et non jeton OAuth2

Sur l'écran **« Configurer l'API Bulletin Vigilance »**, le portail demande un **type de token**. Son guide de démarrage rapide met en avant celui qui ne convient **pas** ici :

|                                               | Utilisable ici | Durée de validité                     |
| --------------------------------------------- | -------------- | ------------------------------------- |
| **API Key**                                   | ✅ **oui**     | celle que vous saisissez              |
| **OAuth2** (jeton du bouton _Generate Token_) | ❌ non         | environ 1 heure, non renouvelable ici |

Cochez donc **API Key**. Un jeton OAuth2 semble fonctionner au début, puis **cesse de marcher au bout d'une heure environ** : la carte disparaît sans message d'erreur particulier. Si votre carte s'affichait et ne s'affiche plus, c'est presque toujours la cause.

### Durée de validité de la clé

Une fois **API Key** coché, le portail affiche un champ **« Durée »** obligatoire, vide par défaut, à renseigner **en secondes**. C'est la durée au bout de laquelle la clé cessera de fonctionner — et donc la carte de vigilance avec elle.

Comme l'intégration utilise cette clé en permanence, saisissez la durée **la plus longue possible**, sans quoi vous devrez la régénérer et la recoller régulièrement.

> **Saisissez `94672800`** (environ 3 ans). C'est la valeur maximale acceptée par le portail : au-delà, il refuse la saisie.

Pour information, si vous préférez une durée plus courte :

| Durée  | Valeur à saisir          |
| ------ | ------------------------ |
| 1 mois | `2592000`                |
| 6 mois | `15552000`               |
| 1 an   | `31536000`               |
| ~3 ans | `94672800` — **maximum** |

Notez la date d'expiration quelque part : le jour venu, la carte s'arrêtera sans prévenir, exactement comme avec un jeton OAuth2. Il suffira alors de générer une nouvelle clé et de la recoller dans Gladys.

Sans cette clé, tout le reste continue de fonctionner normalement : seule la carte n'est pas disponible.

## Durée du cache

Le tableau de bord et l'assistant conversationnel demandent tous les deux la météo, et chaque demande représente deux appels à Météo France. L'intégration réutilise donc une réponse récente pendant la **durée du cache**, réglable dans l'écran **Configuration** (600 secondes par défaut, entre 0 et 3600).

Vous n'avez normalement pas à y toucher : les 600 secondes par défaut conviennent à la grande majorité des installations.

### Quelle valeur choisir

Le réglage s'exprime en **secondes**, entre 0 et 3600 (1 heure).

| Valeur                      | Effet                                            |
| --------------------------- | ------------------------------------------------ |
| **0**                       | aucun cache, chaque demande appelle Météo France |
| **300** (5 min)             | données plus fraîches, davantage d'appels        |
| **600** (10 min) — _défaut_ | bon équilibre, recommandé                        |
| **1800** (30 min)           | moins d'appels, tableau de bord très réactif     |
| **3600** (1 h)              | maximum, prévisions pouvant dater d'une heure    |

Augmenter la valeur n'a rien de risqué : Météo France ne met ses prévisions à jour que quelques fois par heure, donc un cache de 10 à 30 minutes ne vous fait pratiquement rien perdre en fraîcheur, tout en accélérant l'affichage.

Deux points à connaître :

- une vigilance qui change est détectée indépendamment du cache : l'intégration vide le cache et demande à Gladys de recharger immédiatement, donc **vos scènes d'alerte se déclenchent sans attendre l'expiration du cache**, même avec un cache réglé à 1 heure ;
- la valeur **0** désactive le cache et appelle Météo France à chaque demande. L'API de prévisions pouvant mettre jusqu'à 20 secondes à froid, l'affichage du tableau de bord peut alors être nettement plus lent. Réservez-la au diagnostic ponctuel plutôt qu'à un usage permanent.

## Zone couverte

Météo France couvre **la France métropolitaine et les départements d'outre-mer**. Pour une maison située en dehors de cette zone, l'intégration ne renvoie pas de données et Gladys bascule automatiquement sur un autre service météo si vous en avez configuré un.

## Priorité sur OpenWeather

Si vous aviez déjà configuré OpenWeather, l'installation de Météo France prend automatiquement le relais, sans réglage. Si vous arrêtez ou désinstallez l'intégration, Gladys revient tout aussi automatiquement à OpenWeather.
