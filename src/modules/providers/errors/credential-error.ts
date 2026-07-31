import { NotFoundException, UnauthorizedException } from '@nestjs/common';

/**
 * A provider credential is absent (or unreadable) so the call never reached the
 * provider API. Distinct from any API failure: a list that cannot authenticate
 * has no result at all, and must never degrade to an empty list — "no servers"
 * and "we never asked" are different answers.
 */
export class CredentialUnavailableError extends NotFoundException {
  readonly isCredentialError = true;

  constructor(
    message: string,
    readonly provider?: string,
  ) {
    super(message);
    this.name = 'CredentialUnavailableError';
  }
}

/**
 * The credential was there and the provider refused it: revoked, mistyped, or
 * issued for another account. The call was answered and the answer was "not
 * you", so an empty list is just as wrong here as for an absent credential.
 */
export class CredentialRejectedError extends UnauthorizedException {
  readonly isCredentialError = true;
  readonly credentialRejected = true;

  constructor(
    message: string,
    readonly provider?: string,
  ) {
    super(message);
    this.name = 'CredentialRejectedError';
  }
}

/** Duck-typed as well as nominal: a duplicated copy of this package in a
 * consumer's tree would defeat `instanceof` and silently restore the bug. */
export function isCredentialError(
  error: unknown,
): error is CredentialUnavailableError | CredentialRejectedError {
  if (
    error instanceof CredentialUnavailableError ||
    error instanceof CredentialRejectedError
  ) {
    return true;
  }
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isCredentialError?: unknown }).isCredentialError === true
  );
}

/**
 * The consumer's credential store is sealed: the call never reached the provider
 * because nothing could be read without the user unlocking it first.
 *
 * Deliberately a THIRD state beside absent and refused, and deliberately NOT
 * folded into `isCredentialError`: its remedy is "unlock what you already have",
 * not "configure a credential" or "issue a new one", and a consumer that maps
 * credential errors to one status/exit code must be able to keep answering
 * something else here (vops answers HTTP 423 Locked).
 *
 * Duck-typed on a marker the consumer sets — this layer has no vault of its own,
 * and the error must arrive at the top of the consumer's stack as the consumer's
 * own class, so `instanceof` still works there.
 */
export function isCredentialStoreLocked(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { credentialStoreLocked?: unknown }).credentialStoreLocked === true
  );
}

/** "Present but refused", as opposed to "never configured" — a different remedy. */
export function isCredentialRejected(error: unknown): boolean {
  if (error instanceof CredentialRejectedError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { credentialRejected?: unknown }).credentialRejected === true
  );
}

/**
 * HTTP 401 out of any shape the provider clients throw: axios nests it under
 * `response`, a fetch-based client carries a bare `status`.
 *
 * 403 is deliberately excluded. Providers reuse it for quota and per-resource
 * permission — OVH ships security-group quota 0, Hetzner answers 403 for
 * `resource_limit_exceeded` — so "forbidden" cannot be read as "this credential
 * is wrong" without mislabelling a working credential that hit a limit. 401 has
 * one meaning: the provider did not accept who you are.
 */
function isUnauthorizedResponse(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as {
    response?: { status?: unknown } | null;
    status?: unknown;
    statusCode?: unknown;
  };
  return [e.response?.status, e.status, e.statusCode].includes(401);
}

/** The provider's own wording ("the token you have provided is invalid") beats ours. */
function rejectionDetail(error: unknown): string {
  const e = error as {
    response?: { data?: { error?: { message?: unknown } } | null } | null;
    message?: unknown;
  };
  const api = e?.response?.data?.error?.message;
  if (typeof api === 'string' && api) return api;
  return typeof e?.message === 'string' && e.message
    ? e.message
    : 'HTTP 401 Unauthorized';
}

/**
 * Guard for the degrade-to-empty catch blocks on read paths: rethrow anything
 * that means we never got an answer *about the credential*, swallow the rest.
 *
 * Covers all three halves of the condition. A credential that is absent arrives
 * as `CredentialUnavailableError`; one that is present and refused arrives as the
 * provider's raw 401, which nothing downstream could recognise — so it is
 * converted here, at the one place every read path already funnels through. A
 * sealed credential store arrives as the consumer's own error and is rethrown
 * **untouched**: re-wrapping it would cost the consumer the one thing it needs
 * (the type) and mislabel "unlock the vault" as "the credential is wrong".
 */
export function rethrowIfCredentialError(
  error: unknown,
  provider?: string,
): void {
  if (isCredentialStoreLocked(error)) throw error;
  if (isCredentialError(error)) throw error;
  if (isUnauthorizedResponse(error)) {
    const where = provider ? ` for ${provider}` : '';
    throw new CredentialRejectedError(
      `The credential${where} was refused by the provider: ${rejectionDetail(error)}. ` +
        'Nothing was listed — this is not an empty account.',
      provider,
    );
  }
}

/**
 * Same guard for a fan-out read (one call per zone/region) whose per-call
 * failures are dropped rather than caught: if *nothing* answered and a failure
 * was about the credential, the empty result means "we never got an answer".
 * One zone answering proves the credential works, so a partially reachable
 * credential still degrades quietly instead of failing the whole list.
 */
export function rethrowIfCredentialsBlockedAll(
  results: readonly PromiseSettledResult<unknown>[],
  provider?: string,
): void {
  if (!results.length) return;
  if (results.some((r) => r.status === 'fulfilled')) return;
  for (const r of results) {
    if (r.status === 'rejected') rethrowIfCredentialError(r.reason, provider);
  }
}
