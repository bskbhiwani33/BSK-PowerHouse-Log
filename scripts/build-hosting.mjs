import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public");
await mkdir(output, { recursive: true });

const source = await readFile(resolve(root, "app.js"), "utf8");
const replacements = [
  ["https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js", "firebase/app"],
  ["https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js", "firebase/auth"],
  ["https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js", "firebase/firestore"]
];
let bundledSource = source;
for (const [remote, local] of replacements) {
  if (!bundledSource.includes(remote)) {
    throw new Error("Expected Firebase SDK import not found: " + remote);
  }
  bundledSource = bundledSource.replaceAll(remote, local);
}

await build({
  stdin: {
    contents: bundledSource,
    resolveDir: root,
    sourcefile: "app.js",
    loader: "js"
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: resolve(output, "app.js"),
  minify: true,
  sourcemap: false,
  legalComments: "none"
});

for (const file of ["index.html", "style.css", "bsk-config.js", "manifest.webmanifest", "sw.js"]) {
  await copyFile(resolve(root, file), resolve(output, file));
}
const builtHtml = await readFile(resolve(output, "index.html"), "utf8");
if (!builtHtml.includes('/bsk-config.js') || !builtHtml.includes('/app.js')) {
  throw new Error("Hosting HTML is missing runtime config or app bundle");
}
const builtApp = await readFile(resolve(output, "app.js"), "utf8");
if (builtApp.includes("https://www.gstatic.com/firebasejs/13.2.0/firebase-")) {
  throw new Error("Remote Firebase SDK import remained in the generated app bundle");
}
const config = await readFile(resolve(output, "bsk-config.js"), "utf8");
if (!config.includes("BSK_FUNCTIONS_BASE")) throw new Error("Runtime API config missing");
console.log("Firebase Hosting bundle built: local Firebase SDK, app shell, CSS, manifest and service worker.");
