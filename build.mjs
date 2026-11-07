import { build } from "esbuild";

await build({
  entryPoints: { background: "src/background.js", content: "src/content.js", options: "src/options.js", studio: "src/studio.js" },
  outdir: "extension/dist",
  bundle: true,
  format: "iife", // content scripts can't be ES modules
  target: "chrome120",
  minify: false,
  logLevel: "info",
  // `npm run e2e` builds with an open shadow root so Playwright can query it.
  define: { __SHADOW_MODE__: JSON.stringify(process.env.SKILL_PET_E2E ? "open" : "closed") },
});
