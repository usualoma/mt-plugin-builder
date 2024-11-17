import { defineConfig } from "@usualoma/mt-plugin-builder";

export default defineConfig({
  // You can override these values in package.json
  // name: "example-plugin
  // author_link: "https://example.com",
  // author_name: "Example Author",
  // description: "Example description",

  // copy dist/ to mt-static/plugin/plugin-name/
  mt_static: "dist",
  // insert mt-static/plugin/plugin-name/main.js to admin screen
  script: "main.js",
});
