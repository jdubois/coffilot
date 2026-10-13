<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import { onConsentChange, readConsent, setConsent } from "../analytics.js";

const consent = ref(null);
const hydrated = ref(false);

onMounted(() => {
  consent.value = readConsent();
  hydrated.value = true;
});

onUnmounted(
  onConsentChange((value) => {
    consent.value = value;
  }),
);

const status = computed(() => {
  if (consent.value === "granted") {
    return "Analytics cookies are currently allowed.";
  }
  if (consent.value === "denied") {
    return "Analytics cookies are currently refused.";
  }
  return "You have not made a choice yet, so no analytics cookies are set.";
});

function choose(value) {
  setConsent(value);
  consent.value = value;
}
</script>

<template>
  <div v-if="hydrated" class="coffilot-cookie-settings">
    <p class="coffilot-cookie-settings__status" role="status">{{ status }}</p>
    <div class="coffilot-cookie-settings__actions">
      <button
        type="button"
        class="coffilot-cookie-settings__button"
        :class="{ 'coffilot-cookie-settings__button--active': consent === 'granted' }"
        :aria-pressed="consent === 'granted'"
        @click="choose('granted')"
      >
        Allow analytics
      </button>
      <button
        type="button"
        class="coffilot-cookie-settings__button"
        :class="{ 'coffilot-cookie-settings__button--active': consent === 'denied' }"
        :aria-pressed="consent === 'denied'"
        @click="choose('denied')"
      >
        Refuse analytics
      </button>
    </div>
  </div>
  <p v-else class="coffilot-cookie-settings__status">Loading your current preference…</p>
</template>

<style scoped>
.coffilot-cookie-settings {
  margin: 1.5rem 0;
  padding: 1rem 1.25rem;
  border: 1px solid var(--coffilot-border);
  border-radius: 1.1rem;
  background: var(--coffilot-surface-alt);
}

.coffilot-cookie-settings__status {
  margin: 0 0 0.75rem;
  color: var(--coffilot-text-muted);
  font-size: 0.85rem;
}

.coffilot-cookie-settings__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.coffilot-cookie-settings__button {
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

.coffilot-cookie-settings__button:hover {
  border-color: var(--coffilot-green);
  background: var(--coffilot-nav-hover-bg);
}

.coffilot-cookie-settings__button--active {
  border-color: transparent;
  background: var(--coffilot-green);
  color: #ffffff;
}

.coffilot-cookie-settings__button--active:hover {
  background: var(--coffilot-green-dark);
}
</style>
