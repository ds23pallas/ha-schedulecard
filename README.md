# Schedule Card

A Home Assistant Lovelace card that shows weekly on/off schedules, such as boiler
heating and hot water, as bars in one lane per day. It has an hourly time axis,
a "now" line across the whole week, and a status line ("Heating **on** until 22:00").

Built for the Viessmann Optolink `DAY_SCHEDULE` text sensors from ESPHome, but it
works with any entity whose state is a list of on/off time pairs:

```
06:00 08:30 16:30 22:00        -> on 06:00–08:30 and 16:30–22:00
05:30 07:00 --:-- --:--        -> placeholders are ignored
```

No build step and no dependencies. It is a single `schedule-card.js` file.

## Install

### Manual

1. Copy `schedule-card.js` to `/config/www/schedule-card.js`.
2. **Settings → Dashboards → ⋮ → Resources → Add resource**
   - URL: `/local/schedule-card.js?v=0.2.0`
   - Type: **JavaScript module**
3. Hard-refresh the browser. When you update the file, bump `?v=`.

### HACS (custom repository)

Push this repo to GitHub. Then go to **HACS → ⋮ → Custom repositories**, add the
repo URL with category **Dashboard**, and install.

## Configuration

```yaml
type: custom:schedule-card
title: Boiler schedule
grid_options:
  columns: full          # sections view: fill the whole section
series:
  - name: Heating
    entity_prefix: sensor.washing_room_boiler_heating_schedule_
  - name: Hot water
    entity_prefix: sensor.washing_room_boiler_hot_water_schedule_
```

`entity_prefix` gets `monday` … `sunday` appended. If your entities aren't named
that way, list them explicitly instead:

```yaml
series:
  - name: Heating
    entities:            # a list, Monday first…
      - sensor.heat_mon
      - sensor.heat_tue
      # … 7 in total
  - name: Hot water
    entities:            # …or a map keyed by day
      monday: sensor.dhw_mon
      tuesday: sensor.dhw_tue
      # … all 7 days
```

| Option        | Default      | Description                                                    |
| ------------- | ------------ | -------------------------------------------------------------- |
| `title`       | `Schedule`   | Card title. Set to `""` to hide it.                            |
| `series`      | **required** | One entry per schedule. Each gets its own bar row in each lane. |
| `show_status` | `true`       | Show the "Heating on until 22:00" line.                        |
| `show_now`    | `true`       | Show the current time pill and red line.                       |

Each `series` entry:

| Option          | Description                                                     |
| --------------- | --------------------------------------------------------------- |
| `name`          | Legend, tooltip and status label.                               |
| `color`         | Bar colour. Defaults in order: amber `#f28a2e`, lagoon `#1f9fd4`, sage `#4dae7f`, plum `#9a6fd6`. |
| `entity_prefix` | Prefix that `monday`…`sunday` is appended to.                   |
| `entities`      | 7 entity ids, either a Monday-first list or a map keyed by day. |

### Theming

The card uses your Home Assistant theme. You can override these variables:

| Variable                           | Default                     |
| ---------------------------------- | --------------------------- |
| `--schedule-card-track-color`      | `rgba(127,127,127,.12)`     |
| `--schedule-card-grid-color`       | `rgba(127,127,127,.22)`     |
| `--schedule-card-grid-minor-color` | `rgba(127,127,127,.10)`     |
| `--schedule-card-now-color`        | `var(--error-color)`        |

### Behaviour notes

- **Time zone:** the "now" line follows your HA profile setting. That is the
  server time zone by default, or the browser's when the profile is set to local.
- **Day names:** these use your HA language setting.
- **Unavailable entities:** these are drawn as a hatched row instead of bars.
- **Tooltips:** hover or tap a bar to see its exact times and duration.

## Development

Open `demo/index.html` in a browser. It loads the card with a fake `hass` object
and sample data, so you don't need Home Assistant to try changes.
