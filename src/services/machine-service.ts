// Machine listing and connect target updates (spec 004, rest.md
// "GET /api/machines" and "PUT /api/machines/:alias").
//
// Machines are created only by workspace reports; this module never inserts
// or renames one (D5: no visibility, no audit).
import { ResultAsync } from 'neverthrow';
import type { Pool } from 'pg';

import { requireScope } from '../auth/key-service.js';
import type { AuthContext } from '../auth/types.js';
import type { ServiceResult } from '../types/common.js';
import type { MachineRow } from '../types/workspaces.js';
import { AppError, ErrorCode } from '../util/errors.js';

export type MachineSummary = {
  alias: string;
  hostname: string;
  connect_target: string | null;
  last_seen_at: string;
};

const CONNECT_TARGET_REGEX = /^[A-Za-z0-9._@:-]{1,255}$/;

const MACHINE_COLUMNS =
  'id, alias, hostname, connect_target, boot_id, last_seen_at, created_at, updated_at';

function toAppError(error: unknown, fallbackMessage: string): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError(ErrorCode.INTERNAL, fallbackMessage, {
      cause: error.message
    });
  }

  return new AppError(ErrorCode.INTERNAL, fallbackMessage);
}

function toSummary(row: MachineRow): MachineSummary {
  return {
    alias: row.alias,
    hostname: row.hostname,
    connect_target: row.connect_target,
    last_seen_at: row.last_seen_at.toISOString()
  };
}

/**
 * `GET /api/machines`: read scope required. Returns all machines with
 * alias, hostname, connect_target and an ISO last_seen_at, sorted by alias.
 */
export function listMachines(
  pool: Pool,
  auth: AuthContext
): ServiceResult<MachineSummary[]> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'read');

      const result = await pool.query<MachineRow>(
        `SELECT ${MACHINE_COLUMNS} FROM machines ORDER BY alias ASC`
      );
      return result.rows.map(toSummary);
    })(),
    (error) => toAppError(error, 'Failed to list machines')
  );
}

/**
 * `PUT /api/machines/:alias`: write scope required. A string value must
 * match `^[A-Za-z0-9._@:-]{1,255}$` (else VALIDATION); `null` clears it.
 * An unknown alias is NOT_FOUND; no machine is created or renamed.
 * No audit row (D5).
 */
export function setMachineConnectTarget(
  pool: Pool,
  auth: AuthContext,
  input: { alias: string; connectTarget: string | null }
): ServiceResult<MachineSummary> {
  return ResultAsync.fromPromise(
    (async () => {
      requireScope(auth, 'write');

      if (
        input.connectTarget !== null &&
        !CONNECT_TARGET_REGEX.test(input.connectTarget)
      ) {
        throw new AppError(
          ErrorCode.VALIDATION,
          'connect_target must match ^[A-Za-z0-9._@:-]{1,255}$'
        );
      }

      const result = await pool.query<MachineRow>(
        `UPDATE machines
            SET connect_target = $1,
                updated_at = now()
          WHERE alias = $2
          RETURNING ${MACHINE_COLUMNS}`,
        [input.connectTarget, input.alias]
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new AppError(
          ErrorCode.NOT_FOUND,
          `Machine '${input.alias}' not found`
        );
      }
      return toSummary(row);
    })(),
    (error) => toAppError(error, 'Failed to set machine connect target')
  );
}
