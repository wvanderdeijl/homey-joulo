import { describe, it, expect, vi } from 'vitest';
import {
  JouloClient,
  JouloApiError,
  JouloAuthError,
  JouloCooldownError,
  JouloOfflineError,
  JouloRateLimitError,
  JouloServerError,
  JouloNetworkError,
} from '../lib/joulo-client';
import type { JouloCharger, JouloEnergyResponse, JouloSession } from '../lib/types';

describe('JouloClient', () => {
  const fakeToken = 'joulo_test_token_1234567890';

  describe('constructor and configuration', () => {
    it('initializes with token and default base URL', () => {
      const client = new JouloClient({ token: fakeToken });
      expect(client.getBaseUrl()).toBe('https://api.joulo.nl/functions/v1/api');
    });

    it('allows custom base URL and trims trailing slashes', () => {
      const client = new JouloClient({
        token: fakeToken,
        baseUrl: 'https://custom-api.joulo.nl/v1///',
      });
      expect(client.getBaseUrl()).toBe('https://custom-api.joulo.nl/v1');
    });

    it('throws if token is empty', () => {
      expect(() => new JouloClient({ token: '' })).toThrow(/token/i);
    });
  });

  describe('Authentication & headers', () => {
    it('attaches Bearer token Authorization and Content-Type headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ chargers: [] }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });
      await client.getChargers();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.joulo.nl/functions/v1/api/chargers');
      expect(options.headers).toMatchObject({
        Authorization: `Bearer ${fakeToken}`,
        'Content-Type': 'application/json',
      });
    });
  });

  describe('getChargers()', () => {
    it('returns array of chargers from /chargers', async () => {
      const mockChargers: JouloCharger[] = [
        {
          id: 'charger-uuid-1',
          nickname: 'Garage Wallbox',
          connection_type: 'ocpp',
          status: 'online',
          mid_certified: true,
          is_charging: true,
          current_session: {
            id: 'session-uuid-1',
            started_at: '2026-09-11T12:00:00Z',
            kwh_so_far: 14.5,
            id_tag: 'TAG123',
          },
          latest_meter_wh: 1250000,
          meter_updated_at: '2026-09-11T12:30:00Z',
        },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ chargers: mockChargers }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });
      const result = await client.getChargers();

      expect(result).toEqual(mockChargers);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.joulo.nl/functions/v1/api/chargers',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns empty array if chargers key is empty or missing', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({}),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });
      const result = await client.getChargers();
      expect(result).toEqual([]);
    });
  });

  describe('getSessions()', () => {
    it('returns sessions without query parameters', async () => {
      const mockSessions: JouloSession[] = [
        {
          id: 'sess-1',
          charger_id: 'charger-uuid-1',
          charger_nickname: 'Garage Wallbox',
          started_at: '2026-09-11T08:00:00Z',
          ended_at: '2026-09-11T11:00:00Z',
          kwh: 33.2,
          status: 'completed',
          id_tag: 'TAG123',
          counts_for_ere: true,
          ere_credits: 4.98,
        },
      ];

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ sessions: mockSessions }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });
      const result = await client.getSessions();

      expect(result).toEqual(mockSessions);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.joulo.nl/functions/v1/api/sessions',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('correctly appends query parameters for pagination and filters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ sessions: [] }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });
      await client.getSessions({
        limit: 10,
        offset: 20,
        charger_id: 'c-123',
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      });

      const [calledUrl] = mockFetch.mock.calls[0];
      const parsedUrl = new URL(calledUrl);
      expect(parsedUrl.pathname).toBe('/functions/v1/api/sessions');
      expect(parsedUrl.searchParams.get('limit')).toBe('10');
      expect(parsedUrl.searchParams.get('offset')).toBe('20');
      expect(parsedUrl.searchParams.get('charger_id')).toBe('c-123');
      expect(parsedUrl.searchParams.get('from')).toBe('2026-01-01T00:00:00Z');
      expect(parsedUrl.searchParams.get('to')).toBe('2026-01-31T23:59:59Z');
    });
  });

  describe('getEnergy()', () => {
    it('returns energy aggregates and monthly breakdown', async () => {
      const mockEnergy: JouloEnergyResponse = {
        total_kwh: 2847.52,
        total_ere_credits: 427.13,
        total_sessions: 186,
        total_kwh_all: 3102.18,
        total_sessions_all: 203,
        months: [
          {
            month: '2026-09',
            kwh: 124.3,
            ere_credits: 18.65,
            sessions: 8,
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => mockEnergy,
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });
      const result = await client.getEnergy();

      expect(result).toEqual(mockEnergy);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.joulo.nl/functions/v1/api/energy',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  describe('rebootCharger()', () => {
    it('sends POST /chargers/reboot with Soft type by default', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ confirmed_by_boot: true }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });
      const response = await client.rebootCharger('charger-123');

      expect(response).toEqual({
        success: true,
        status: 200,
        confirmed_by_boot: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.joulo.nl/functions/v1/api/chargers/reboot',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ charger_id: 'charger-123', type: 'Soft' }),
        }),
      );
    });

    it('sends POST /chargers/reboot with Hard type when specified', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ confirmed_by_boot: true }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });
      await client.rebootCharger('charger-123', 'Hard');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.joulo.nl/functions/v1/api/chargers/reboot',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ charger_id: 'charger-123', type: 'Hard' }),
        }),
      );
    });

    it('handles 202 Accepted when command could not be immediately verified', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: async () => ({ message: 'Command dispatched' }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });
      const response = await client.rebootCharger('charger-123', 'Soft');

      expect(response).toEqual({
        success: true,
        status: 202,
        confirmed_by_boot: false,
        message: 'Command dispatched',
      });
    });

    it('throws error if chargerId is empty', async () => {
      const client = new JouloClient({ token: fakeToken });
      await expect(client.rebootCharger('')).rejects.toThrow(/chargerId/i);
    });
  });

  describe('Error handling', () => {
    it('throws JouloAuthError on 401 Unauthorized', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ error: 'Missing or invalid API token' }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });

      await expect(client.getChargers()).rejects.toThrow(JouloAuthError);
      await expect(client.getChargers()).rejects.toThrow('Missing or invalid API token');
    });

    it('throws JouloAuthError on 403 Forbidden with required_scope info', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Insufficient scope', required_scope: 'chargers:read' }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });

      try {
        await client.getChargers();
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(JouloAuthError);
        const authErr = err as JouloAuthError;
        expect(authErr.statusCode).toBe(403);
        expect(authErr.requiredScope).toBe('chargers:read');
      }
    });

    it('throws JouloCooldownError on 409 Conflict', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ error: 'Reboot cooldown active. Please wait 5 minutes.' }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });

      await expect(client.rebootCharger('c-1')).rejects.toThrow(JouloCooldownError);
    });

    it('throws JouloOfflineError on 503 Service Unavailable', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        json: async () => ({ error: 'Charger is offline' }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });

      await expect(client.rebootCharger('c-1')).rejects.toThrow(JouloOfflineError);
    });

    it('throws JouloRateLimitError on 429 Too Many Requests and parses retry-after', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({ 'retry-after': '60' }),
        json: async () => ({ error: 'Rate limit exceeded' }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });

      try {
        await client.getEnergy();
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(JouloRateLimitError);
        expect((err as JouloRateLimitError).statusCode).toBe(429);
        expect((err as JouloRateLimitError).retryAfterSeconds).toBe(60);
      }
    });

    it('throws JouloServerError on HTTP 500 server error', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: 'Internal database error' }),
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });

      await expect(client.getChargers()).rejects.toThrow(JouloServerError);
    });

    it('handles non-JSON error bodies gracefully with JouloServerError', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: 'Bad Gateway',
        json: async () => {
          throw new Error('Not JSON');
        },
        text: async () => '<html>Bad Gateway</html>',
      });

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });

      try {
        await client.getChargers();
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(JouloServerError);
        expect((err as JouloServerError).statusCode).toBe(502);
      }
    });

    it('wraps network fetch failure in JouloNetworkError', async () => {
      const originalErr = new Error('Connection refused');
      const mockFetch = vi.fn().mockRejectedValue(originalErr);

      const client = new JouloClient({ token: fakeToken, fetch: mockFetch as unknown as typeof fetch });

      try {
        await client.getChargers();
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(JouloNetworkError);
        expect(err).toBeInstanceOf(JouloApiError);
        expect((err as JouloNetworkError).causeError).toBe(originalErr);
        expect((err as Error).message).toContain('Connection refused');
      }
    });
  });
});
