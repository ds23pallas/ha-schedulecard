/**
 * schedule-card — a Home Assistant Lovelace card that draws weekly on/off
 * schedules (e.g. boiler heating / hot water) as bars in one lane per day.
 *
 * Each day's state is a string of on/off time pairs, e.g.
 *   "06:00 08:30 16:30 22:00"   -> on 06:00–08:30 and 16:30–22:00
 * Anything that isn't HH:MM (such as "--:--" for unused slots) is ignored.
 *
 * No build step, no dependencies: drop this file in /config/www and add it as
 * a dashboard resource (type: JavaScript module).
 */

const CARD_VERSION = "0.2.0";
const CARD_TAG = "schedule-card";

const DAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
// amber, lagoon, sage, plum: similar lightness so no series shouts over another,
// all readable on light and dark themes and distinct from the red "now" line.
const DEFAULT_COLORS = ["#f28a2e", "#1f9fd4", "#4dae7f", "#9a6fd6"];
const MINUTES_PER_DAY = 1440;
const REFRESH_MS = 30_000;

/** "06:00 08:30 17:00 22:00" -> [{start: 360, end: 510}, {start: 1020, end: 1320}] */
function parseSchedule(str) {
  const mins = (String(str ?? "").match(/\b\d{1,2}:\d{2}\b/g) || []).map((t) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  });
  const slots = [];
  for (let i = 0; i + 1 < mins.length; i += 2) {
    const start = mins[i];
    const end = Math.min(mins[i + 1], MINUTES_PER_DAY);
    if (end > start && start < MINUTES_PER_DAY) slots.push({ start, end });
  }
  return slots;
}

const pad = (n) => String(n).padStart(2, "0");
const fmtTime = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const fmtDuration = (m) =>
  [m >= 60 ? `${Math.floor(m / 60)}h` : "", m % 60 ? `${m % 60}m` : ""].filter(Boolean).join(" ");
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Current {day: 0..6 (Mon=0), minute: 0..1439} in the given IANA time zone (undefined = browser). */
function nowInZone(timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
  } catch {
    return nowInZone(undefined); // unknown zone name: fall back to browser time
  }
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** Localised weekday names, Monday first. 2024-01-01 was a Monday. */
function weekdayNames(language, style) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat(language, { weekday: style, timeZone: "UTC" });
  } catch {
    fmt = new Intl.DateTimeFormat("en", { weekday: style, timeZone: "UTC" });
  }
  return DAY_KEYS.map((_, d) => fmt.format(new Date(Date.UTC(2024, 0, 1 + d))));
}

