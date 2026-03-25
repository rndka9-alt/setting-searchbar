import * as esbuild from 'esbuild';

esbuild.buildSync({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'iife',
  outfile: 'dist/client.js',
  target: 'es2018',
});

esbuild.buildSync({
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/server.js',
  target: 'node18',
  sourcemap: true,
});
