import { build } from "esbuild";

await build({
  entryPoints: { background: "src/background.js", content: "src/content.js", options: "src/options.js" },
  outdir: "extension/dist",
  bundle: true,
  format: "iife", // content scripts can't be ES modules
  target: "chrome120",
  minify: false,
  logLevel: "info",
});