const STYLES = `
  :host {
    --sc-track: var(--schedule-card-track-color, rgba(127, 127, 127, 0.12));
    --sc-grid: var(--schedule-card-grid-color, rgba(127, 127, 127, 0.22));
    --sc-grid-minor: var(--schedule-card-grid-minor-color, rgba(127, 127, 127, 0.1));
    --sc-now: var(--schedule-card-now-color, var(--error-color, #d63a3a));
    --sc-label-w: 3.2rem;
  }
  ha-card {
    position: relative;
    padding: 16px 16px 12px;
  }
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px 12px;
    margin-bottom: 12px;
  }
  .title {
    margin: 0;
    font-size: var(--ha-card-header-font-size, 1.15rem);
    font-weight: 500;
    color: var(--primary-text-color);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 0.8rem;
    color: var(--secondary-text-color);
  }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    display: inline-block;
    background: linear-gradient(to bottom, color-mix(in srgb, var(--c) 78%, #fff), var(--c));
  }

  .status {
    font-size: 0.85rem;
    color: var(--secondary-text-color);
    margin: -4px 0 12px;
  }
  .status b { color: var(--primary-text-color); font-weight: 500; }

  .grid {
    position: relative;
    display: grid;
    grid-template-columns: var(--sc-label-w) 1fr;
    grid-template-rows: repeat(8, auto); /* axis + 7 days; explicit so 1 / -1 spans all */
    row-gap: 8px;
    column-gap: 10px;
    align-items: center;
  }

  .axis {
    position: relative;
    height: 22px;
    margin-bottom: -4px;
    font-size: 0.7rem;
    color: var(--secondary-text-color);
    font-variant-numeric: tabular-nums;
  }
  .axis .label { position: absolute; top: 0; transform: translateX(-50%); }
  .axis .label.first { transform: none; }
  .axis .label.last { transform: translateX(-100%); }
  .axis .label.skip { display: none; }
  .axis .label.covered { visibility: hidden; }
  .axis .tick {
    position: absolute;
    bottom: 0;
    width: 1px;
    height: 3px;
    background: var(--secondary-text-color);
    opacity: 0.5;
  }
  .axis .tick.major { height: 6px; opacity: 0.8; }
  .axis .tick.half { height: 2px; opacity: 0.35; display: none; }
  .axis.dense .tick.half { display: block; }
  .axis .now-label {
    position: absolute;
    top: -1px;
    transform: translateX(-50%);
    padding: 0 5px;
    border-radius: 8px;
    background: var(--sc-now);
    color: #fff;
    font-weight: 600;
    line-height: 16px;
    box-shadow: 0 0 0 3px var(--ha-card-background, var(--card-background-color, #fff));
    z-index: 2;
  }

  .day { font-size: 0.875rem; color: var(--secondary-text-color); }
  .day.today { color: var(--primary-text-color); font-weight: 600; }

  .lane {
    position: relative;
    display: grid;
    grid-auto-rows: 12px;
    row-gap: 3px;
    padding: 4px 0;
    border-radius: 6px;
    background: var(--sc-gridlines), var(--sc-track);
  }
  .lane.today { outline: 1px solid var(--divider-color, rgba(127, 127, 127, 0.25)); }

  .row { position: relative; }
  .row.unavailable {
    margin: 0 4px;
    border-radius: 3px;
    background: repeating-linear-gradient(-45deg,
      transparent 0 4px, rgba(127, 127, 127, 0.18) 4px 8px);
  }
  .bar {
    position: absolute;
    top: 0;
    bottom: 0;
    min-width: 6px; /* keep 10-minute slots visible and tappable */
    border-radius: 4px;
    /* soft top highlight + hairline edge so bars read well on light and dark */
    background: linear-gradient(to bottom, color-mix(in srgb, var(--c) 78%, #fff), var(--c));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 88%, #000 12%);
    transition: filter 0.15s;
  }
  .bar:hover { filter: brightness(1.12); }
  .bar.past { opacity: 0.45; }

  /* Absolutely positioned grid child: covers the track column from the axis
     to the last lane without taking part in auto-placement. */
  .now-overlay {
    position: absolute;
    grid-column: 2;
    grid-row: 1 / -1;
    inset: 0;
    pointer-events: none;
    z-index: 1;
  }
  .now {
    position: absolute;
    top: 15px;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--sc-now);
    border-radius: 1px;
  }

  .tooltip {
    position: absolute;
    pointer-events: none;
    padding: 6px 8px;
    border-radius: 6px;
    background: #222;
    color: #fff;
    font-size: 0.75rem;
    line-height: 1.3;
    white-space: nowrap;
    transform: translate(-50%, calc(-100% - 8px));
    opacity: 0;
    transition: opacity 0.1s;
    z-index: 10;
  }
  .tooltip.show { opacity: 1; }
  .tooltip small { opacity: 0.75; }

  .warning { color: var(--error-color, #d63a3a); font-size: 0.85rem; }
`;

