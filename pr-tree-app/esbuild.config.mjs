import { build } from 'esbuild';
import { cpSync } from 'fs';

// レンダラーの HTML と CSS を dist にコピー
cpSync('src/renderer/index.html', 'dist/renderer/index.html');
cpSync('src/renderer/styles.css', 'dist/renderer/styles.css');

await build({
  entryPoints: ['dist/renderer/app.js'],
  bundle: true,
  outfile: 'dist/renderer-bundle.js',
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
});
