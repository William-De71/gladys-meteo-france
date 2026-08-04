# Météo France

This integration provides Gladys with **weather forecasts** and the **official vigilance alerts** from Météo France, the French national weather service. It feeds the dashboard weather widget, the voice assistant and the weather-alert scene triggers.

## Ready to use

**No configuration is required.** Forecasts and vigilance alerts go through the Météo France public service: install the integration and it works right away.

An optional API key additionally unlocks the national vigilance map (see below).

## What it provides

- **Hourly forecast** for the next 24 hours: temperature, feels-like, humidity, pressure, wind (speed, gusts, direction), rainfall and precipitation probability.
- **Daily forecast** for up to 8 days: min/max temperatures, conditions, total rainfall, UV index, sunrise and sunset.
- **Official vigilance alerts**: the nine Météo France phenomena (violent wind, rain-flooding, thunderstorms, floods, snow-ice, heatwave, extreme cold, avalanches, coastal flooding), with the department name and the full official bulletin.
- **Vigilance map** for today and tomorrow (requires the API key).

## Scenes triggered by vigilance alerts

You can create a scene that runs when a vigilance alert is issued — for example, to receive an SMS on an orange-level alert.

In the scene editor, add a **"Weather alert raised"** or **"Weather alert ended"** trigger, then pick the house and, optionally, the phenomenon type and the minimum severity.

Gladys checks for alerts every 30 minutes. This integration additionally watches the vigilance every 15 minutes and notifies Gladys as soon as it changes, so your scene runs within seconds instead of waiting for the next scheduled check.

## Vigilance map (optional)

Displaying the national vigilance map requires a personal API key, free of charge:

1. Create an account on the [Météo France API portal](https://portail-api.meteofrance.fr/).
2. Subscribe to the **"Données Publiques de Vigilance"** API (free).
3. Copy the generated API key.
4. In Gladys, open the Météo France integration's **Configuration** screen, paste the key and save.

Without this key, everything else keeps working normally — only the map is unavailable.

## Coverage

Météo France covers **mainland France and its overseas departments**. For a house outside that area, the integration returns no data and Gladys automatically falls back to another weather service if you have one configured.

## Precedence over OpenWeather

If you already had OpenWeather configured, installing Météo France automatically takes over with no setting to change. If you stop or uninstall the integration, Gladys falls back to OpenWeather just as automatically.
