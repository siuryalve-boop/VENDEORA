import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";

const root = process.cwd();
const modules = {
  name: "project-modules",
  setup(bundle) {
    bundle.onResolve({ filter: /.*/ }, async ({ path, importer }) => {
      const from =
        importer && importer !== "<stdin>"
          ? importer
          : resolve(root, "package.json");
      if (!path.startsWith(".")) {
        const require = createRequire(from);
        if (path === "lucide-react") {
          const manifest = require.resolve("lucide-react/package.json");
          return {
            path: resolve(dirname(manifest), require(manifest).module),
            namespace: "project-file",
          };
        }
        return {
          path: require.resolve(path),
          namespace: "project-file",
        };
      }
      const stem = resolve(dirname(from), path);
      for (const suffix of ["", ".ts", ".tsx", ".js", ".json"]) {
        const file = stem + suffix;
        if ((await stat(file).catch(() => null))?.isFile())
          return { path: file, namespace: "project-file" };
      }
      return { errors: [{ text: `Arquivo não encontrado: ${path}` }] };
    });
    bundle.onLoad(
      { filter: /.*/, namespace: "project-file" },
      async ({ path }) => ({
        contents: await readFile(path),
        loader:
          { ".tsx": "tsx", ".ts": "ts", ".json": "json" }[extname(path)] ??
          "js",
      }),
    );
  },
};

const browser = await build({
  stdin: {
    contents: `import { createRoot } from 'react-dom/client';
      import { Vendeora } from './app/vendeora';
      const host = document.getElementById('vendeora');
      createRoot(host).render(<Vendeora path={location.pathname} captchaKey={host.dataset.captcha || ''} />);`,
    loader: "tsx",
  },
  tsconfigRaw: {},
  plugins: [modules],
  bundle: true,
  jsx: "automatic",
  platform: "browser",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
});

const source = "app/style.css";
const css = await postcss([tailwindcss()]).process(
  await readFile(source, "utf8"),
  { from: source },
);
const brand = await readFile("public/marca.png");

await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await build({
  stdin: {
    contents: `import { handleApi } from './lib/server';
      const staticHeaders = {
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy': "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; frame-src https://challenges.cloudflare.com",
      };
      const assets = {
        '/app.js': ['text/javascript; charset=utf-8', ${JSON.stringify(browser.outputFiles[0].text)}],
        '/app.css': ['text/css; charset=utf-8', ${JSON.stringify(css.css)}],
        '/marca.png': ['image/png', Uint8Array.from(atob(${JSON.stringify(brand.toString("base64"))}), (character) => character.charCodeAt(0))],
      };
      function escape(value) { return String(value || '').replace(/[^a-z0-9_-]/gi, ''); }
      export default { async fetch(request, env) {
        const { pathname } = new URL(request.url);
        if (pathname.startsWith('/api/')) return handleApi(request, env);
        if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Método não permitido', { status: 405 });
        const asset = assets[pathname];
        if (asset) return new Response(request.method === 'HEAD' ? null : asset[1], { headers: { ...staticHeaders, 'Content-Type': asset[0], 'Cache-Control': 'public, max-age=300' } });
        const shell = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>VENDEORA | Seu negócio digital</title><link rel="icon" href="/marca.png"><link rel="stylesheet" href="/app.css"><body><div id="vendeora" data-captcha="' + escape(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) + '"></div><script type="module" src="/app.js"></script></body></html>';
        return new Response(request.method === 'HEAD' ? null : shell, { headers: { ...staticHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' } });
      } };`,
    loader: "ts",
  },
  tsconfigRaw: {},
  plugins: [modules],
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  outfile: "dist/server/index.js",
});
