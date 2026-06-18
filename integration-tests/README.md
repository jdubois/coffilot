# Coffilot integration-test projects

Six **independent** projects used to exercise Coffilot against every capability
tier it supports. Five are Maven and one is Gradle, so both build tools get real
coverage. Each folder is a self-contained project with its own wrapper (`./mvnw`
or `./gradlew`) — none of them depend on each other or on this repo's Node tooling.

Coffilot degrades gracefully by capability, so each project targets a different
rung of that ladder:

| Project | What it is | Coffilot tier exercised |
| ------- | ---------- | ----------------------- |
| [`hello-world`](hello-world) | Plain Maven project (no Spring), one JUnit 5 test | **Plain Java** — Build / Test / Package only |
| [`gradle-hello-world`](gradle-hello-world) | Plain Gradle project (no Spring), one JUnit 5 test | **Plain Java (Gradle)** — Build / Test / Package via `./gradlew` |
| [`spring-mvc`](spring-mvc) | Spring Boot MVC app (`web`), from start.spring.io | **Spring Boot** — Run lane + process-level JVM metrics |
| [`spring-mvc-actuator-devtools`](spring-mvc-actuator-devtools) | Same app + Actuator + DevTools | **Actuator** — richer live metrics via `/actuator` |
| [`spring-mvc-bootui`](spring-mvc-bootui) | Same app with BootUI in a `dev` Maven profile | **BootUI** — richest metrics + advisor scan |
| [`quarkus-rest`](quarkus-rest) | Quarkus REST app with SmallRye Health + Micrometer/Prometheus | **Quarkus** — Run via `quarkus:dev` + live metrics from `/q/metrics` & `/q/health` |

The three Spring projects were generated with
[start.spring.io](https://start.spring.io) (Maven, Java 17, Spring Boot 4.1) and
each expose a trivial `GET /` endpoint plus two tests (`contextLoads` and a
`@WebMvcTest` on the controller), so the graphical test view and Run lane have
something real to show.

`quarkus-rest` is the Quarkus counterpart, generated with
[code.quarkus.io](https://code.quarkus.io) (Maven, Java 17, Quarkus 3.36) and likewise
exposing a trivial `GET /` plus two tests (a `@QuarkusTest` that boots the app and a
plain unit test). It adds SmallRye Health and the Micrometer/Prometheus registry so its
`/q/health` and `/q/metrics` endpoints feed Coffilot's Quarkus metrics tier.

## Running them by hand

Each project builds, tests, packages and runs on its own:

```bash
cd spring-mvc
./mvnw test          # run the tests
./mvnw package       # build the jar
./mvnw spring-boot:run   # start it on http://localhost:8080/
```

`hello-world` has no web server, so use `package` then run the jar:

```bash
cd hello-world
./mvnw package
java -jar target/hello-world.jar   # prints "Hello, World!"
```

`gradle-hello-world` is the Gradle equivalent — same sources, driven by the Gradle
wrapper instead of Maven:

```bash
cd gradle-hello-world
./gradlew test                      # run the tests
./gradlew build -x test             # build the jar (skipping tests)
java -jar build/libs/gradle-hello-world.jar   # prints "Hello, World!"
```

`quarkus-rest` runs in Quarkus dev mode (live reload), the path Coffilot's Run lane
uses for Quarkus modules:

```bash
cd quarkus-rest
./mvnw test          # run the tests (boots the app under @QuarkusTest)
./mvnw package       # build the runner jar
./mvnw quarkus:dev   # start it on http://localhost:8080/ (try /q/health, /q/metrics)
```

### BootUI tier

`spring-mvc-bootui` keeps the BootUI starter out of the default build. Activate the
`dev` Maven profile to add the starter **and** switch on the `dev` Spring profile,
which is what wakes BootUI up:

```bash
cd spring-mvc-bootui
./mvnw spring-boot:run -Pdev   # BootUI console at http://localhost:8080/bootui
```

## Using them with Coffilot

Coffilot drives a Maven or Gradle project from that project's own folder,
discovering the extension under `.github/extensions/` and walking up to the
directory that owns the build wrapper (`mvnw` or `gradlew`). When a project has
both, Maven wins. To point Coffilot at one of these projects, symlink this
extension into it and open the canvas:

```bash
# from one of the project folders, e.g. spring-mvc-actuator-devtools/
mkdir -p .github/extensions
ln -s /path/to/coffilot .github/extensions/coffilot
```

Then open a Copilot session on that project, reload extensions, and open the
**Coffilot** canvas. Pick the project that matches the tier you want to test:

- `hello-world` to confirm Build / Test / Package work with no Spring at all.
- `gradle-hello-world` to confirm the same lanes drive a Gradle project.
- `spring-mvc` for the Run lane and process-level metrics. Also the easiest **Debug**
  check: switch to the Debug tab, add a breakpoint at
  `com.example.springmvc.HelloController:11`, click **Debug**, then hit `GET /` — the
  session pauses in `hello()` with the call stack and frame variables shown.
- `spring-mvc-actuator-devtools` for the Actuator metrics tier.
- `spring-mvc-bootui` (run with `-Pdev`) for the full BootUI metrics + advisor scan.
- `quarkus-rest` for the Quarkus Run lane (`quarkus:dev`) and the Quarkus metrics tier.

## Automated tests against these projects

Coffilot's own test suite drives these projects on two levels (see `test/`):

- **Detection tests** (`test/integration-projects.test.mjs`) run as part of
  `npm test`. They point Coffilot's real build-tool detection, capability/tier
  classification, run-mode inference and project-root resolution at each project's
  actual build files and assert the tier each scenario in the table above is meant
  to exercise. They are deterministic and need no JDK or network.

- **End-to-end tests** (`test/e2e-projects.test.mjs`) actually build and test each
  project with its own wrapper, then feed the JUnit reports the build produced
  through Coffilot's own report discovery + parser and assert the parsed results.
  They need a JDK 17 and network access, so they are **skipped unless
  `COFFILOT_E2E=1`** is set:

  ```bash
  COFFILOT_E2E=1 node --test test/e2e-projects.test.mjs
  ```

  CI runs them per project in the `E2E (<project>)` matrix job.

