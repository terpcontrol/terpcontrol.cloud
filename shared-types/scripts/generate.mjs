/**
 * Turns the zod schemas under `src/` into what this package publishes: the
 * declaration files every consumer imports, the `components.schemas` of the API
 * documents, and the compiled schemas the server validates with.
 *
 * All of it is committed, because consumers link this package with `file:` and
 * no build runs for them. CI regenerates and fails on a diff, the same way it
 * does for lint.
 *
 * The types go out through JSON Schema rather than through `z.infer`, so that
 * what reaches the webapp is a flat declaration file with no dependency on zod
 * at all - the webapp is on TypeScript 4.8, which cannot parse zod's own types.
 *
 * There are two registries and therefore two pairs of outputs. `src/schemas.ts`
 * describes the API the Angular app calls; `src/v1/` describes the `/v1`
 * contract of the rewrite, which shares neither its names nor its vocabulary.
 * They are generated side by side because the server is rewritten module by
 * module and both halves have to compile meanwhile. The legacy pair goes when
 * the last module that imports it does, and this file loses one call.
 *
 * `/v1` goes out through two entry points, because its two readers want opposite
 * things and one file cannot be both:
 *
 *   `@fg2/shared-types/v1`         `v1.d.ts` - the flat interfaces above, with
 *                                  no zod anywhere in them. A client app reads
 *                                  JSON and only needs to know its shape, and
 *                                  the Angular app's TypeScript cannot parse
 *                                  zod's types at all.
 *   `@fg2/shared-types/v1-schemas` `v1-schemas/` - the schemas themselves and
 *                                  the runtime tables beside them, compiled from
 *                                  the same sources. The server validates with
 *                                  zod and derives its request bodies from the
 *                                  resource schemas rather than restating them,
 *                                  so it has to import the schema objects; and
 *                                  `METRIC_FIELD` and its siblings are values,
 *                                  which no declaration file can carry.
 *
 * The second is emitted as CommonJS with declarations beside it: the server
 * compiles to CommonJS, and so does this package's other runtime half,
 * `index.js`. It is committed like everything else here, so a consumer needs no
 * build of its own.
 *
 * Its declarations name zod's own types, and node resolves a linked package's
 * imports from the link target, so a consumer ends up holding two copies of zod:
 * its own and this package's. That is harmless while they are the same release
 * and miserable when they are not - TypeScript compares zod's recursive
 * internals structurally and gives up with "type instantiation is excessively
 * deep" - so the `zod` dependency here and in the consumer are kept in step.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

/**
 * The schemas are TypeScript; compile them to a throwaway directory and import
 * that. It has to sit inside the package, or node cannot resolve `zod` from it.
 */
const buildDir = mkdtempSync(join(root, '.generated-'));
mkdirSync(buildDir, { recursive: true });
// tsc emits `.js`, and this package is not itself a module; saying so once here
// makes every emitted file load as ESM, the imports between them included.
writeFileSync(join(buildDir, 'package.json'), '{ "type": "module" }\n');

/** Compiles one entry point into the throwaway directory and hands back the registry it exports. */
const registryOf = async (entry, label) => {
  const outDir = join(buildDir, label);
  execFileSync(
    process.execPath,
    [tsc, join(root, entry), '--outDir', outDir, '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2022', '--strict'],
    { stdio: 'inherit' },
  );

  const module = join(outDir, basename(entry).replace(/\.ts$/, '.js'));
  const { registry } = await import(pathToFileURL(module).href);
  return registry;
};

/**
 * Compiles `src/v1/` into the committed `v1-schemas/` and hands back the
 * registry, so that the declaration file, the OpenAPI document and the runtime
 * half all come out of one compile of one set of sources.
 *
 * The directory is emptied first: a source file that goes away must not leave a
 * module behind that still resolves and is a year out of date.
 */
