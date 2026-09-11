import type { SupabaseClient } from '@supabase/supabase-js';

export type SquareMaintenanceAlerts = {
  paymentRemediations: number;
  paymentValidations: number;
  connectionMutations: number;
  scanFailed: boolean;
};

function count(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^\d+$/u.test(value) ? Number(value) : value;
  return Number.isSafeInteger(parsed) && Number(parsed) >= 0 ? Number(parsed) : null;
}

/** Read operator-visible queues without exposing provider or database details. */
export async function loadSquareMaintenanceAlerts(
  db: SupabaseClient,
): Promise<SquareMaintenanceAlerts> {
  try {
    const [payments, validations, connections] = await Promise.all([
      db.rpc('count_square_payment_remediation_alerts'),
      db.rpc('count_square_payment_validation_alerts'),
      db.rpc('count_square_connection_mutation_alerts'),
    ]);
    const paymentRemediations = payments.error ? null : count(payments.data);
    const paymentValidations = validations.error ? null : count(validations.data);
    const connectionMutations = connections.error ? null : count(connections.data);
    if (paymentRemediations === null || paymentValidations === null
      || connectionMutations === null) throw new Error('invalid count');
    return { paymentRemediations, paymentValidations, connectionMutations, scanFailed: false };
  } catch {
    return { paymentRemediations: 0, paymentValidations: 0,
      connectionMutations: 0, scanFailed: true };
  }
}