/** Hard-stop gradient with a 1px line at each hour 01–23 (darker every 3h). */
function gridlines() {
  const stops = [];
  for (let h = 1; h < 24; h++) {
    const p = (h / 24) * 100;
    const c = h % 3 === 0 ? "var(--sc-grid)" : "var(--sc-grid-minor)";
    stops.push(`transparent calc(${p}% - 1px)`, `${c} calc(${p}% - 1px) ${p}%`, `transparent ${p}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

class ScheduleCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._signature = "";
    this._timer = null;
  }

  // ---------- Lovelace API ----------

  static getStubConfig() {
    return {
      title: "Boiler schedule",
      series: [
        { name: "Heating", entity_prefix: "sensor.boiler_heating_schedule_" },
        { name: "Hot water", entity_prefix: "sensor.boiler_hot_water_schedule_" },
      ],
    };
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.series) || config.series.length === 0) {
      throw new Error("schedule-card: 'series' must be a non-empty list");
    }
    const series = config.series.map((s, i) => {
      if (!s || (!s.entity_prefix && !s.entities)) {
        throw new Error(`schedule-card: series ${i + 1} needs 'entity_prefix' or 'entities'`);
      }
      return {
        name: s.name ?? `Series ${i + 1}`,
        color: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        entities: ScheduleCard._resolveEntities(s, i),
      };
    });
    this._config = {
      title: config.title ?? "Schedule",
      show_status: config.show_status !== false,
      show_now: config.show_now !== false,
      series,
    };
    // Title/legend come from config, so rebuild the skeleton on every config change.
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    this.shadowRoot.innerHTML = "";
    this._signature = "";
    this._render();
  }

  /** -> 7 entity ids, Monday first. */
  static _resolveEntities(s, i) {
    if (Array.isArray(s.entities)) {
      if (s.entities.length !== 7) {
        throw new Error(`schedule-card: series ${i + 1} 'entities' list needs 7 items (Monday first)`);
      }
      return s.entities.slice();
    }
    if (s.entities && typeof s.entities === "object") {
      return DAY_KEYS.map((d) => {
        if (!s.entities[d]) throw new Error(`schedule-card: series ${i + 1} 'entities' is missing '${d}'`);
        return s.entities[d];
      });
    }
    return DAY_KEYS.map((d) => `${s.entity_prefix}${d}`);
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 2 + Math.ceil((7 * (8 + this._laneHeight())) / 50);
  }

  getGridOptions() {
    return { columns: 12, min_columns: 6, rows: "auto" };
  }

  connectedCallback() {
    this._timer = setInterval(() => this._render(), REFRESH_MS);
    this._observeResize(); // re-attach after HA moves the card between views
    this._render();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._timer = null;
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  // ---------- rendering ----------

  _laneHeight() {
    const n = this._config?.series.length ?? 2;
    return 8 + n * 12 + (n - 1) * 3;
  }

  /** Respect the user's HA profile setting (local vs server time zone). */
  _timeZone() {
    const hass = this._hass;
    if (!hass || hass.locale?.time_zone === "local") return undefined;
    return hass.config?.time_zone;
  }

  _render() {
    if (!this._config || !this._hass) return;

    const now = nowInZone(this._timeZone());
    const states = this._config.series.map((s) => s.entities.map((id) => this._hass.states[id]?.state));
    const language = this._hass.locale?.language ?? this._hass.language ?? "en";

    // Only touch the DOM when something visible changed.
    const signature = JSON.stringify([states, now, language]);
    if (signature === this._signature) return;
    this._signature = signature;

    if (!this.shadowRoot.querySelector("ha-card")) this._buildSkeleton();
    this._renderBody(states, now, language);
  }

  _buildSkeleton() {
    const { title, series } = this._config;
    this.shadowRoot.innerHTML = `
      <style>${STYLES}</style>
      <ha-card>
        <div class="header">
          ${title ? `<h2 class="title">${esc(title)}</h2>` : "<span></span>"}
          <div class="legend">
            ${series.map((s) => `<span><i style="--c:${esc(s.color)}"></i>${esc(s.name)}</span>`).join("")}
          </div>
        </div>
        <div class="status"></div>
        <div class="grid"></div>
        <div class="tooltip"></div>
      </ha-card>`;

    const card = this.shadowRoot.querySelector("ha-card");
    const grid = this.shadowRoot.querySelector(".grid");
    const tooltip = this.shadowRoot.querySelector(".tooltip");
    grid.style.setProperty("--sc-gridlines", gridlines());

    // pointermove: mouse hover; pointerdown: taps on tablets / phones
    const showTip = (e) => {
      const bar = e.target.closest?.(".bar");
      if (!bar) {
        tooltip.classList.remove("show");
        return;
      }
      tooltip.innerHTML = bar.dataset.tip;
      const c = card.getBoundingClientRect();
      const b = bar.getBoundingClientRect();
      tooltip.style.left = `${e.clientX - c.left}px`;
      tooltip.style.top = `${b.top - c.top}px`;
      tooltip.classList.add("show");
    };
    grid.addEventListener("pointermove", showTip);
    grid.addEventListener("pointerdown", showTip);
    grid.addEventListener("pointerleave", () => tooltip.classList.remove("show"));

    this._observeResize();
  }

  /** Card width changes (resize, sidebar toggle) move the pill relative to the labels. */
  _observeResize() {
    const grid = this.shadowRoot.querySelector(".grid");
    if (!grid || this._resizeObserver) return;
    this._resizeObserver = new ResizeObserver(() => this._layoutAxis());
    this._resizeObserver.observe(grid);
  }

  /**
   * Fit the axis to the available width (needs layout, so measured):
   * label every 1/2/3/6 hours depending on space, half-hour ticks when roomy,
   * and hide any label the current-time pill overlaps.
   */
  _layoutAxis() {
    const axis = this.shadowRoot.querySelector(".axis");
    if (!axis) return;
    const width = axis.getBoundingClientRect().width;
    if (width === 0) return;

    const MIN_LABEL_SPACING = 34; // px between label centres
    const pxPerHour = width / 24;
    const step = [1, 2, 3, 6].find((s) => s * pxPerHour >= MIN_LABEL_SPACING) ?? 12;
    axis.classList.toggle("dense", step === 1 && pxPerHour >= 50);

    const labels = [...axis.querySelectorAll(".label")];
    labels.forEach((l) => {
      l.classList.toggle("skip", Number(l.dataset.h) % step !== 0);
      l.classList.remove("covered");
    });
    axis.querySelectorAll(".tick:not(.half)").forEach((t) => {
      const h = Number(t.dataset.h);
      t.classList.toggle("major", h % step === 0 && (step > 1 || h % 3 === 0));
    });

    const pill = axis.querySelector(".now-label")?.getBoundingClientRect();
    if (!pill || pill.width === 0) return;
    const GAP = 3; // px of breathing room either side of the pill
    labels.forEach((l) => {
      if (l.classList.contains("skip")) return;
      const r = l.getBoundingClientRect();
      if (r.right > pill.left - GAP && r.left < pill.right + GAP) l.classList.add("covered");
    });
  }

  _renderBody(states, now, language) {
    const { series, show_status, show_now } = this._config;
    const grid = this.shadowRoot.querySelector(".grid");
    const shortDays = weekdayNames(language, "short");
    const longDays = weekdayNames(language, "long");
    const slots = states.map((days) => days.map(parseSchedule));
    const unavailable = states.map((days) => days.map((st) => st == null || st === "unavailable" || st === "unknown"));

    let html = "<div></div>" + this._axisHtml(now.minute, show_now);

    for (let d = 0; d < 7; d++) {
      const isToday = d === now.day;
      html += `<div class="day${isToday ? " today" : ""}" title="${esc(longDays[d])}">${esc(shortDays[d])}</div>`;
      html += `<div class="lane${isToday ? " today" : ""}">`;
      series.forEach((s, i) => {
        if (unavailable[i][d]) {
          html += `<div class="row unavailable" title="${esc(`${s.name}: ${s.entities[d]} unavailable`)}"></div>`;
          return;
        }
        html += `<div class="row">`;
        for (const slot of slots[i][d]) {
          const past = isToday && slot.end <= now.minute;
          const tip =
            `<b>${esc(s.name)}</b> · ${esc(longDays[d])}<br>` +
            `${fmtTime(slot.start)}–${fmtTime(slot.end)} <small>(${fmtDuration(slot.end - slot.start)})</small>`;
          html +=
            `<div class="bar${past ? " past" : ""}" data-tip="${esc(tip)}" style="` +
            `left:${(slot.start / MINUTES_PER_DAY) * 100}%;` +
            `width:${((slot.end - slot.start) / MINUTES_PER_DAY) * 100}%;` +
            `--c:${esc(s.color)}"></div>`;
        }
        html += `</div>`;
      });
      html += `</div>`;
    }

    if (show_now) {
      html += `<div class="now-overlay"><div class="now" style="left:${(now.minute / MINUTES_PER_DAY) * 100}%"></div></div>`;
    }
    grid.innerHTML = html;
    this._layoutAxis();

    const status = this.shadowRoot.querySelector(".status");
    status.hidden = !show_status;
    if (show_status) {
      status.innerHTML = series
        .map((s, i) => this._describe(s.name, slots[i][now.day], unavailable[i][now.day], now.minute))
        .join(" &nbsp;·&nbsp; ");
    }
  }

  _axisHtml(minute, showNow) {
    let html = `<div class="axis">`;
    // Every hour gets a label and tick; _layoutAxis() thins them to fit the width.
    for (let h = 0; h <= 24; h++) {
      const left = `left:${(h / 24) * 100}%`;
      if (h > 0 && h < 24) html += `<i class="tick" data-h="${h}" style="${left}"></i>`;
      if (h < 24) html += `<i class="tick half" style="left:${((h + 0.5) / 24) * 100}%"></i>`;
      const cls = h === 0 ? " first" : h === 24 ? " last" : "";
      html += `<span class="label${cls}" data-h="${h}" style="${left}">${pad(h)}</span>`;
    }
    if (showNow) {
      // clamp keeps the pill inside the card at the very start/end of the day
      html +=
        `<span class="now-label" style="left:clamp(1.4rem, ${(minute / MINUTES_PER_DAY) * 100}%, calc(100% - 1.4rem))">` +
        `${fmtTime(minute)}</span>`;
    }
    return html + `</div>`;
  }

  /** "Heating <b>on</b> until 22:00" / "Hot water off · next 18:00" */
  _describe(name, slots, unavailable, minute) {
    const n = esc(name);
    if (unavailable) return `${n} unavailable`;
    const active = slots.find((s) => s.start <= minute && minute < s.end);
    if (active) return `${n} <b>on</b> until ${fmtTime(active.end)}`;
    const next = slots.find((s) => s.start > minute);
    return next ? `${n} off · next ${fmtTime(next.start)}` : `${n} off for today`;
  }
}

if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, ScheduleCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: CARD_TAG,
    name: "Schedule Card",
    description: "Weekly on/off schedules (heating, hot water, …) as bars per day.",
    preview: false,
  });
  console.info(`%c SCHEDULE-CARD %c v${CARD_VERSION} `, "color:#fff;background:#ef7d22", "color:#ef7d22;background:#fff");
}
