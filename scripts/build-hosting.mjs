import { mkdir, rm, copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "public");
const updateDir = resolve(output, "bsk-updates");
const release = JSON.parse(await readFile(resolve(root, "bsk-release.json"), "utf8"));
if (!Number.isSafeInteger(release.version) || release.version < 1 ||
    !Number.isSafeInteger(release.minNativeVersion) || release.minNativeVersion < 1) {
  throw new Error("bsk-release.json must contain positive integer version and minNativeVersion values");
}
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const source = await readFile(resolve(root, "app.js"), "utf8");
const replacements = [
  ["https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js", "firebase/app"],
  ["https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js", "firebase/auth"],
  ["https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js", "firebase/firestore"]
];
let bundledSource = source;
for (const [remote, local] of replacements) {
  if (!bundledSource.includes(remote)) throw new Error("Expected Firebase SDK import not found: " + remote);
  bundledSource = bundledSource.replaceAll(remote, local);
}

await build({
  stdin: { contents: bundledSource, resolveDir: root, sourcefile: "app.js", loader: "js" },
  bundle: true, format: "esm", platform: "browser", target: ["es2022"],
  outfile: resolve(output, "app.js"), minify: true, sourcemap: false, legalComments: "none"
});

for (const file of ["index.html", "style.css", "bsk-config.js", "manifest.webmanifest", "sw.js"]) {
  await copyFile(resolve(root, file), resolve(output, file));
}

const zip = new JSZip();
const bundleFiles = ["index.html", "app.js", "style.css", "bsk-config.js", "manifest.webmanifest", "sw.js"];
for (const file of bundleFiles) zip.file(file, await readFile(resolve(output, file)));
const bundle = await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 }
});
await mkdir(updateDir, { recursive: true });
const bundleName = `bsk-assets-v${release.version}.zip`;
await writeFile(resolve(updateDir, bundleName), bundle);
const sha256 = createHash("sha256").update(bundle).digest("hex");
const manifest = {
  version: release.version,
  minNativeVersion: release.minNativeVersion,
  bundleUrl: `https://testing-app-8af35.web.app/bsk-updates/${bundleName}`,
  sha256,
  releaseNotes: String(release.releaseNotes || "BSK app update")
};
await writeFile(resolve(updateDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const builtHtml = await readFile(resolve(output, "index.html"), "utf8");
const builtApp = await readFile(resolve(output, "app.js"), "utf8");
if (!builtHtml.includes('/bsk-config.js') || !builtHtml.includes('/app.js')) throw new Error("Hosting HTML is incomplete");
if (builtApp.includes("https://www.gstatic.com/firebasejs/13.2.0/firebase-")) throw new Error("Remote Firebase SDK import remained in bundle");
console.log(`Firebase Hosting build ready: asset version ${release.version}, SHA-256 ${sha256}, local Firebase SDK bundle.`);
