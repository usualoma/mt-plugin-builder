import { defineConfig } from "@usualoma/mt-plugin-builder";

export default defineConfig({
  // You can override these values in package.json
  // name: "example-plugin
  // author_link: "https://example.com",
  // author_name: "Example Author",
  // description: "Example description",

  tags: {
    function: {
      "myFunction": "https://example.com/my-function",
    },
    block: {
      "myBlock": "https://example.com/my-block",
    },
    modifier: {
      "myModifier": "https://example.com/my-modifier",
    },
  },
});
