import { Module } from '@nestjs/common';
import { MigrationRunner } from './migration-runner';

/**
 * The migrations need the database connection and nothing else - no model, no
 * feature module - which is what lets `main.ts` run them between building the
 * application and letting it serve, and what lets the command-line entry point
 * run the very same code against a connection of its own.
 */
@Module({ providers: [MigrationRunner], exports: [MigrationRunner] })
export class MigrationsModule {}
