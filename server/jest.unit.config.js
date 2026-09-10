/**
 * Unit suite. Loads services directly, for behaviour the black-box suite cannot
 * reach over HTTP. See test/README.md.
 *
 * NestJS 12 ships ESM only, so a service cannot be required from jest's
 * CommonJS runtime - it dies on `import` in @nestjs/common. This project runs
 * the specs as ESM instead, which needs `--experimental-vm-modules` on the node
 * that runs jest (`npm run test:unit` sets it) and `jest.unstable_mockModule`
 * rather than `jest.mock`, because an ES module is linked before the spec body
 * runs and can only be replaced ahead of a dynamic import.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/unit'],
  testMatch: ['**/*.spec.ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.unit.json' }],
  },
  moduleNameMapper: {
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@config/(.*)$': '<rootDir>/src/config/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/unit/setup.ts'],
  testTimeout: 30_000,
};
