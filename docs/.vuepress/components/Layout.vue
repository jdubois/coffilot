<script setup>
import ParentLayout from "@vuepress/theme-default/layouts/Layout.vue";
import VPHome from "@theme/VPHome.vue";
import { useFrontmatter } from "vuepress/client";
import CopyrightFooter from "./CopyrightFooter.vue";

const frontmatter = useFrontmatter();
</script>

<template>
  <ParentLayout>
    <template v-if="frontmatter.home" #page>
      <VPHome />
      <CopyrightFooter class="coffilot-copyright--home" />
    </template>
    <template v-else #page-bottom>
      <CopyrightFooter />
    </template>
  </ParentLayout>
</template>
