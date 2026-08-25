// The application reads its configuration at import time, and the developer's
// own .env is not checked in — so a clean checkout has to be able to run the
// suite. These are defaults, not overrides: a value already in the environment
// (or in a local .env) wins.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.LOG_DIR = process.env.LOG_DIR || './logs';
process.env.LOG_FORMAT = process.env.LOG_FORMAT || 'disabled';
process.env.SECRET_KEY = process.env.SECRET_KEY || 'test-secret';
