# The BootUI family

Coffilot is one of three projects by [Julien Dubois](https://www.julien-dubois.com) that share a
single Java workflow — from scaffolding an application, to observing it from the inside, to driving
its build and run lifecycle from Copilot. Each owns one colour in a shared **circle of color**:

| Colour            | Project                                               | Role                                                                                        |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 🟢 **Green**      | [BootUI](https://www.julien-dubois.com/boot-ui/)      | An in-app developer console served by the running Spring Boot app over `/bootui/`.          |
| 🔵 **Blue**       | **Coffilot**                                          | A Copilot canvas extension that builds, tests, runs and debugs the app from the side panel. |
| 🟤 **Terracotta** | [Dr JSkill](https://www.julien-dubois.com/dr-jskill/) | Generates a Spring Boot application to start from.                                          |

## How they work together

1. **Start with [Dr JSkill](https://www.julien-dubois.com/dr-jskill/).** It generates a Spring Boot
   application, giving you a clean, opinionated starting point.
2. **Add the [BootUI](https://www.julien-dubois.com/boot-ui/) starter.** A single Spring Boot
   dependency adds an in-app developer console — health, metrics, memory, threads, advisors and
   more — served by the running application at `/bootui/`, with a REST API under `/bootui/api/**`.
3. **Drive it with Coffilot.** Open the **Coffilot** canvas in the Copilot app and build, test,
   package, run and debug the project without leaving the chat. When the running app exposes BootUI,
   Coffilot lights up its **richest tier**: BootUI-sourced JVM metrics and a REST advisor-scan panel
   that can run BootUI's scans (architecture, Spring, security, Hibernate, …) and hand findings back
   to the agent.

## Where Coffilot fits

Coffilot degrades gracefully by capability — a plain Java module still gets Build / Test / Package,
Spring Boot and Quarkus add a Run lane, and live metrics come from the richest endpoint available:

> **BootUI → Actuator → Quarkus Micrometer/health → process**

So BootUI is not required — but when it is present, the two are designed to complement each other:
BootUI observes the app from the inside, and Coffilot drives its lifecycle from the outside, both
loopback-only.

## Learn more

- [BootUI documentation](https://www.julien-dubois.com/boot-ui/)
- [Dr JSkill](https://www.julien-dubois.com/dr-jskill/)
- [Coffilot features](FEATURES.md) and [getting started](GETTING-STARTED.md)
