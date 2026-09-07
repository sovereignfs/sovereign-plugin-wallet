'use server';

import { sdk } from '@sovereignfs/sdk';
import type { E2eeDeviceEnrollment, E2eeProfile } from '@sovereignfs/sdk';

export interface E2eeStatus {
  profile: E2eeProfile | null;
  devices: E2eeDeviceEnrollment[];
}

/**
 * The current user's client-side encryption profile + device enrollments
 * (RFC 0060).
 *
 * `sdk.e2ee` resolves its own context from the request's
 * `x-sovereign-user-id` header and throws `NotAuthenticatedError` without
 * one, so this is already session-scoped. The explicit `requireSession()` is
 * the plugin-side half of the repo rule that every server action authorizes
 * inside the action — a `'use server'` export is a public POST endpoint
 * regardless of which page renders it.
 */
export async function getE2eeStatus(): Promise<E2eeStatus> {
  await sdk.auth.requireSession();
  const [profile, devices] = await Promise.all([sdk.e2ee.getProfile(), sdk.e2ee.listDevices()]);
  return { profile, devices };
}
