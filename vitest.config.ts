import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      exclude: [
        'dist/**',
        'tests/**',
        'eslint.config.js',
        'vitest.config.ts',
        'src/cli/pgm.ts',
        'src/cli/client.ts',
        'src/types/**',
        'src/auth/types.ts',
        'src/index.ts',
        'src/config.ts',
        'src/db/migrate.ts',
        'src/db/pool.ts',
        'src/migrate-talon/index.ts',
        'src/util/audit.ts',
        'src/util/logger.ts'
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    }
  }
});
