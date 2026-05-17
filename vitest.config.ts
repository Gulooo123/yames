import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // happy-dom replaces jsdom here purely to dodge the broken
    // `html-encoding-sniffer@6.0.0` → `require('@exodus/bytes')` chain.
    // `@exodus/bytes@1.15.0` flipped to `"type": "module"`, so the CJS
    // `require()` inside html-encoding-sniffer fails with
    // ERR_REQUIRE_ESM. happy-dom is faster, smaller, and gives us the
    // same JSDOM-style globals our React component tests rely on.
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "src-tauri"],
    css: false,
    // bun's worker MessagePort lacks `addListener`, which breaks vitest's
    // default `threads` pool. `forks` uses child_process and works fine.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
