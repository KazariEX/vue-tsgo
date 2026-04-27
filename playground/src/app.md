<script lang="ts" setup>
  import { ref } from "vue";

  const count = ref(0);
</script>

<button @click="count++">
  Count is: {{ count === "count" }}
</button>

<!-- code block -->
```html
<div</div>
```

<!-- latex block -->
$$
<div</div>
$$

<!-- code snippet -->
<<< @/snippets/foo.ts{2-3}

<!-- inline code -->
`<div</div>`

<!-- angle brackets -->
<https://github.com/KazariEX/vue-tsgo>

<!-- template literals -->
<div :foo="`count`">{{ `count` }}</div>
