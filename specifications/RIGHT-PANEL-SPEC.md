# Right‑panel (aside rail) specification

The **right panel** is the aside rail of the Coffilot canvas: a vertical list of tabs
(`.atab`, each with a `data-atab` key) and their panes (`.apane`). This document
specifies which tabs exist, how they are ordered, when each is active vs. inactive, and
exactly what each pane shows in either state.

This is implemented in the code: `public/index.html` (markup), `public/app.js` (behaviour),
`public/styles.css` (styling), with capability/metrics data coming from
`extension.mjs`.

This implementation MUST follow this specification.

---

## 1. Tab inventory

Internal `data-atab` keys vs. the labels users see:

| Order | `data-atab` | User‑facing label | Pane purpose                                                     |
| ----: | ----------- | ----------------- | ---------------------------------------------------------------- |
|     1 | `settings`  | **Settings**      | Project/run settings                                             |
|     2 | `jvm`       | **Live JVM**      | Live heap / threads / uptime                                     |
|     3 | `loggers`   | **Logs**          | Live log‑level control                                           |
|     4 | `spring`    | **Spring**        | Spring Boot version advisor + Actuator / BootUI / DevTools setup |
|     5 | `quarkus`   | **Quarkus**       | Quarkus MCP register + metrics/logging setup                     |
|     6 | `bootui`    | **BootUI**        | BootUI advisor scans                                             |
|     7 | `deps`      | **Dependencies**  | Outdated libraries upgrades                                      |

Canonical order is `ASIDE_ORDER = ["settings", "jvm", "loggers", "spring",
"quarkus", "bootui", "deps"]` (`public/app.js`).

---

## 2. First opening and persistence

On first opening of the canvas, the Settings tab is opened.

Then, persist:

- Which tab is opened, or if they are all closed
- The status of each toggle

When opening the canvas, if any of this data is already persisted -> use this to restore the panel in the way
it was persisted.

---

## 3. Ordering & active/inactive grouping

**Rule:** the canonical order above is _always_ preserved **within** each group, but the
rail is split into two groups:

1. **Active (available) tabs** float to the top, in canonical order.
2. A separator (`.atab-sep`) divides the groups, it is at the bottom of the Active (available) tabs.
3. **Inactive (unavailable) tabs** float at the bottom, in canonical order.

Implementation: `computeAsideOrder(name, ok) = (ok ? 0 : 100) + rank`, where `rank` is
the canonical index. Available → `0 + rank`; unavailable → `100 + rank`.

**Animation:** when a tab crosses the active/inactive boundary it animates with a FLIP
transition (≈200 ms) via `flipAsideTabs`. The animation is skipped on the very first
layout and when the user has `prefers-reduced-motion`.

**Always‑available tabs:** `ASIDE_ALWAYS = { settings, deps }`. These never go inactive.

---

## 4. Availability (active vs. inactive) per tab

Two independent gates drive availability, merged per‑key in `updateAsideAvailability`:

- **Project capabilities** (static, from `pomCaps` / `gradleCaps`): does the project use
  Spring Boot? Quarkus? etc. Drives `spring` and `quarkus`.
- **Runtime metrics tier** (dynamic, from the running app — see §5): drives `jvm`,
  `loggers`, `bootui`.

| Tab        | Active when                                                    | Gate source    |
| ---------- | -------------------------------------------------------------- | -------------- |
| `settings` | Always                                                         | `ASIDE_ALWAYS` |
| `jvm`      | App running **and** metrics tier ∈ {bootui, actuator, quarkus} | runtime        |
| `loggers`  | App running **and** metrics tier ∈ {bootui, actuator, quarkus} | runtime        |
| `spring`   | `caps.springBoot` is true                                      | project caps   |
| `quarkus`  | `caps.quarkus` is true                                         | project caps   |
| `bootui`   | App running **and** metrics tier = `bootui`                    | runtime        |
| `deps`     | Always                                                         | `ASIDE_ALWAYS` |

Each inactive tab also has a greyed‑tab tooltip from `ASIDE_REASON`.

