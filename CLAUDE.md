# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `weather`: it answers the
weather requests of Gladys with the forecasts and the official vigilance of
[Météo France](https://meteofrance.com) (France), watches the radar nowcast and
the forecast of every located house for nine scene triggers, the avalanche
bulletin of its massif for a tenth, and adds eight scene actions. A Node.js
service (Node 22+, ESM, no build step) that runs in its own sandboxed Docker
container and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Forecasts and vigilance go through the public token of the Météo France mobile
app: nothing to configure. The optional personal API key only unlocks the
national vigilance map image.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/scene-actions.test.js    # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
node .github/scripts/release.mjs plan     # the version the next release would get
```

## Architecture

```
index.js                  SDK wiring only: handlers registered before connect()
src/meteo-france-api.js   the Météo France client: forecast, rain, vigilance, map
src/forecast.js           MF forecast -> the pivot weather of Gladys
src/conditions.js         MF icons and descriptions -> pivot conditions
src/vigilance.js          MF vigilance -> pivot alerts, phenomena, departments
src/vigilance-watcher.js  nudges Gladys when a vigilance color changes
src/forecast-cache.js     short cache in front of the slow forecast endpoint
src/houses.js             the located houses of Gladys (name or selector)
src/rain.js               the radar nowcast: rain within the hour
src/frost.js, src/ice.js  frost and black ice risk of the coming morning
src/scene-triggers.js     rain, frost, heat and wind triggers and their data
src/hazard-triggers.js    black ice, snow, storm and UV triggers and their data
src/scene-watcher.js      the 5-minute / hourly watch of every house
src/scene-actions.js      the outputs of the scene actions (avalanche: avalanche.js)
src/avalanche.js          MF avalanche bulletin (BRA XML) -> action outputs, trigger
src/avalanche-watcher.js  the hourly watch of the massif of every house
src/massifs.js            the 36 massifs and the massif of a house (massifs.json,
                          official outlines, simplified: never edit by hand)
src/scene-text.js         the four languages: labels, numbers, dates, compass
src/config.js             configuration
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md     user documentation, re-hosted by the store
.github/scripts/release.mjs         version, changelog, bump (tested in test/)
```

## Rules

- **Keys are forever**: the keys of `config_schema`, scene triggers (fields,
  option values, variables) and scene actions (fields, option values,
  outputs), and the keys of the scene event data and action outputs.
  `test/structure.test.js` compares them to
  `test/fixtures/discovery.baseline.json`: never update the baseline to make a
  test pass without a documented migration. The `house` filter of the
  triggers matches the house **name**: a `source: "houses"` select would store
  a selector instead and needs Gladys 5.2.0.
- **The container rootfs is read-only.** Write only under `/data` (nothing is
  written today).
- **Four languages.** Every user-facing text (manifest, scene sentences and
  labels, `docs/*.md`, README) exists in English, French, German and Spanish.
  `test/i18n.test.js` checks it. The texts of Météo France itself (sky
  descriptions, vigilance bulletins) come in French or English only.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing. Scope `security` lands under "Security", a description
  starting with "remove" / "drop" under "Removed".
- **Manifest.** Texts are objects `{ "en", "fr", "de", "es" }`; the catalog
  `description` holds 10 to 100 characters per language, the whole file stays
  under the 100 KB of the store. A field older cores do not know needs a
  higher `gladys_version` minimum (see `src/constants.js` of the
  integration-store).
- **Météo France.** Its wind is in m/s (the pivot wants m/s in metric too),
  temperatures are rounded (the Gladys widget truncates). Never call the API
  in a test.
- **Scenes.** Never fire a scene trigger as a consequence of a scene action.
  The first check after a start is a baseline (no event). The forecast
  triggers fire once per day and level.
- **Manifest size.** The manifest is formatted by Prettier with a print width of
  400 (`.prettierrc.json` override): one line per four-language text keeps it
  far under the 100 KB of the store.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
