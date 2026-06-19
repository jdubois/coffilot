<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import buildImage from "../../images/coffilot-build.webp";
import testImage from "../../images/coffilot-test.webp";
import packageImage from "../../images/coffilot-package.webp";
import runImage from "../../images/coffilot-run.webp";
import debugImage from "../../images/coffilot-debug.webp";

const slides = [
  {
    title: "Build",
    src: buildImage,
    caption: "Run Maven or Gradle builds straight from the side panel, streamed live.",
  },
  {
    title: "Test",
    src: testImage,
    caption: "Read a graphical JUnit report with per-suite grouping and expandable failure stack traces.",
  },
  {
    title: "Package",
    src: packageImage,
    caption: "Package the artifact like Build, with optional clean-first and install toggles.",
  },
  {
    title: "Run",
    src: runImage,
    caption: "Launch Spring Boot, Quarkus dev mode or a plain-Java app and watch live JVM metrics.",
  },
  {
    title: "Debug",
    src: debugImage,
    caption: "Attach a self-contained JDWP debugger for breakpoints, stepping, stacks and variables.",
  },
];

const AUTOPLAY_INTERVAL = 6000;

const current = ref(0);
const paused = ref(false);
let timer = null;

const currentSlide = computed(() => slides[current.value]);

function goTo(index) {
  current.value = (index + slides.length) % slides.length;
}

function next() {
  goTo(current.value + 1);
}

function previous() {
  goTo(current.value - 1);
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function startAutoplay() {
  stopAutoplay();
  if (prefersReducedMotion()) {
    return;
  }
  timer = window.setInterval(() => {
    if (!paused.value) {
      next();
    }
  }, AUTOPLAY_INTERVAL);
}

function stopAutoplay() {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function pause() {
  paused.value = true;
}

function resume() {
  paused.value = false;
}

onMounted(startAutoplay);
onBeforeUnmount(stopAutoplay);
</script>

<template>
  <section
    class="coffilot-home-carousel"
    aria-roledescription="carousel"
    aria-label="Coffilot panel screenshots"
    @mouseenter="pause"
    @mouseleave="resume"
    @focusin="pause"
    @focusout="resume"
  >
    <div class="coffilot-carousel-frame">
      <div class="coffilot-carousel-viewport">
        <div class="coffilot-carousel-track" :style="{ transform: `translateX(-${current * 100}%)` }">
          <div
            v-for="(slide, index) in slides"
            :key="slide.title"
            class="coffilot-carousel-slide"
            role="group"
            aria-roledescription="slide"
            :aria-label="`${index + 1} of ${slides.length}: ${slide.title}`"
            :aria-hidden="index !== current"
          >
            <img
              class="coffilot-carousel-img"
              :src="slide.src"
              :alt="`Coffilot ${slide.title} panel`"
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        class="coffilot-carousel-control coffilot-carousel-control--prev"
        aria-label="Previous panel"
        @click="previous"
      >
        <svg
          class="coffilot-carousel-icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0"
          />
        </svg>
      </button>
      <button
        type="button"
        class="coffilot-carousel-control coffilot-carousel-control--next"
        aria-label="Next panel"
        @click="next"
      >
        <svg
          class="coffilot-carousel-icon"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fill-rule="evenodd"
            d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"
          />
        </svg>
      </button>

      <div class="coffilot-carousel-caption" aria-live="polite">
        <span class="coffilot-carousel-caption-title">{{ currentSlide.title }}</span>
        <span class="coffilot-carousel-caption-text">{{ currentSlide.caption }}</span>
      </div>
    </div>

    <div class="coffilot-carousel-indicators" role="group" aria-label="Choose a panel screenshot">
      <button
        v-for="(slide, index) in slides"
        :key="slide.title"
        type="button"
        class="coffilot-carousel-dot"
        :class="{ 'coffilot-carousel-dot--active': index === current }"
        :aria-current="index === current ? 'true' : undefined"
        :aria-label="`Show ${slide.title}`"
        @click="goTo(index)"
      ></button>
    </div>
  </section>
</template>

<style scoped>
.coffilot-home-carousel {
  width: 100%;
}

.coffilot-carousel-frame {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--coffilot-border);
  border-radius: 1.1rem;
  box-shadow: var(--coffilot-shadow-md);
  background: var(--coffilot-surface);
}

.coffilot-carousel-viewport {
  overflow: hidden;
}

.coffilot-carousel-track {
  display: flex;
  transition: transform 520ms cubic-bezier(0.4, 0, 0.2, 1);
}

.coffilot-carousel-slide {
  flex: 0 0 100%;
  min-width: 100%;
}

.coffilot-carousel-img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1145 / 742;
  object-fit: cover;
  margin: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}

.coffilot-carousel-control {
  position: absolute;
  top: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.75rem;
  height: 2.75rem;
  transform: translateY(-50%);
  border: 1px solid var(--coffilot-border);
  border-radius: 999px;
  background: var(--coffilot-surface);
  color: var(--coffilot-text);
  box-shadow: var(--coffilot-shadow-sm);
  cursor: pointer;
  opacity: 0.92;
  transition:
    background 160ms ease,
    color 160ms ease,
    opacity 160ms ease;
}

.coffilot-carousel-icon {
  width: 1.1rem;
  height: 1.1rem;
}

.coffilot-carousel-control:hover {
  opacity: 1;
  color: #ffffff;
  background: linear-gradient(135deg, var(--coffilot-green), var(--coffilot-blue));
}

.coffilot-carousel-control--prev {
  left: 1rem;
}

.coffilot-carousel-control--next {
  right: 1rem;
}

.coffilot-carousel-caption {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 2.5rem 1.5rem 1.25rem;
  color: #ffffff;
  text-align: left;
  background: linear-gradient(to top, rgba(8, 16, 28, 0.82), rgba(8, 16, 28, 0));
}

.coffilot-carousel-caption-title {
  font-size: 1.15rem;
  font-weight: 800;
}

.coffilot-carousel-caption-text {
  max-width: 48rem;
  font-size: 0.95rem;
  opacity: 0.92;
}

.coffilot-carousel-indicators {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
  justify-content: center;
  margin-top: 1rem;
}

.coffilot-carousel-dot {
  width: 0.7rem;
  height: 0.7rem;
  padding: 0;
  border: 1px solid var(--coffilot-border-alt);
  border-radius: 999px;
  background: var(--coffilot-surface-alt);
  cursor: pointer;
  transition:
    background 160ms ease,
    transform 160ms ease;
}

.coffilot-carousel-dot:hover {
  transform: scale(1.15);
}

.coffilot-carousel-dot--active {
  border-color: transparent;
  background: linear-gradient(135deg, var(--coffilot-green), var(--coffilot-blue));
}

@media (max-width: 48rem) {
  .coffilot-carousel-caption {
    padding: 2rem 1rem 1rem;
  }

  .coffilot-carousel-caption-text {
    display: none;
  }

  .coffilot-carousel-control {
    width: 2.25rem;
    height: 2.25rem;
  }

  .coffilot-carousel-icon {
    width: 0.95rem;
    height: 0.95rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .coffilot-carousel-track {
    transition: none;
  }
}
</style>
