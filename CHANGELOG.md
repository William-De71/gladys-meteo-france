## [1.4.1](https://github.com/William-De71/gladys-meteo-france/compare/v1.4.0...v1.4.1) (2026-10-05)

### Bug Fixes

* fire the frost and heat triggers once per day, not once per episode ([a8d9a59](https://github.com/William-De71/gladys-meteo-france/commit/a8d9a5913d08a8b7df295eb3da9a215886e61cb5))
* send a 0 gust from get_hour_forecast, and write "vent d'est" ([0252ef4](https://github.com/William-De71/gladys-meteo-france/commit/0252ef4b79003f6bceee0c8f52d692443af9d364))

## [1.4.0](https://github.com/William-De71/gladys-meteo-france/compare/v1.3.0...v1.4.0) (2026-09-26)

### Features

* black ice, snow, storm and UV triggers, ice risk and hourly forecast actions ([8d94a6b](https://github.com/William-De71/gladys-meteo-france/commit/8d94a6b5b0a9d5fd8136998e5c6ca36316465fbe))
* custom threshold for the frost, heat and wind triggers ([750a3fa](https://github.com/William-De71/gladys-meteo-france/commit/750a3fada14f5ae7b90717992b7c820474e0d8ed))
* frost risk scene action ([918eaf4](https://github.com/William-De71/gladys-meteo-france/commit/918eaf4269f8c8bcd9f61688365429843b6d83b2))

### Bug Fixes

* read the Météo France wind in m/s, not km/h ([ef1b3f8](https://github.com/William-De71/gladys-meteo-france/commit/ef1b3f81f97f1e73d4f13c163e0b3762e9f153f3))

## [1.3.0](https://github.com/William-De71/gladys-meteo-france/compare/v1.2.0...v1.3.0) (2026-09-25)

### Features

* scene triggers and actions for Gladys 5.1 ([3549339](https://github.com/William-De71/gladys-meteo-france/commit/3549339985d3232ae360160ebc580ce407dbae6a))

## [1.2.0](https://github.com/William-De71/gladys-meteo-france/compare/v1.1.1...v1.2.0) (2026-08-28)

## [1.1.1](https://github.com/William-De71/gladys-meteo-france/compare/v1.1.0...v1.1.1) (2026-08-22)

### Bug Fixes

* summarise a day's icon from its hours, not from the midday snapshot ([fe8b9c3](https://github.com/William-De71/gladys-meteo-france/commit/fe8b9c3aa0609d65a297dfe7ce81f9e77d8c24d0))

## [1.1.0](https://github.com/William-De71/gladys-meteo-france/compare/v1.0.5...v1.1.0) (2026-08-20)

### Continuous Integration

* generate the changelog automatically on every release ([caa96bb](https://github.com/William-De71/gladys-meteo-france/commit/caa96bb2c0f5bc7f52b685be11dc7a84cfa70bb0))

## [1.0.5](https://github.com/William-De71/gladys-meteo-france/compare/v1.0.4...v1.0.5) (2026-08-19)

### Features

* send the cloud cover the pivot already accepts ([63b6bfb](https://github.com/William-De71/gladys-meteo-france/commit/63b6bfbff3907275d01e677f4e95dc0b6bddf1d0))

### Bug Fixes

* report the mean wind, not the gust, and cloudy skies as covered ([8b6a9c9](https://github.com/William-De71/gladys-meteo-france/commit/8b6a9c91891658ad8db998b2f3e1d7edda8d32cb))

## [1.0.4](https://github.com/William-De71/gladys-meteo-france/compare/v1.0.3...v1.0.4) (2026-08-18)

### Bug Fixes

* read the "Variable" sky and the English labels the API returns ([a2a5521](https://github.com/William-De71/gladys-meteo-france/commit/a2a55210a6d4e5a968372c83e60fd76211f9d5e2))

## [1.0.3](https://github.com/William-De71/gladys-meteo-france/compare/v1.0.2...v1.0.3) (2026-08-16)

### Miscellaneous

* declare the store category, require Gladys 4.86 ([f61b74c](https://github.com/William-De71/gladys-meteo-france/commit/f61b74ccbc1c38e4366118821cd37b41fe4d3046))

## [1.0.2](https://github.com/William-De71/gladys-meteo-france/compare/v1.0.1...v1.0.2) (2026-08-16)

### Bug Fixes

* trust the API description over the icon table, round temperatures ([005e093](https://github.com/William-De71/gladys-meteo-france/commit/005e093776183dac5020ff00425dc22e8b573c64))

## [1.0.1](https://github.com/William-De71/gladys-meteo-france/compare/v1.0.0...v1.0.1) (2026-08-08)

### Bug Fixes

* **ci:** keep the manifest Prettier-clean across releases ([031d979](https://github.com/William-De71/gladys-meteo-france/commit/031d9796b606915785b993755f0c05ddf5e52669))
* fill the daily wind and the precipitation probability of the pivot ([d4f79b9](https://github.com/William-De71/gladys-meteo-france/commit/d4f79b90ed3352754f84448baf99883f996a4af7))

### Documentation

* spell out the API key setup and its validity duration ([2921468](https://github.com/William-De71/gladys-meteo-france/commit/2921468ba6febc13d4adceae4ed4714fe972ae9a))

## [1.0.0](https://github.com/William-De71/gladys-meteo-france/compare/c5921e993cdd45288c76bd629b940862ba847797...v1.0.0) (2026-08-07)

### Features

* align with the published weather SDK, add a forecast cache ([4a2834c](https://github.com/William-De71/gladys-meteo-france/commit/4a2834c27aeb519c1775af22a9206981fd3f1c2d))
* Météo France weather provider as an external integration ([c5921e9](https://github.com/William-De71/gladys-meteo-france/commit/c5921e993cdd45288c76bd629b940862ba847797))