---

## 5. Metrics tiers (runtime detection)

`refreshMetrics` (`extension.mjs`) probes the running app in precedence order and sets
`metricsTier`:

1. **`bootui`** — `/bootui/api/overview` answers. Richest tier (console, richer metrics
   and advisor scans). _Implies Actuator._
2. **`actuator`** — Spring Boot Actuator reachable at `/actuator` or `/management`.
3. **`quarkus`** — Quarkus `/q/health` (+ optional `/q/metrics`) answers.
4. **`process`** — nothing answered (or app down). Live JVM/Logs/BootUI all inactive.

When the app is down: `appUp = false`, `metricsTier = process`.

---

## 6. Governing principle — **BootUI ⟹ Actuator**

BootUI bundles Spring Boot Actuator. Therefore, **everywhere**, when BootUI is
configured:

- Do **not** show an “Add Actuator” CTA.
- Do **not** show an Actuator “is set up” confirmation (BootUI’s confirmation stands in
  for it).
- The BootUI tier covers all the metrics/loggers needs Actuator would.

---

## 7. Per‑tab content rules

### 7.1 Settings (`settings`) — always active

Project + run configuration. No active/inactive story.

### 7.2 Live JVM (`jvm`)

**Active:** live heap / non‑heap / threads / uptime from the current tier.

**Inactive** (`renderMetricsInactive` → `diagnosticInactiveBody("metrics", appDown)`):

- **Lead line:** app down → “The app isn’t running.” Otherwise → “The running app
  exposes no metrics endpoint.”
- **Body** depends on the selected run module:

| Module state                           | Message                                                                                                                      | Fix CTAs                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Spring Boot + **BootUI**               | ✓ BootUI is set up — _{run the app / expose its endpoints…}_                                                                 | none                                                       |
| Spring Boot + **Actuator** (no BootUI) | ✓ Spring Boot Actuator is set up — _{next}_ · plus “Add BootUI for its developer console, richer metrics and advisor scans.” | **Add BootUI with Copilot**                                |
| Spring Boot, **neither**               | “This Spring Boot app doesn’t include Spring Boot Actuator, so the Live JVM tab can’t read metrics.”                         | **Add Actuator with Copilot**, **Add BootUI with Copilot** |
| Quarkus + **Micrometer**               | ✓ Quarkus Micrometer is set up — _{next}_                                                                                    | none                                                       |
| Quarkus, no Micrometer                 | “This Quarkus app doesn’t include Micrometer metrics, so the Live JVM tab can’t read metrics.”                               | **Add Quarkus metrics with Copilot**                       |
| Plain Java                             | “Live JVM metrics need a Spring Boot app (Actuator or BootUI) or a Quarkus app (Micrometer).”                                | none                                                       |

_“{next}” = “run the app to use this tab” (app down) or “expose its endpoints and
restart to use this tab” (running but no endpoint)._

Fix buttons use the orange **`fix fix-copilot`** style; once clicked they disable and
read “Asked Copilot ✓” (tracked in `metricsAskedKinds`).

### 7.3 Logs (`loggers`)

**Active:** live logger list + level controls; source badge reads “Actuator” or
“Quarkus”.

**Inactive** (`renderLoggersInactive` → `diagnosticInactiveBody("loggers", appDown)`):
same structure as Live JVM, with logger‑specific wording:

- **Lead line:** app down → “The app isn’t running.” Otherwise → “The running app
  exposes no runtime‑logger endpoint.”
- **Body:** mirrors the Live JVM table, but the “neither” / “no extension” messages talk
  about log levels:
  - Spring Boot, neither → “…doesn’t include Spring Boot Actuator, so log levels can’t be
    changed live.” → **Add Actuator**, **Add BootUI**.
  - Quarkus + **logging‑manager** → ✓ Quarkus logging‑manager is set up — _{next}_.
  - Quarkus, no logging‑manager → “…doesn’t include the logging‑manager extension, so log
    levels can’t be changed live.” → **Add logging‑manager with Copilot**.
  - Plain Java → “Live log‑level control works only for Spring Boot apps (Actuator
    `/loggers`) or Quarkus apps (the `quarkus-logging-manager` extension).”

