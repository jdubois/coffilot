<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { applyConsent, onConsentChange, readConsent, setConsent, watchOtherTabs } from "../analytics.js";

const visible = ref(false);

// The banner is client-only: rendering it during the static build would ship a prompt that is
// already answered for returning readers, and would flash before hydration for everyone else.
onMounted(() => {
  const consent = readConsent();
  applyConsent(consent);
  visible.value = consent === null;
});

onUnmounted(
  onConsentChange((consent) => {
    visible.value = consent === null;
  }),
);

// The banner is the one component always on the page, so it owns the listener that keeps this tab
// in step with a choice made in another one.
onUnmounted(watchOtherTabs());

function accept() {
  setConsent("granted");
  visible.value = false;
}

function decline() {
  setConsent("denied");
  visible.value = false;
}
</script>

<template>
  <Transition name="coffilot-consent">
    <aside
      v-if="visible"
      class="coffilot-consent"
      role="region"
      aria-labelledby="coffilot-consent-title"
      aria-describedby="coffilot-consent-description"
    >
      <div class="coffilot-consent__text">
        <p id="coffilot-consent-title" class="coffilot-consent__title">Analytics cookies</p>
        <p id="coffilot-consent-description" class="coffilot-consent__description">
          Coffilot would like to use Google Analytics to understand which documentation pages are useful. Nothing is set
          unless you accept, and declining changes nothing about how the site works. See the
          <RouteLink to="/privacy">privacy notice</RouteLink> for details or to change your mind later.
        </p>
      </div>
      <div class="coffilot-consent__actions">
        <button type="button" class="coffilot-consent__button" @click="decline">Decline</button>
        <button type="button" class="coffilot-consent__button coffilot-consent__button--primary" @click="accept">
          Accept
        </button>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.coffilot-consent {
  position: fixed;
  z-index: 100;
  right: 1rem;
  bottom: 1rem;
  left: 1rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 1.5rem;
  max-width: 62rem;
  margin: 0 auto;
  padding: 1rem 1.25rem;
  border: 1px solid var(--coffilot-border);
  border-radius: 1.1rem;
  background: var(--coffilot-surface-solid);
  box-shadow: var(--coffilot-shadow-md);
  color: var(--coffilot-text);
}

.coffilot-consent__text {
  flex: 1 1 22rem;
}

.coffilot-consent__title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  font-weight: 700;
}

.coffilot-consent__description {
  margin: 0;
  color: var(--coffilot-text-muted);
  font-size: 0.85rem;
  line-height: 1.5;
}

.coffilot-consent__actions {
  display: flex;
  flex: 0 0 auto;
  gap: 0.6rem;
}

.coffilot-consent__button {
  padding: 0.5rem 1.1rem;
  border: 1px solid var(--coffilot-border-alt);
  border-radius: 0.75rem;
  background: transparent;
  color: var(--coffilot-text);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.coffilot-consent__button:hover {
  border-color: var(--coffilot-green);
  background: var(--coffilot-nav-hover-bg);
}

.coffilot-consent__button--primary {
  border-color: transparent;
  background: var(--coffilot-green);
  color: #ffffff;
}

.coffilot-consent__button--primary:hover {
  border-color: transparent;
  background: var(--coffilot-green-dark);
}

.coffilot-consent-enter-active,
.coffilot-consent-leave-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}

.coffilot-consent-enter-from,
.coffilot-consent-leave-to {
  opacity: 0;
  transform: translateY(0.75rem);
}

@media (prefers-reduced-motion: reduce) {
  .coffilot-consent-enter-active,
  .coffilot-consent-leave-active {
    transition: none;
  }
}

@media (max-width: 40rem) {
  .coffilot-consent__actions {
    width: 100%;
  }

  .coffilot-consent__button {
    flex: 1 1 0;
  }
}
</style>
