# mt-plugin-builder

A build tool for Movable Type plugin development.

## Installation

```
npm install --save-dev @usualoma/mt-plugin-builder
```

or just use npx:

```
npx @usualoma/mt-plugin-builder
```

## Usage

### Configuration File

Create `mt-plugin.config.ts` in your project root:

```ts
import { defineConfig } from '@usualoma/mt-plugin-builder';

export default defineConfig({
  script: 'main.js',
  mt_static: 'dist',
});
```

### Build Commands

Add build scripts to your package.json:

```json
{
  "scripts": {
    "build:app": "vite build",
    "build:plugin": "mt-plugin-builder build",
    "build": "npm run build:app && npm run build:plugin"
  }
}
```

## License

MIT
