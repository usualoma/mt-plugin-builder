import { defineConfig } from "@usualoma/mt-plugin-builder";

export default defineConfig({
  // You can override these values in package.json
  // name: "example-plugin
  // author_link: "https://example.com",
  // author_name: "Example Author",
  // description: "Example description",

  callbacks: {
    "MT::Entry::pre_save": "https://example.com/pre_save",
    "MT::Entry::post_save": "https://example.com/post_save",
  },
});
