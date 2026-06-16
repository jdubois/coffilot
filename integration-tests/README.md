# Coffilot integration-test projects

Five **independent** projects used to exercise Coffilot against every capability
tier it supports. Four are Maven and one is Gradle, so both build tools get real
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

The three Spring projects were generated with
[start.spring.io](https://start.spring.io) (Maven, Java 17, Spring Boot 4.1) and
each expose a trivial `GET /` endpoint plus two tests (`contextLoads` and a
`@WebMvcTest` on the controller), so the graphical test view and Run lane have
something real to show.

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
- `spring-mvc` for the Run lane and process-level metrics.
- `spring-mvc-actuator-devtools` for the Actuator metrics tier.
- `spring-mvc-bootui` (run with `-Pdev`) for the full BootUI metrics + advisor scan.
