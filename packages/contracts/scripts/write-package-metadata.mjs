import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('dist/esm', { recursive: true });
await mkdir('dist/cjs', { recursive: true });
await writeFile('dist/esm/package.json', '{"type":"module"}\n');
await writeFile('dist/cjs/package.json', '{"type":"commonjs"}\n');
