# Gladys Météo France

External [Gladys Assistant](https://gladysassistant.com) integration providing **Météo France** forecasts and the
official **vigilance** alerts.

It is a weather provider (manifest `type: "weather"`, spec B.18): no devices, no discovery screens. Gladys asks
it for the weather of a location, and it feeds the dashboard weather widget, the chat assistant and the
weather-alert scene triggers.

## Features

- **Hourly forecast** (next 24 hours) — temperature, feels-like, humidity, pressure, wind speed/gust/direction,
  precipitation and precipitation probability.
- **Daily forecast** (up to 8 days) — min/max temperatures, condition, precipitation, UV index, sunrise/sunset.
- **Official vigilance alerts** — the nine Météo France phenomena, mapped to the CAP severities Gladys uses
  (yellow → moderate, orange → severe, red → extreme). The alert carries the department name and the full
  official bulletin.
- **Vigilance map** (optional) — the national map for today and tomorrow, rendered in the widget.
- **Fast alert scenes** — the integration polls the vigilance upstream every 15 minutes and nudges Gladys the
  moment it changes, so an alert scene fires in seconds instead of within the 30-minute default.

## Zero configuration

Forecasts and vigilance work **out of the box**: they go through the public token of the Météo France mobile
application. Install the integration and it works.

The only configuration field is an **optional API key**, needed solely to display the national vigilance map:

1. Create a free account on the [Météo France API portal](https://portail-api.meteofrance.fr/).
2. Subscribe to the **Données Publiques de Vigilance** API (also listed as _Bulletin Vigilance_, `DPVigilance`
   in technical URLs).
3. On the API configuration screen, pick the **API Key** token type — **not** OAuth2, whose token expires after
   ~1 hour — then fill the mandatory **Durée** field **in seconds**: `94672800` (~3 years) is the maximum the
   portal accepts.
4. Paste the generated key in the integration's Configuration screen. The client sends it as the `apikey` header.

The map silently stops loading once that duration runs out, so keep the expiry date in mind.

Without the key, everything else keeps working — only the map tile is unavailable.

A second optional field sets the **cache duration**, in seconds, between 0 and 3600 (600 by default, 0 to
disable): every request costs two upstream calls, and the forecast endpoint can take ~20 s on a cold cache, so a
recent answer is reused. Météo France only refreshes a few times an hour, so raising it to 1800 costs almost no
freshness. A change in the vigilance level clears the cache and nudges the core, so alert scenes never wait for
the cache to expire, whatever the value.

## Coverage

Météo France covers **France and its overseas departments**. For a location outside that area, the forecast API
answers with no usable data and Gladys automatically falls back to another configured weather provider.

## Development

```bash
npm install
npm test          # unit tests (node --test)
npm run lint      # eslint
npm run format    # prettier
```

The integration is split so that every piece is testable without a network:

| File                       | Role                                        |
| -------------------------- | ------------------------------------------- |
| `src/meteo-france-api.js`  | HTTP calls only — no Gladys concept         |
| `src/conditions.js`        | MF icon codes → conditions, and how notable |
| `src/forecast.js`          | Raw forecast payload → pivot weather format |
| `src/vigilance.js`         | Raw vigilance payload → pivot CAP alerts    |
| `src/vigilance-watcher.js` | Upstream poll and freshness nudge           |
| `src/forecast-cache.js`    | Short in-memory cache in front of the API   |
| `src/config.js`            | Defaults and normalization of the config    |
| `index.js`                 | The three SDK hooks, wiring it all together |

## Requirements

- Gladys `>= 4.85.0` (weather integrations support, spec B.18)
- Node.js `>= 20`

## License

Apache-2.0
