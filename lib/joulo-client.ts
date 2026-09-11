import type {
  JouloCharger,
  JouloChargersResponse,
  JouloSession,
  JouloSessionsResponse,
  JouloListSessionsOptions,
  JouloEnergyResponse,
  JouloRebootResponse,
  JouloRebootType,
  JouloErrorResponse,
} from './types';

export const DEFAULT_JOULO_API_BASE_URL = 'https://api.joulo.nl/functions/v1/api';

/**
 * Base error class for all Joulo API errors.
 */
export class JouloApiError extends Error {
  public readonly statusCode?: number | undefined;
  public readonly endpoint?: string | undefined;
  public readonly responseBody?: unknown;

  constructor(message: string, statusCode?: number | undefined, endpoint?: string | undefined, responseBody?: unknown) {
    super(message);
    this.name = 'JouloApiError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

/**
 * Thrown when network transport fails (DNS failure, connection refused, offline host, timeout).
 */
export class JouloNetworkError extends JouloApiError {
  public readonly causeError?: Error | undefined;

  constructor(message: string, endpoint?: string | undefined, causeError?: Error | undefined) {
    super(message, undefined, endpoint);
    this.name = 'JouloNetworkError';
    this.causeError = causeError;
  }
}

/**
 * Thrown when the Joulo upstream server encounters an internal error (HTTP 5xx, except 503).
 */
export class JouloServerError extends JouloApiError {
  constructor(message: string, statusCode: number = 500, endpoint?: string | undefined, responseBody?: unknown) {
    super(message, statusCode, endpoint, responseBody);
    this.name = 'JouloServerError';
  }
}

/**
 * Thrown when an authentication or authorization failure occurs (HTTP 401 or 403).
 */
export class JouloAuthError extends JouloApiError {
  public readonly requiredScope?: string | undefined;

  constructor(
    message: string,
    statusCode: number,
    endpoint?: string | undefined,
    requiredScope?: string | undefined,
    responseBody?: unknown,
  ) {
    super(message, statusCode, endpoint, responseBody);
    this.name = 'JouloAuthError';
    this.requiredScope = requiredScope;
  }
}

/**
 * Thrown when an action cannot be performed because of an active cooldown period (HTTP 409).
 * For instance, a 5-minute cooldown between charger reboots.
 */
export class JouloCooldownError extends JouloApiError {
  constructor(message: string, endpoint?: string | undefined, responseBody?: unknown) {
    super(message, 409, endpoint, responseBody);
    this.name = 'JouloCooldownError';
  }
}

/**
 * Thrown when the charger or service is offline / unavailable (HTTP 503).
 */
export class JouloOfflineError extends JouloApiError {
  constructor(message: string, statusCode: number = 503, endpoint?: string | undefined, responseBody?: unknown) {
    super(message, statusCode, endpoint, responseBody);
    this.name = 'JouloOfflineError';
  }
}

/**
 * Thrown when API rate limits are exceeded (HTTP 429).
 */
export class JouloRateLimitError extends JouloApiError {
  public readonly retryAfterSeconds?: number | undefined;

  constructor(message: string, retryAfterSeconds?: number | undefined, endpoint?: string | undefined, responseBody?: unknown) {
    super(message, 429, endpoint, responseBody);
    this.name = 'JouloRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface JouloClientOptions {
  token: string;
  baseUrl?: string | undefined;
  fetch?: typeof fetch | undefined;
}

/**
 * Typed client for the Joulo REST API.
 */
export class JouloClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: JouloClientOptions) {
    if (!options.token || typeof options.token !== 'string' || options.token.trim() === '') {
      throw new Error('A valid Joulo API Bearer token is required');
    }

    this.token = options.token.trim();
    this.baseUrl = (options.baseUrl || DEFAULT_JOULO_API_BASE_URL).replace(/\/+$/, '');
    this.fetchFn = options.fetch || globalThis.fetch;
  }

  /**
   * Get configured base URL without trailing slash.
   */
  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Fetches all chargers associated with the account.
   */
  public async getChargers(): Promise<JouloCharger[]> {
    const data = await this.request<JouloChargersResponse>('/chargers', {
      method: 'GET',
    });
    return data?.chargers ?? [];
  }

  /**
   * Fetches charging sessions with optional pagination and filters.
   */
  public async getSessions(options?: JouloListSessionsOptions): Promise<JouloSession[]> {
    const query = new URLSearchParams();

    if (options?.limit !== undefined) {
      query.set('limit', String(options.limit));
    }
    if (options?.offset !== undefined) {
      query.set('offset', String(options.offset));
    }
    if (options?.charger_id) {
      query.set('charger_id', options.charger_id);
    }
    if (options?.from) {
      query.set('from', options.from);
    }
    if (options?.to) {
      query.set('to', options.to);
    }

    const queryString = query.toString();
    const path = queryString ? `/sessions?${queryString}` : '/sessions';

    const data = await this.request<JouloSessionsResponse>(path, {
      method: 'GET',
    });

    return data?.sessions ?? [];
  }

  /**
   * Fetches lifetime energy aggregates and monthly breakdown.
   */
  public async getEnergy(): Promise<JouloEnergyResponse> {
    return this.request<JouloEnergyResponse>('/energy', {
      method: 'GET',
    });
  }

  /**
   * Sends an OCPP reset/reboot command to the specified charger.
   *
   * @param chargerId Charger unique identifier UUID
   * @param type Optional reboot type ('Soft' | 'Hard'), defaults to 'Soft'
   */
  public async rebootCharger(
    chargerId: string,
    type: JouloRebootType = 'Soft',
  ): Promise<JouloRebootResponse> {
    if (!chargerId || typeof chargerId !== 'string') {
      throw new Error('A valid chargerId is required to reboot a charger');
    }

    const body = {
      charger_id: chargerId,
      type,
    };

    const result = await this.requestRaw('/chargers/reboot', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    return {
      success: true,
      status: result.status as 200 | 202,
      confirmed_by_boot: Boolean((result.data as { confirmed_by_boot?: boolean })?.confirmed_by_boot),
      message: (result.data as { message?: string })?.message,
    };
  }

  /**
   * Internal request helper returning parsed data.
   */
  private async request<T>(endpoint: string, init?: RequestInit): Promise<T> {
    const result = await this.requestRaw(endpoint, init);
    return result.data as T;
  }

  /**
   * Internal request execution with unified error mapping.
   */
  private async requestRaw(
    endpoint: string,
    init?: RequestInit,
  ): Promise<{ status: number; data: unknown }> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      ...((init?.headers as Record<string, string>) || {}),
    };

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        ...init,
        headers,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const causeError = err instanceof Error ? err : undefined;
      throw new JouloNetworkError(`Network error while fetching ${endpoint}: ${message}`, endpoint, causeError);
    }

    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch {
      try {
        parsedBody = await response.text();
      } catch {
        parsedBody = null;
      }
    }