const buildRuntime = (entry, outDir) => {
  rmSync(join(root, outDir), { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [
      tsc,
      join(root, entry),
      '--outDir',
      join(root, outDir),
      // What the server compiles to, and what `index.js` beside this already is.
      '--module',
      'commonjs',
      '--moduleResolution',
      'node',
      '--target',
      'es2022',
      // Under CommonJS resolution zod is read through its `.d.cts`, which
      // default-imports its locales; the server compiles with this on too.
      '--esModuleInterop',
      // Without these the schemas arrive as `any` and the point of importing
      // them rather than the flat types is lost.
      '--declaration',
      '--strict',
      // The output is committed and CI fails on a diff, so it may not depend on
      // the platform it was generated on.
      '--newLine',
      'lf',
    ],
    { stdio: 'inherit' },
  );

  const { registry } = require(join(root, outDir, basename(entry).replace(/\.ts$/, '.js')));
  return registry;
};

/**
 * One registry in, one declaration file and one `components.schemas` document
 * out. Both halves are generated exactly alike; what differs between them is
 * where they come from, what they are called, and whether a hand-written
 * runtime declaration is appended.
 */
const generate = async ({ registry, source, types: typesFile, openApi: openApiFile, runtime: runtimeFile }) => {
  const { schemas } = z.toJSONSchema(registry, {
    io: 'output',
    // `wireDate` and `wireBytes` describe themselves through `.meta()`; without
    // this, zod refuses a Date or a custom type outright.
    unrepresentable: 'any',
    uri: id => `#/$defs/${id}`,
  });
  for (const schema of Object.values(schemas)) {
    delete schema.$schema;
    delete schema.$id;
  }

  // The API document is this file's only consumer, so it carries the references
  // OpenAPI resolves. `tsType` is dropped: it only tells the TypeScript
  // generator below what to emit, and is not a JSON Schema keyword at all.
  const forOpenApi = JSON.parse(JSON.stringify(schemas).replaceAll('#/$defs/', '#/components/schemas/'), (key, value) => {
    // A generator hint, not a JSON Schema keyword.
    if (key === 'tsType') return undefined;
    // zod closes an object because that is what it validates a request against.
    // A response is the other direction: these schemas say which fields are
    // there, not that nothing else is - answers carry mongoose's own `_id` and
    // fields computed as the document is read.
    if (key === 'additionalProperties' && value === false) return undefined;
    return value;
  });
  writeFileSync(join(root, openApiFile), `${JSON.stringify(forOpenApi, null, 2)}\n`);

  // One document, so every type is emitted and the references between them stay
  // named rather than being inlined.
  const bundle = {
    $defs: schemas,
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(Object.keys(schemas).map(id => [id, { $ref: `#/$defs/${id}` }])),
  };

  const compiled = await compile(bundle, 'EveryType', {
    bannerComment: '',
    declareExternallyReferenced: true,
    enableConstEnums: false,
    style: { singleQuote: true, printWidth: 150 },
  });

  // The root only existed to pull the others in.
  const types = compiled
    .replace(/export interface EveryType \{[^}]*\}\n*/, '')
    .replace(/\n(?=(export|\/\*\*))/g, '\n\n')
    .trim();

  const runtime = runtimeFile ? readFileSync(join(root, runtimeFile), 'utf8').trim() : null;

  writeFileSync(
    join(root, typesFile),
    [
      `// Generated by \`npm run generate\` from ${source}.`,
      '// Do not edit: change the schema and regenerate.',
      '',
      types,
      ...(runtime === null ? [] : ['', runtime]),
      '',
    ].join('\n'),
  );

  console.log(`Generated ${typesFile} (${Object.keys(schemas).length} types) and ${openApiFile}`);
};

try {
  await generate({
    registry: await registryOf(join('src', 'schemas.ts'), 'legacy'),
    source: 'src/schemas.ts and src/runtime.d.ts',
    types: 'index.d.ts',
    openApi: 'openapi-schemas.json',
    runtime: join('src', 'runtime.d.ts'),
  });

  await generate({
    registry: buildRuntime(join('src', 'v1', 'index.ts'), 'v1-schemas'),
    source: 'src/v1/index.ts',
    types: 'v1.d.ts',
    openApi: 'openapi-v1-schemas.json',
  });
  console.log('Generated v1-schemas/ (the runtime half of /v1)');
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}
