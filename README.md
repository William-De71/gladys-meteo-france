# Gladys Météo France

External [Gladys Assistant](https://gladysassistant.com) integration providing **Météo France** forecasts, the
official **vigilance** alerts and weather-driven **scenes**, built on `@gladysassistant/integration-sdk` 0.14.

**Zero configuration**: forecasts, vigilance and scenes go through the public service of the Météo France mobile
application. Install the integration and it works; an optional API key only adds the national vigilance map.

User documentation: [English](docs/en.md) · [Français](docs/fr.md).

## Features

### Weather provider

It is a weather provider (manifest `type: "weather"`, spec B.18): no devices, no discovery screens. Gladys asks it
for the weather of a house and it feeds the **dashboard weather widget**, the **chat assistant** and the core's
**weather-alert scene triggers**. When installed, it takes over from OpenWeather automatically.

- **Hourly forecast** (next 24 hours): temperature, feels-like, humidity, pressure, cloud cover, wind
  speed/gust/direction, precipitation and precipitation probability.
- **Daily forecast** (up to 8 days): min/max temperatures, condition, precipitation and probability, wind and
  gusts, UV index, sunrise/sunset. A day's icon summarises its **hours** (a shower beats a sunny spell), not the
  midday snapshot Météo France also publishes.
- **Units**: metric or US, as Gladys asks — Météo France only answers in metric, the integration converts.

### Vigilance

- **Official alerts**: the nine Météo France phenomena, mapped to the CAP severities Gladys uses (yellow →
  moderate, orange → severe, red → extreme), with the department name and the full official bulletin.
- **Fast alert scenes**: the integration polls the vigilance every 15 minutes and nudges Gladys the moment it
  changes, so a "Weather alert raised" scene fires in seconds instead of within the core's 30-minute check.
- **Vigilance map** (optional, API key): the national map for today and tomorrow, rendered in the widget.

### Scene triggers

| Trigger (key)                                     | Fires when                                                                                            | Filters                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------- |
| **Rain expected within the hour** `rain_expected` | the radar nowcast announces rain within the hour, where it announced none                             | house, intensity        |
| **Rain stopped** `rain_stopped`                   | the rain under way stops                                                                              | house                   |
| **Frost forecast** `frost_forecast`               | the next 24 hours reach 0 °C, -5 °C, or a custom threshold (-20 to 5 °C)                              | house, level, threshold |
| **Heat forecast** `heat_forecast`                 | the next 24 hours reach 30 °C, 35 °C, or a custom threshold (20 to 45 °C)                             | house, level, threshold |
| **Strong wind forecast** `wind_forecast`          | the gusts of the next 24 hours reach 60, 80, 100 km/h, or a custom threshold (20 to 150 km/h, step 5) | house, level, threshold |

Every trigger carries a ready-to-send `summary` ("Moderate rain expected in 15 min.", "Frost forecast: -2 °C
expected tomorrow at 06:00.") and its figures as scene variables: `{{triggerEvent.data.minutes_until_rain}}`,
`temperature_min`, `time`, `hours_until`…

A trigger is a **transition**, published once — never a state re-sent on every poll:

- a forecast level fires when it enters the next 24 hours, and re-arms only once the forecast is clear of it by a
  margin (2 °C, 15 km/h), so a forecast hovering around 0 °C does not fire every hour;
- the core matcher only compares equality, so a custom threshold is an event of its own: the forecast triggers watch
  every degree (every 5 km/h for the wind) and publish, per threshold crossed, a `level: "custom"` event carrying
  `threshold` (always °C / km/h), preceded by the fixed-level event when one sits on that threshold;
- a rain trigger never repeats within 30 minutes for a house, the radar flickering at the edge of a shower;
- the first poll after a start is a **baseline** and fires nothing, like the core's own weather-alert check.

### Scene actions

| Action (key)                                             | Main outputs                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Get the forecast of a day** `get_forecast`             | min/max temperatures, sky, rain and probability, wind, gusts, UV, sun times  |
| **Get the rain of the next hours** `get_rain_next_hours` | `dry`, total precipitation, rainy hours, time of the first rain (1-24 h)     |
| **Get the rain within the hour** `get_rain_next_hour`    | `available`, `raining`, `rain_expected`, intensity, minutes until rain / dry |
| **Get the vigilance** `get_vigilance`                    | color and level, phenomena, department, official summary, full bulletin      |

Every action also returns a one-sentence `summary`, e.g. "Tomorrow: rain, 14 to 21 °C, 4.2 mm of rain (80%),
gusts up to 55 km/h." A figure Météo France does not provide is left out, never sent as 0 — a 0 mm would read as
"dry" in the conditions that follow. The actions are read-only and never fire a trigger, so a scene cannot loop
through the integration.

Scene texts follow the language of Gladys (French or English) and the figures its unit system, as the core sent
them in its last weather request.

## Configuration

Nothing is required. The configuration screen offers two optional fields.

**API key** — only needed for the national vigilance map (`public-api.meteofrance.fr` requires it):

1. Create a free account on the [Météo France API portal](https://portail-api.meteofrance.fr/).
2. Subscribe to the **Données Publiques de Vigilance** API (also listed as _Bulletin Vigilance_, `DPVigilance`
   in technical URLs).
3. On the API configuration screen, pick the **API Key** token type — **not** OAuth2, whose token expires after
   ~1 hour — then fill the mandatory **Durée** field **in seconds**: `94672800` (~3 years) is the maximum the
   portal accepts.
4. Paste the generated key in the integration's Configuration screen. The client sends it as the `apikey` header.

The map silently stops loading once that duration runs out, so keep the expiry date in mind. Without the key,
everything else keeps working.

**Cache duration** — in seconds, 0 to 3600, 600 by default. Every weather request costs two upstream calls and
the forecast endpoint can take ~20 s on a cold cache, so a recent answer is reused. Météo France only refreshes a
few times an hour: raising it to 1800 costs almost no freshness. A vigilance change clears the cache and nudges
the core whatever the value; 0 disables the cache (slower dashboard).

## House location

The scene triggers watch the weather on their own, whether or not the core asks for it — the core only pulls the
weather for a widget, the chat or a weather-alert scene. So the manifest declares `location: true` (shown on the
install screen) and the integration reads the houses with `getHouses()` on every connection and forecast poll.

A house without a location is not watched. The scene "House" field takes a house name: left empty, triggers watch
every house and actions use the first located one. The weather path itself still takes the coordinates the core
passes to `onWeatherGet`.

## Calls to Météo France

| What                 | Endpoint                       | When                                                 |
| -------------------- | ------------------------------ | ---------------------------------------------------- |
| Forecast             | `webservice…/forecast`         | on a cache miss, and every 30 min per house (scenes) |
| Vigilance            | `webservice…/v3/warning/full`  | with each forecast, and every 15 min per department  |
| Rain within the hour | `webservice…/rain`             | every 5 min per covered house, and on each action    |
| Vigilance map        | `public-api…/DPVigilance/v1/…` | when the widget shows it (API key only)              |

A house outside the rain nowcast coverage (some mountain areas, overseas) is re-checked only every 6 hours.

## Coverage

Météo France covers **France and its overseas departments**. For a location outside that area, the forecast API
answers with no usable data and Gladys automatically falls back to another configured weather provider. The rain
within the hour covers only part of that territory: the action says so through its `available` output, and the
rain triggers stay silent.

## Development

```bash
npm install
npm test          # unit tests (node --test)
npm run lint      # eslint
npm run format    # prettier
```

Every piece is testable without a network: the HTTP calls live in one module, the rest are pure functions or
factories taking their dependencies as arguments.

| File                       | Role                                                 |
| -------------------------- | ---------------------------------------------------- |
| `index.js`                 | The SDK hooks, wiring it all together                |
| `src/meteo-france-api.js`  | HTTP calls only — no Gladys concept                  |
| `src/config.js`            | Defaults and normalization of the config             |
| `src/forecast-cache.js`    | Short in-memory cache in front of the API            |
| `src/conditions.js`        | MF icon codes → conditions, and how notable they are |
| `src/forecast.js`          | Raw forecast payload → pivot weather format          |
| `src/vigilance.js`         | Raw vigilance payload → pivot CAP alerts             |
| `src/vigilance-watcher.js` | Vigilance poll and freshness nudge                   |
| `src/houses.js`            | Located houses of Gladys, for the scenes             |
| `src/rain.js`              | Raw rain nowcast → rain within the hour              |
| `src/scene-actions.js`     | Outputs of the scene actions                         |
| `src/scene-triggers.js`    | When a scene trigger fires, and with which data      |
| `src/scene-watcher.js`     | Nowcast and forecast polls publishing the triggers   |
| `src/scene-text.js`        | Labels and formats of the scene texts (fr/en)        |

`test/manifest.test.js` keeps the manifest and the code in step: the scene keys, the forecast levels, the rain
intensities and the field bounds. A published scene key is never renamed — every scene using it would break.

## Requirements

- Gladys `>= 5.1.0` (scene triggers and actions declared by an integration)
- Node.js `>= 20`

## License

Apache-2.0