### 7.4 Spring (`spring`)

Active when the project is Spring Boot (independent of whether the app is running).
Inactive → `renderSpringAdvisor` shows the “not a Spring Boot project” reason. When
active, four stacked sections (`updateDevSetup`):

1. **Version advisor** — detected Spring Boot version + support status (`current` /
   `supported` / `eol` / `unknown` / `unreadable`) and an **Upgrade with Copilot** button
   (`#btn-upgrade-spring`, styled `fix-copilot` to match the other Copilot buttons).

2. **Actuator section** (`#spring-actuator-section`) — _hidden when BootUI is
   configured_ (BootUI ⟹ Actuator). Otherwise:
   - Actuator present → “Actuator is set up” confirmation.
   - Actuator absent → **Add Actuator with Copilot**.

3. **BootUI section** (`#spring-bootui-section`) — shown for every Spring Boot project:
   - BootUI configured → “BootUI is configured — it includes Spring Boot Actuator.”
   - BootUI absent → pitch + **Add BootUI with Copilot**.

4. **DevTools section** — live‑reload toggle + manual reload (unchanged by the BootUI
   work).

Section visibility summary:

| Project state     | Actuator section     | BootUI section                   |
| ----------------- | -------------------- | -------------------------------- |
| BootUI configured | hidden               | “BootUI configured” confirmation |
| Actuator only     | “Actuator is set up” | pitch + **Add BootUI**           |
| Neither           | **Add Actuator**     | pitch + **Add BootUI**           |

### 7.5 Quarkus (`quarkus`)

Active when `caps.quarkus`. Inactive → `#quarkus-empty` shows the “not a Quarkus app”
reason. When active: Quarkus MCP register panel + (in the Live JVM/Logs inactive bodies)
the Micrometer / logging‑manager CTAs described above.

### 7.6 BootUI / advisor scans (`bootui`)

Active only at metrics tier `bootui` (app running). Pane shows scan controls
(`Scan all` + per‑panel scans).

- Title is followed by `#bootui-configured` (“BootUI is configured”, shown when BootUI is
  on the classpath) or `#bootui-desc` (the “add the starter” description, shown
  otherwise).
- **Inactive** (`scansInactiveHtml(appDown)`), consistent with Live JVM/Logs:
  - Lead: app down → “The app isn’t running.” Otherwise → “The running app has no BootUI
    endpoint.”
  - Spring Boot + BootUI → ✓ BootUI is set up — _{next}_.
  - Spring Boot, no BootUI → “Advisor scans need BootUI — add it above, then run the app.”
  - Not Spring Boot → “Advisor scans need a BootUI‑enabled Spring Boot app.”
  - Greyed placeholder scan buttons render so the pane isn’t empty.

### 7.7 Dependencies (`deps`) — always active

Outdated library list with “Direct dependencies only” filter and per‑finding
**Fix with Copilot**. (Specified in `PLAN.md`; behaviour rules to be folded in here as it
lands.). This needs to work both with Maven and Gradle.

---

## 8. Runtime profile activation (BootUI dev profile)

For Maven Spring Boot projects, BootUI is often only on the classpath under a `dev`
profile. `pomCaps` reports `bootuiProfiles`; the Maven Spring runner merges them into the
`-P` list (`withBootuiProfile`) so the BootUI tier actually comes up at runtime and Live
JVM / Logs / BootUI go active.

For Gradle Spring Boot projects, there is a similar mechanism.

---

## 9. Shared button conventions

- Every Copilot fix/CTA button reads **“… with Copilot”** and uses the orange
  **`fix fix-copilot`** style (Add Actuator, Add BootUI, Add logging‑manager, Add Quarkus
  metrics, Upgrade Spring Boot, etc.).
- After a fix is requested, the button disables and reads “Asked Copilot ✓”.

---

## 10. Open questions / desired changes
