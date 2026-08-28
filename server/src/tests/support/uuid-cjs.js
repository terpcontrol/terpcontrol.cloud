// uuid ships as ES modules only, which the CommonJS test runner cannot load.
// Node has had a UUID generator built in since 14, so tests use that instead of
// transforming the package.
const { randomUUID } = require('crypto');

module.exports = { v4: randomUUID };
