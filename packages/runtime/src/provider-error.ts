import { BackendError } from '@banh-dev/dsl';
import type { ProviderDiagnostics } from './system-one-backend.js';

export type ProviderErrorCode = 'PROVIDER_UNAVAILABLE' | 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAUTHORIZED'
  | 'PROVIDER_BAD_REQUEST' | 'PROVIDER_RESPONSE_INVALID' | 'PROVIDER_INTERNAL_ERROR' | 'PROVIDER_CANCELLED';
const messages: Record<ProviderErrorCode, string> = {
  PROVIDER_UNAVAILABLE: 'Model provider is unavailable',
  PROVIDER_TIMEOUT: 'Model provider request timed out',
  PROVIDER_UNAUTHORIZED: 'Model provider authentication failed',
  PROVIDER_BAD_REQUEST: 'Model provider rejected the request',
  PROVIDER_RESPONSE_INVALID: 'Model provider returned an invalid response',
  PROVIDER_INTERNAL_ERROR: 'Model provider execution failed',
  PROVIDER_CANCELLED: 'Model provider request was cancelled',
};
/** Safe diagnostics only: never attach upstream bodies, URLs, credentials, or causes. */
export class ProviderError extends BackendError {
  constructor(public readonly code: ProviderErrorCode, public readonly diagnostics: ProviderDiagnostics) {
    super(messages[code]);
  }
}
