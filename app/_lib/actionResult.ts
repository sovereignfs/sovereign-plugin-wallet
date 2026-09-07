/**
 * The one result shape every Wallet server action returns.
 *
 * A `'use server'` function that *throws* reaches the client as Next's opaque
 * error digest in production and replaces the whole page with `error.tsx` —
 * the actual reason ("Display name is required") is lost. Expected failures
 * return a result instead; only genuine bugs and authorization violations
 * throw. Mirrors `plugins/console/app/_lib/action-result.ts`.
 *
 * Wallet's create/delete actions deliberately do **not** call `redirect()`.
 * The encrypted flows must encrypt client-side before invoking the action, so
 * they call it imperatively rather than through `<form action>`; a thrown
 * `NEXT_REDIRECT` would then have to be distinguished from a real failure at
 * every call site. Returning the new id and letting the client navigate keeps
 * one uniform success/failure channel.
 */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** A create action's result — carries the new row's id for the client to navigate to. */
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

export const ACTION_OK: ActionResult = { ok: true };

export function actionError(error: unknown, fallback = 'Something went wrong.'): {
  ok: false;
  error: string;
} {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return { ok: false, error: message || fallback };
}

/**
 * Run `fn`, converting any throw into `{ ok: false }`. Wrap the *body* of an
 * action with it so an unexpected failure (storage backend down, a guard that
 * throws) still comes back as a message instead of an error digest.
 */
export async function guarded<T extends { ok: boolean }>(
  fn: () => Promise<T>,
  fallback?: string,
): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (error) {
    return actionError(error, fallback);
  }
}
