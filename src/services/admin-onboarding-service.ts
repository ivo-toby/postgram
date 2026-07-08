import type { Pool, PoolClient } from 'pg';

import { AppError, ErrorCode } from '../util/errors.js';

export const ADMIN_ONBOARDING_STEPS = [
  'setup',
  'provider_config',
  'secrets',
  'validate_apply',
  'backup_restore',
  'maintenance'
] as const;

export type AdminOnboardingStep = (typeof ADMIN_ONBOARDING_STEPS)[number];
export type AdminOnboardingStatus = 'completed' | 'in_progress' | 'skipped';

export type AdminOnboardingState = {
  status: AdminOnboardingStatus;
  currentStep: AdminOnboardingStep;
  completedSteps: AdminOnboardingStep[];
  skippedAt: string | null;
  completedAt: string | null;
  updatedByAdminUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UpdateAdminOnboardingInput = {
  actorAdminUserId: string;
  currentStep?: AdminOnboardingStep | undefined;
  completedSteps?: AdminOnboardingStep[] | undefined;
  now?: Date | undefined;
};

export type OnboardingCompletionInput = {
  actorAdminUserId: string;
  now?: Date | undefined;
};

type AdminOnboardingRow = {
  status: AdminOnboardingStatus;
  current_step: AdminOnboardingStep;
  completed_steps: AdminOnboardingStep[];
  skipped_at: Date | null;
  completed_at: Date | null;
  updated_by_admin_user_id: string | null;
  created_at: Date;
  updated_at: Date;
};

const ONBOARDING_ROW_ID = true;
const STEP_SET = new Set<AdminOnboardingStep>(ADMIN_ONBOARDING_STEPS);

function toAdminOnboardingState(
  row: AdminOnboardingRow
): AdminOnboardingState {
  return {
    status: row.status,
    currentStep: row.current_step,
    completedSteps: row.completed_steps,
    skippedAt: row.skipped_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    updatedByAdminUserId: row.updated_by_admin_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

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

function progressValidationError(
  message: string,
  details: Record<string, unknown>
): AppError {
  return new AppError(ErrorCode.VALIDATION, message, details);
}

function validateCompletedStepPrefix(
  steps: readonly AdminOnboardingStep[]
): AdminOnboardingStep[] {
  const completedSteps: AdminOnboardingStep[] = [];

  for (const [index, step] of steps.entries()) {
    if (!STEP_SET.has(step)) {
      throw new AppError(ErrorCode.VALIDATION, 'Invalid onboarding step', {
        step
      });
    }

    const expectedStep = ADMIN_ONBOARDING_STEPS[index];
    if (step !== expectedStep) {
      throw progressValidationError(
        'Completed onboarding steps must be an ordered prefix',
        {
          completedSteps: steps,
          expectedPrefix: ADMIN_ONBOARDING_STEPS.slice(0, index + 1)
        }
      );
    }

    completedSteps.push(step);
  }

  return completedSteps;
}

function validateInProgressUpdate(input: {
  persistedStatus: AdminOnboardingStatus;
  currentStep: AdminOnboardingStep;
  completedSteps: readonly AdminOnboardingStep[];
}): {
  currentStep: AdminOnboardingStep;
  completedSteps: AdminOnboardingStep[];
} {
  if (input.persistedStatus !== 'in_progress') {
    throw new AppError(
      ErrorCode.CONFLICT,
      'Admin onboarding is not in progress',
      { status: input.persistedStatus }
    );
  }

  const completedSteps = validateCompletedStepPrefix(input.completedSteps);
  const expectedCurrentStep = ADMIN_ONBOARDING_STEPS[completedSteps.length];

  if (!expectedCurrentStep) {
    throw progressValidationError(
      'Use the complete onboarding endpoint to finish onboarding',
      { completedSteps }
    );
  }

  if (input.currentStep !== expectedCurrentStep) {
    throw progressValidationError(
      'Current onboarding step must be the first incomplete step',
      {
        currentStep: input.currentStep,
        expectedCurrentStep,
        completedSteps
      }
    );
  }

  return {
    currentStep: expectedCurrentStep,
    completedSteps
  };
}

async function ensureAdminOnboardingState(
  executor: Pool | PoolClient
): Promise<void> {
  await executor.query(
    `
      INSERT INTO admin_onboarding_state (id)
      VALUES ($1)
      ON CONFLICT (id) DO NOTHING
    `,
    [ONBOARDING_ROW_ID]
  );
}

async function readAdminOnboardingRow(
  executor: Pool | PoolClient
): Promise<AdminOnboardingRow> {
  const result = await executor.query<AdminOnboardingRow>(
    `
      SELECT
        status,
        current_step,
        completed_steps,
        skipped_at,
        completed_at,
        updated_by_admin_user_id,
        created_at,
        updated_at
      FROM admin_onboarding_state
      WHERE id = $1
    `,
    [ONBOARDING_ROW_ID]
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(ErrorCode.INTERNAL, 'Admin onboarding state is missing');
  }
  return row;
}

async function writeAdminOnboardingAudit(
  executor: Pool | PoolClient,
  input: {
    actorAdminUserId: string;
    operation:
      | 'admin.onboarding.complete'
      | 'admin.onboarding.skip'
      | 'admin.onboarding.update';
    details: Record<string, unknown>;
  }
): Promise<void> {
  await executor.query(
    `
      INSERT INTO audit_log (
        api_key_id,
        admin_user_id,
        operation,
        entity_id,
        details
      )
      VALUES (NULL, $1, $2, NULL, $3)
    `,
    [input.actorAdminUserId, input.operation, input.details]
  );
}

async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the original service error.
  }
}

export async function readAdminOnboardingState(
  pool: Pool
): Promise<AdminOnboardingState> {
  try {
    await ensureAdminOnboardingState(pool);
    return toAdminOnboardingState(await readAdminOnboardingRow(pool));
  } catch (error) {
    throw toAppError(error, 'Unable to read admin onboarding state');
  }
}

export async function updateAdminOnboardingState(
  pool: Pool,
  input: UpdateAdminOnboardingInput
): Promise<AdminOnboardingState> {
  const client = await pool.connect();
  const now = input.now ?? new Date();

  try {
    await client.query('BEGIN');
    await ensureAdminOnboardingState(client);
    const before = await readAdminOnboardingRow(client);
    const { currentStep, completedSteps } = validateInProgressUpdate({
      persistedStatus: before.status,
      currentStep: input.currentStep ?? before.current_step,
      completedSteps: input.completedSteps ?? before.completed_steps
    });

    const result = await client.query<AdminOnboardingRow>(
      `
        UPDATE admin_onboarding_state
        SET
          status = 'in_progress',
          current_step = $2,
          completed_steps = $3,
          skipped_at = NULL,
          completed_at = NULL,
          updated_by_admin_user_id = $4,
          updated_at = $5
        WHERE id = $1
        RETURNING
          status,
          current_step,
          completed_steps,
          skipped_at,
          completed_at,
          updated_by_admin_user_id,
          created_at,
          updated_at
      `,
      [
        ONBOARDING_ROW_ID,
        currentStep,
        completedSteps,
        input.actorAdminUserId,
        now
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(
        ErrorCode.INTERNAL,
        'Unable to update admin onboarding state'
      );
    }

    await writeAdminOnboardingAudit(client, {
      actorAdminUserId: input.actorAdminUserId,
      operation: 'admin.onboarding.update',
      details: {
        fromStatus: before.status,
        toStatus: row.status,
        currentStep: row.current_step,
        completedSteps: row.completed_steps
      }
    });

    await client.query('COMMIT');
    return toAdminOnboardingState(row);
  } catch (error) {
    await rollbackQuietly(client);
    throw toAppError(error, 'Unable to update admin onboarding state');
  } finally {
    client.release();
  }
}

export async function skipAdminOnboarding(
  pool: Pool,
  input: OnboardingCompletionInput
): Promise<AdminOnboardingState> {
  const client = await pool.connect();
  const now = input.now ?? new Date();

  try {
    await client.query('BEGIN');
    await ensureAdminOnboardingState(client);
    const before = await readAdminOnboardingRow(client);
    const result = await client.query<AdminOnboardingRow>(
      `
        UPDATE admin_onboarding_state
        SET
          status = 'skipped',
          skipped_at = $2,
          completed_at = NULL,
          updated_by_admin_user_id = $3,
          updated_at = $2
        WHERE id = $1
        RETURNING
          status,
          current_step,
          completed_steps,
          skipped_at,
          completed_at,
          updated_by_admin_user_id,
          created_at,
          updated_at
      `,
      [ONBOARDING_ROW_ID, now, input.actorAdminUserId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(
        ErrorCode.INTERNAL,
        'Unable to skip admin onboarding'
      );
    }

    await writeAdminOnboardingAudit(client, {
      actorAdminUserId: input.actorAdminUserId,
      operation: 'admin.onboarding.skip',
      details: {
        fromStatus: before.status,
        currentStep: row.current_step,
        completedSteps: row.completed_steps
      }
    });

    await client.query('COMMIT');
    return toAdminOnboardingState(row);
  } catch (error) {
    await rollbackQuietly(client);
    throw toAppError(error, 'Unable to skip admin onboarding');
  } finally {
    client.release();
  }
}

export async function completeAdminOnboarding(
  pool: Pool,
  input: OnboardingCompletionInput
): Promise<AdminOnboardingState> {
  const client = await pool.connect();
  const now = input.now ?? new Date();

  try {
    await client.query('BEGIN');
    await ensureAdminOnboardingState(client);
    const before = await readAdminOnboardingRow(client);
    const result = await client.query<AdminOnboardingRow>(
      `
        UPDATE admin_onboarding_state
        SET
          status = 'completed',
          current_step = $2,
          completed_steps = $3,
          skipped_at = NULL,
          completed_at = $4,
          updated_by_admin_user_id = $5,
          updated_at = $4
        WHERE id = $1
        RETURNING
          status,
          current_step,
          completed_steps,
          skipped_at,
          completed_at,
          updated_by_admin_user_id,
          created_at,
          updated_at
      `,
      [
        ONBOARDING_ROW_ID,
        ADMIN_ONBOARDING_STEPS[ADMIN_ONBOARDING_STEPS.length - 1],
        [...ADMIN_ONBOARDING_STEPS],
        now,
        input.actorAdminUserId
      ]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(
        ErrorCode.INTERNAL,
        'Unable to complete admin onboarding'
      );
    }

    await writeAdminOnboardingAudit(client, {
      actorAdminUserId: input.actorAdminUserId,
      operation: 'admin.onboarding.complete',
      details: {
        fromStatus: before.status,
        completedSteps: row.completed_steps
      }
    });

    await client.query('COMMIT');
    return toAdminOnboardingState(row);
  } catch (error) {
    await rollbackQuietly(client);
    throw toAppError(error, 'Unable to complete admin onboarding');
  } finally {
    client.release();
  }
}
