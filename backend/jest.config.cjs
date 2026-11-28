/** @type {import('jest').Config} */
module.exports = {
  testTimeout: 30000,
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts', '!src/server.ts', '!src/**/*.repository.ts', '!src/core/database/**'],
  coverageThreshold: { global: { statements: 70, branches: 60, functions: 70, lines: 70 } },
};
