/**
 * How the browser bundle is built (HOST-260): the one description that `tsup.browser.config.ts` (which writes `dist/browser.js`)
 * and `tools/browser-bundle.test.ts` (which holds the bundle to its rules) both use, so that the guard tests the bundle that ships.
 *
 * Test-only tooling and build configuration: nothing under `src/` imports it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildOptions, Plugin } from "esbuild";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The browser entry point and the module that is replaced for it. */
export const BROWSER_ENTRY = "src/browser.ts";
export const DEFAULT_HOST = "src/host/default-host.ts";
export const DEFAULT_HOST_BROWSER = "src/host/default-host.browser.ts";
/** The module that defines the global `Buffer` the core is written against (HOST-262). */
export const BUFFER_SHIM = "src/browser/buffer-shim.ts";

/**
 * The packages whose code the bundle contains, which is every package the entry reaches (`@xmldom/xmldom`, `xpath` and `fflate`, which are
 * dependencies, and `buffer` with its two dependencies, which are not). Their licences are kept in the bundle's banner.
 */
export const BUNDLED_PACKAGES: readonly string[] = ["@xmldom/xmldom", "xpath", "fflate", "buffer", "base64-js", "ieee754"];

/**
 * An esbuild plugin that gives `src/host/default-host.ts` the contents of `default-host.browser.ts`: the one module of the core
 * that names the Node implementations of the host (HOST-200), so that nothing under `node:*` is in the browser's graph. esbuild's
 * `alias` option maps package names, not files, so this is the same alias as a resolve hook.
 */
export function replaceDefaultHost(root: string = repoRoot): Plugin {
  const from = path.join(root, DEFAULT_HOST);
  const to = path.join(root, DEFAULT_HOST_BROWSER);
  return {
    name: "replace-default-host",
    setup(build) {
      build.onResolve({ filter: /default-host\.js$/ }, (args) => {
        if (!args.resolveDir) return undefined;
        const resolved = path.join(args.resolveDir, args.path.replace(/\.js$/, ".ts"));
        return resolved === from ? { path: to } : undefined;
      });
    },
  };
}

/** The licence texts of {@link BUNDLED_PACKAGES}, as the comment at the head of the bundle. */
export function licenseBanner(root: string = repoRoot): string {
  const parts = BUNDLED_PACKAGES.map((name) => {
    const dir = path.join(root, "node_modules", name);
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { version: string; license: string };
    const text = readFileSync(path.join(dir, "LICENSE"), "utf8").trim().replaceAll("*/", "* /");
    return `${name} ${manifest.version} (${manifest.license})\n\n${text}`;
  });
  return `/*! Third-party code in this bundle, with its licences.\n\n${parts.join("\n\n----\n\n")}\n*/`;
}

/** What the bundle is built with, esbuild options of `tsup.browser.config.ts` and of the guard test alike. */
export function browserBundleOptions(root: string = repoRoot): BuildOptions {
  return {
    entryPoints: [path.join(root, BROWSER_ENTRY)],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    treeShaking: true,
    inject: [path.join(root, BUFFER_SHIM)],
    plugins: [replaceDefaultHost(root)],
    tsconfig: path.join(root, "tsconfig.json"),
    logLevel: "silent",
  };
}
