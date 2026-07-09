<script lang="ts" setup>
  import { ref } from "vue";

  const count = ref(0);
</script>

<template>
  <button @click="count++">
    Count is: {{ count === "count" }}
  </button>
</template>
