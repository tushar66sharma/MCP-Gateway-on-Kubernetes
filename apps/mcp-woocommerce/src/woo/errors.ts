/** A failed WooCommerce REST call. Messages never contain credentials or signed URLs. */
export class WooApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = 'WooApiError';
  }
}
