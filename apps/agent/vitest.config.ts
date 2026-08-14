import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// O projeto usa NodeNext (imports com extensao .js que apontam para .ts).
// O Vite nao resolve ".js" -> ".ts" por padrao; este plugin cuida disso.
const resolveJsToTs: Plugin = {
  name: 'resolve-js-to-ts',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!source.endsWith('.js')) {
      return null;
    }
    const base = importer ? dirname(importer) : process.cwd();
    const tsPath = resolve(base, source.slice(0, -3) + '.ts');
    return existsSync(tsPath) ? tsPath : null;
  },
};

const alias: Record<string, string> = {};
if (existsSync(resolve(__dirname, '../../packages/db/src/index.ts'))) {
  alias['@loja/db'] = resolve(__dirname, '../../packages/db/src/index.ts');
}
if (existsSync(resolve(__dirname, '../../packages/catalog/src/index.ts'))) {
  alias['@loja/catalog'] = resolve(__dirname, '../../packages/catalog/src/index.ts');
}

export default defineConfig({
  plugins: [resolveJsToTs],
  resolve: { alias },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
    },
  },
});
