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

## Scènes déclenchées par la vigilance

Vous pouvez créer une scène qui se déclenche quand une vigilance est émise, par exemple pour recevoir un SMS en cas de vigilance orange.

Dans l'éditeur de scène, ajoutez un déclencheur **« Alerte météo émise »** ou **« Alerte météo terminée »**, puis choisissez la maison, éventuellement le type de phénomène et le niveau minimum.

Gladys vérifie les alertes toutes les 30 minutes. Cette intégration surveille en plus la vigilance toutes les 15 minutes et prévient Gladys dès qu'elle change : votre scène se déclenche donc en quelques secondes plutôt qu'en attendant la vérification suivante.

## Carte de vigilance (optionnel)

L'affichage de la carte nationale nécessite une clé d'API personnelle, gratuite :

1. Créez un compte sur le [portail API de Météo France](https://portail-api.meteofrance.fr/).
2. Souscrivez à l'API **« Données Publiques de Vigilance »** (gratuite).
3. Copiez la clé d'API générée.
4. Dans Gladys, ouvrez l'écran **Configuration** de l'intégration Météo France, collez la clé et enregistrez.

Sans cette clé, tout le reste continue de fonctionner normalement : seule la carte n'est pas disponible.

## Zone couverte

Météo France couvre **la France métropolitaine et les départements d'outre-mer**. Pour une maison située en dehors de cette zone, l'intégration ne renvoie pas de données et Gladys bascule automatiquement sur un autre service météo si vous en avez configuré un.

## Priorité sur OpenWeather

Si vous aviez déjà configuré OpenWeather, l'installation de Météo France prend automatiquement le relais, sans réglage. Si vous arrêtez ou désinstallez l'intégration, Gladys revient tout aussi automatiquement à OpenWeather.
