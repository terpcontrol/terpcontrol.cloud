/**
 * `@fg2/shared-types/v1` carries types and nothing else - `v1.d.ts` beside this
 * is flat interfaces, and there is no value in it to import.
 *
 * A transpiler that compiles one file at a time cannot always tell that, and
 * NestJS makes sure of it: `emitDecoratorMetadata` writes the parameter types of
 * every decorated handler into the output, so the import a controller makes for
 * `Device` survives into the JavaScript and is required at boot. Without this
 * file node refuses the subpath and the server does not start.
 *
 * So: an empty module, on purpose. Anything that reads a property off it has
 * imported a type as though it were a value.
 */
module.exports = {};
