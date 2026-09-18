/**
 * Turns the zod schemas under `src/v1/` into what this package publishes: the
 * declaration file every consumer imports, the `components.schemas` of the API
 * document, and the compiled schemas the server validates with.
 *
 * `/v1` is the contract - the whole of it, from one registry.
 *
 * All of the output is committed, because consumers link this package with
 * `file:` and no build runs for them. CI regenerates and fails on a diff, the
 * same way it does for lint.
 *
 * The types go out through JSON Schema rather than through `z.infer`, so that
 * what reaches a client app is a flat declaration file with no dependency on zod
 * at all.
 *
 * The contract goes out through two entry points, because its two readers want
 * opposite things and one file cannot be both:
 *
 *   `@fg2/shared-types/v1`         `v1.d.ts` - the flat interfaces, with no zod
 *                                  anywhere in them. A client app reads JSON and
 *                                  only needs to know its shape.
 *   `@fg2/shared-types/v1-schemas` `v1-schemas/` - the schemas themselves and
 *                                  the runtime tables beside them, compiled from
 *                                  the same sources. The server validates with
 *                                  zod and derives its request bodies from the
 *                                  resource schemas rather than restating them,
 *                                  so it has to import the schema objects; and
 *                                  `METRIC_FIELD` and its siblings are values,
 *                                  which no declaration file can carry.
 *
 * The second is emitted as CommonJS with declarations beside it, because that is
 * what the server compiles to. It is committed like everything else here, so a
 * consumer needs no build of its own.
 *
 * Its declarations name zod's own types, and node resolves a linked package's
 * imports from the link target, so a consumer ends up holding two copies of zod:
 * its own and this package's. That is harmless while they are the same release
 * and miserable when they are not - TypeScript compares zod's recursive
 * internals structurally and gives up with "type instantiation is excessively
 * deep" - so the `zod` dependency here and in the consumer are kept in step.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';
import { z } from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

// Forward slashes, because this one is written into the generated header, which
// is committed and may not differ with the platform it was made on.
const SOURCE = 'src/v1/index.ts';
const TYPES_FILE = 'v1.d.ts';
const OPENAPI_FILE = 'openapi-schemas.json';
const RUNTIME_DIR = 'v1-schemas';

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
      // What the server compiles to.
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

/** The registry in, the declaration file and the `components.schemas` document out. */
const generate = async registry => {
  const { schemas } = z.toJSONSchema(registry, {
    io: 'output',
    // `bytes()` describes itself through `.meta()`; without this, zod refuses a
    // custom type outright.
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
  writeFileSync(join(root, OPENAPI_FILE), `${JSON.stringify(forOpenApi, null, 2)}\n`);

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

  writeFileSync(
    join(root, TYPES_FILE),
    [`// Generated by \`npm run generate\` from ${SOURCE}.`, '// Do not edit: change the schema and regenerate.', '', types, ''].join('\n'),
  );

  console.log(`Generated ${TYPES_FILE} (${Object.keys(schemas).length} types) and ${OPENAPI_FILE}`);
};

await generate(buildRuntime(SOURCE, RUNTIME_DIR));
console.log(`Generated ${RUNTIME_DIR}/ (the runtime half of the contract)`);
