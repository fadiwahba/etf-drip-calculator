import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    // `node` is deliberate: the calculation layer under test is pure functions.
    // Switch to jsdom/happy-dom only when a component test genuinely needs a DOM.
    environment: "node",
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**"],
    coverage: {
      provider: "v8",
      // Only the money maths is worth a coverage gate — UI coverage numbers
      // measure nothing useful here.
      include: ["lib/**/*.ts"],
      reporter: ["text", "html"],
    },
  },
  resolve: {
    // Mirrors the `@/*` -> project root alias in tsconfig.json.
    // `import.meta.dirname`, not `__dirname`: this is an ESM config (.mts) and
    // Vite's native config loader does not shim CJS globals.
    alias: { "@": path.resolve(import.meta.dirname, "./") },
  },
});
