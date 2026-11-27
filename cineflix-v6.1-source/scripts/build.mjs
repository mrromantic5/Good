// CineFliX production build — TypeScript → minified, code-split, content-hashed ES modules.
//   node scripts/build.mjs           one-off build into dist/
//   node scripts/build.mjs --watch   rebuild on change
import * as esbuild from 'esbuild';
import { transform as cssTransform, browserslistToTargets } from 'lightningcss';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const OUT = 'dist';
const ASSETS = join(OUT, 'cf/dist');
const watch = process.argv.includes('--watch');

// Inline icon set (same data the TS bundle uses) for static HTML placeholders.
const ICONS = Function('return ' + readFileSync('src/icons.gen.ts', 'utf8').match(/export const ICONS = (\{[\s\S]*?\}) as const/)[1])();
const svg = (n) => { const [vb, d] = ICONS[n]; return `<svg class="ic" viewBox="${vb}" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`; };

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);

async function build() {
  const t0 = Date.now();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(ASSETS, { recursive: true });

  /* 1 ─ JS: one entry per page, shared code split into cached chunks */
  const js = await esbuild.build({
    entryPoints: { home: 'src/pages/home.ts', player: 'src/pages/player.ts', live: 'src/pages/live.ts' },
    outdir: ASSETS, bundle: true, splitting: true, format: 'esm', target: ['es2019', 'safari13'],
    minify: true, treeShaking: true, legalComments: 'none', metafile: true,
    entryNames: '[name]-[hash]', chunkNames: 'core-[hash]', charset: 'utf8',
    define: { __CF_VERSION__: JSON.stringify(pkg.version) }
  });
  const entry = {}, deps = {};
  for (const [file, meta] of Object.entries(js.metafile.outputs)) {
    if (!meta.entryPoint) continue;
    const name = meta.entryPoint.match(/pages\/(\w+)\.ts$/)[1];
    entry[name] = file.replace(OUT + '/', '');
    deps[name] = meta.imports.filter((i) => i.kind === 'import-statement').map((i) => i.path.replace(OUT + '/', ''));
  }

  /* 2 ─ CSS: minified + hashed */
  const { code: css } = cssTransform({
    filename: 'cineflix.css', code: readFileSync('styles/cineflix.css'), minify: true,
    targets: browserslistToTargets(['chrome >= 80', 'safari >= 13', 'firefox >= 78', 'samsung >= 12'])
  });
  const cssFile = `cf/dist/cineflix-${hash(css)}.css`;
  writeFileSync(join(OUT, cssFile), css);

  /* 3 ─ HTML: inject assets, modulepreload chunks, inline icons */
  const head = readFileSync('public/_head.html', 'utf8');
  const gate = readFileSync('public/_gate.html', 'utf8');
  const page = (tpl, name) => {
    const preload = [entry[name], ...deps[name]].map((f) => `<link rel="modulepreload" href="${f}">`).join('\n');
    return readFileSync(`public/${tpl}`, 'utf8')
      .replace('{{HEAD}}', head.replace('{{CSS}}', cssFile).replace('{{PRELOAD}}', preload))
      .replace('{{GATE}}', gate)
      .replace('{{JS}}', entry[name])
      .replace(/<i data-ic="([\w-]+)"><\/i>/g, (_, n) => svg(n))
      .replace(/\n\s*\n/g, '\n');
  };
  const html = { 'index.html': page('index.html', 'home'), 'player.html': page('player.html', 'player'), 'live.html': page('live.html', 'live') };
  html['movie.html'] = html['index.html']; // ChatXAP-host entry (c.x.t-lyfe.com.ng/movie.html)
  for (const [f, s] of Object.entries(html)) writeFileSync(join(OUT, f), s);

  /* 4 ─ Service worker (root scope, not hashed — browsers re-check it) */
  const precache = ['index.html', 'player.html', 'live.html', cssFile, ...Object.keys(js.metafile.outputs).map((f) => f.replace(OUT + '/', ''))];
  const sw = await esbuild.build({ entryPoints: ['src/sw.ts'], bundle: true, minify: true, write: false, format: 'iife', target: 'es2019' });
  writeFileSync(join(OUT, 'cineflix-sw.js'),
    `self.__CF_PRECACHE__=${JSON.stringify(precache)};\n` + sw.outputFiles[0].text.replace('__CF_VERSION__', pkg.version + '-' + hash(precache.join())));

  /* 5 ─ Static files */
  for (const p of ['static/.htaccess', 'static/README.md']) if (existsSync(p)) cpSync(p, join(OUT, p.replace('static/', '')));
  cpSync('static/cf', join(OUT, 'cf'), { recursive: true });
  cpSync('docs', join(OUT, 'docs'), { recursive: true });

  /* Report */
  let total = 0, gz = 0;
  const rows = Object.keys(js.metafile.outputs).concat(cssFile.replace('cf/dist/', OUT + '/cf/dist/').replace(OUT + '/' + OUT, OUT)).map((f) => {
    const p = f.startsWith(OUT) ? f : join(OUT, f);
    const b = readFileSync(p); const g = gzipSync(b).length; total += b.length; gz += g;
    return `  ${p.replace(OUT + '/', '').padEnd(36)} ${(b.length / 1024).toFixed(1).padStart(6)} KB  ${(g / 1024).toFixed(1).padStart(5)} KB gz`;
  });
  console.log(rows.join('\n') + `\n  ${'TOTAL'.padEnd(36)} ${(total / 1024).toFixed(1).padStart(6)} KB  ${(gz / 1024).toFixed(1).padStart(5)} KB gz\n  built v${pkg.version} in ${Date.now() - t0} ms`);
}

await build();
if (watch) {
  const { watch: fsWatch } = await import('node:fs');
  let t; for (const d of ['src', 'styles', 'public']) fsWatch(d, { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => build().catch(console.error), 150); });
  console.log('watching…');
}