    if (response.ok) {
      return { status: response.status, data: parsedBody };
    }

    // Error handling
    const errorPayload = typeof parsedBody === 'object' && parsedBody !== null
      ? (parsedBody as JouloErrorResponse)
      : undefined;

    const errorMessage =
      errorPayload?.error ||
      errorPayload?.message ||
      (typeof parsedBody === 'string' && parsedBody.length < 200 ? parsedBody : '') ||
      response.statusText ||
      `HTTP ${response.status}`;

    if (response.status === 401) {
      throw new JouloAuthError(errorMessage, 401, endpoint, undefined, parsedBody);
    }

    if (response.status === 403) {
      throw new JouloAuthError(errorMessage, 403, endpoint, errorPayload?.required_scope, parsedBody);
    }

    if (response.status === 409) {
      throw new JouloCooldownError(errorMessage, endpoint, parsedBody);
    }

    if (response.status === 429) {
      const retryAfterHeader = response.headers.get('retry-after');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
      throw new JouloRateLimitError(errorMessage, retryAfterSeconds, endpoint, parsedBody);
    }

    if (response.status === 503) {
      throw new JouloOfflineError(errorMessage, 503, endpoint, parsedBody);
    }

    if (response.status >= 500 && response.status < 600) {
      throw new JouloServerError(errorMessage, response.status, endpoint, parsedBody);
    }

    throw new JouloApiError(
      `Joulo API error (${response.status}): ${errorMessage}`,
      response.status,
      endpoint,
      parsedBody,
    );
  }
}
