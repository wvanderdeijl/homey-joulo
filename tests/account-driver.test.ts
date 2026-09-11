import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock homey module
vi.mock('homey', () => {
  class MockDriver {
    log() {}
    error() {}
    async onInit() {}
    async onPair(_session: any) {}
  }

  class MockDevice {
    settings: Record<string, unknown> = {};
    capabilities: Record<string, unknown> = {};
    available = true;
    unavailableReason: string | null = null;
    homey = {
      setInterval: vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms)),
      clearInterval: vi.fn((id: NodeJS.Timeout) => clearTimeout(id)),
      __: vi.fn((key: string) => key),
    };
    log() {}
    error() {}

    getSetting(key: string) {
      return this.settings[key];
    }

    async setCapabilityValue(key: string, value: unknown) {
      this.capabilities[key] = value;
    }

    async setAvailable() {
      this.available = true;
      this.unavailableReason = null;
    }

    async setUnavailable(reason?: string) {
      this.available = false;
      this.unavailableReason = reason ?? null;
    }
  }

  return {
    default: {
      Driver: MockDriver,
      Device: MockDevice,
    },
  };
});

// Import driver and device after mocking homey
import AccountDriver from '../drivers/account/driver';
import AccountDevice from '../drivers/account/device';
import { calculateEstimatedEarnings } from '../lib/joulo-client';

describe('Account Driver & Custom Capabilities Configuration', () => {
  it('should define ere_credits custom capability correctly', () => {
    const filePath = path.join(__dirname, '../.homeycompose/capabilities/ere_credits.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const cap = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    expect(cap.type).toBe('number');
    expect(cap.title.en).toBe('ERE Credits');
    expect(cap.title.nl).toBe('ERE-credits');
    expect(cap.units).toBe('ERE');
    expect(cap.decimals).toBe(2);
    expect(cap.getable).toBe(true);
    expect(cap.setable).toBe(false);
  });

  it('should define ere_earnings custom capability correctly', () => {
    const filePath = path.join(__dirname, '../.homeycompose/capabilities/ere_earnings.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const cap = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    expect(cap.type).toBe('number');
    expect(cap.title.en).toBe('Estimated ERE Earnings');
    expect(cap.units).toBe('€');
    expect(cap.decimals).toBe(2);
    expect(cap.getable).toBe(true);
    expect(cap.setable).toBe(false);
  });

  it('should configure account driver manifest with pairing wizard and capabilities', () => {
    const filePath = path.join(__dirname, '../drivers/account/driver.compose.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    expect(manifest.class).toBe('other');
    expect(manifest.capabilities).toContain('meter_power');
    expect(manifest.capabilities).toContain('ere_credits');
    expect(manifest.capabilities).toContain('ere_earnings');

    expect(manifest.pair).toEqual([
      { id: 'enter_token', navigation: { next: 'list_devices' } },
      { id: 'list_devices', template: 'list_devices', navigation: { next: 'add_devices' } },
      { id: 'add_devices', template: 'add_devices' },
    ]);
  });

  it('should configure driver settings with token and poll_interval without extra UI complexity', () => {
    const filePath = path.join(__dirname, '../drivers/account/driver.settings.compose.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const tokenSetting = settings.find((s: { id: string }) => s.id === 'token');
    const pollSetting = settings.find((s: { id: string }) => s.id === 'poll_interval');
    const priceSetting = settings.find((s: { id: string }) => s.id === 'ere_price_per_credit');

    expect(tokenSetting).toBeDefined();
    expect(tokenSetting.type).toBe('password');
    expect(pollSetting).toBeDefined();
    expect(pollSetting.type).toBe('number');
    expect(priceSetting).toBeUndefined(); // Kept simple as requested by user
  });

  it('should have enter_token.html pair view template with required instructions', () => {
    const htmlPath = path.join(__dirname, '../drivers/account/pair/enter_token.html');
    expect(fs.existsSync(htmlPath)).toBe(true);
    const html = fs.readFileSync(htmlPath, 'utf8');

    expect(html).toContain('joulo.nl/dashboard');
    expect(html).toContain('validate_token');
    expect(html).toContain('onHomeyReady');
  });
});

describe('AccountDriver Pairing Logic', () => {
  let driver: AccountDriver;

  beforeEach(() => {
    driver = new AccountDriver();
  });

  it('should register handlers and validate token successfully with mock API', async () => {
    const handlers: Record<string, (data?: any) => Promise<any>> = {};
    const mockSession = {
      setHandler: vi.fn((event: string, handler: (data?: any) => Promise<any>) => {
        handlers[event] = handler;
        return mockSession;
      }),
    };

    // Mock global fetch for token validation (energy endpoint)
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/energy')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ total_kwh: 500, total_ere_credits: 166 }),
        });
      }
      if (url.includes('/chargers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            chargers: [
              {
                id: 'ch-1',
                nickname: 'Front Charger',
                status: 'active',
              },
            ],
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    await driver.onPair(mockSession as any);

    expect(handlers['validate_token']).toBeDefined();
    expect(handlers['list_devices']).toBeDefined();

    // Empty token should fail
    await expect(handlers['validate_token']!({ token: '   ' })).rejects.toThrow(
      'Please enter a valid personal Bearer token',
    );

    // Valid token should succeed
    const valid = await handlers['validate_token']!({ token: 'test-token-123' });
    expect(valid).toBe(true);

    // List devices should return account device and discovered chargers
    const devices = await handlers['list_devices']!();
    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({
      name: 'Joulo Account',
      data: { id: 'joulo-account' },
      settings: { token: 'test-token-123' },
    });
    expect(devices[1]).toEqual({
      name: 'Front Charger',
      data: { id: 'ch-1' },
      settings: { token: 'test-token-123' },
    });

    vi.unstubAllGlobals();
  });

  it('should reject invalid token on validate_token with 401', async () => {
    const handlers: Record<string, (data?: any) => Promise<any>> = {};
    const mockSession = {
      setHandler: vi.fn((event: string, handler: (data?: any) => Promise<any>) => {
        handlers[event] = handler;
        return mockSession;
      }),
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Unauthorized' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await driver.onPair(mockSession as any);
    await expect(handlers['validate_token']!({ token: 'bad-token' })).rejects.toThrow();

    vi.unstubAllGlobals();
  });
});

describe('AccountDevice Lifecycle and Metric Synchronization', () => {
  let device: AccountDevice;

  beforeEach(() => {
    device = new AccountDevice();
  });

  it('should set unavailable if token is missing on init', async () => {
    (device as any).settings = {};
    await device.onInit();
    expect(device.available).toBe(false);
    expect(device.unavailableReason).toContain('API Bearer token is required');
  });

  it('should synchronize meter_power, ere_credits, and ere_earnings when token is valid', async () => {
    (device as any).settings = {
      token: 'valid-test-token',
      poll_interval: 300,
    };

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/energy')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            total_kwh: 500.12,
            total_ere_credits: 166.39,
          }),
        });
      }
      if (url.includes('/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            sessions: [],
            estimate_basis: {
              price_per_ere: 0.451,
              effective_fee_pct: 20, // net price: 0.451 * 0.8 = 0.3608
            },
          }),
        });
      }
      return Promise.reject(new Error('Unknown url'));
    });
    vi.stubGlobal('fetch', mockFetch);

    await device.onInit();

    expect(device.available).toBe(true);
    expect(device.capabilities['meter_power']).toBe(500.12);
    expect(device.capabilities['ere_credits']).toBe(166.39);
    // 166.39 * (0.451 * 0.8) = 166.39 * 0.3608 = 60.0335 -> 60.03
    expect(device.capabilities['ere_earnings']).toBe(60.03);

    vi.unstubAllGlobals();
  });

  it('should mark device unavailable on Joulo authentication failure', async () => {
    (device as any).settings = {
      token: 'expired-token',
    };

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Unauthorized' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await device.onInit();
    expect(device.available).toBe(false);
    expect(device.unavailableReason).toContain('Invalid or expired Bearer token');

    vi.unstubAllGlobals();
  });

  it('should update client and resync when token changes in onSettings', async () => {
    (device as any).settings = { token: 'old-token' };
    const syncSpy = vi.spyOn(device, 'syncAccountData').mockResolvedValue(undefined);

    await device.onSettings({
      oldSettings: { token: 'old-token' },
      newSettings: { token: 'new-token' },
      changedKeys: ['token'],
    });

    expect(syncSpy).toHaveBeenCalled();
  });

  it('should tolerate transient network/server failures and only mark unavailable after 3 consecutive failures', async () => {
    (device as any).settings = { token: 'valid-token' };
    const mockFetch = vi.fn().mockImplementation(async () => {
      return {
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Internal Server Error' }),
      };
    });
    vi.stubGlobal('fetch', mockFetch);

    // Initialize device and client
    await device.onInit();
    expect(device.available).toBe(true);

    // Failure 1: occurred on onInit sync. Should remain available.
    // Failure 2: sync again, should remain available
    await device.syncAccountData();
    expect(device.available).toBe(true);

    // Failure 3: threshold reached, should be marked unavailable
    await device.syncAccountData();
    expect(device.available).toBe(false);

    // Recovery on success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ total_kwh: 100, total_ere_credits: 20, total_sessions: 5 }),
    });
    await device.syncAccountData();
    expect(device.available).toBe(true);

    vi.unstubAllGlobals();
  });

  it('should clear interval timers on deleted', async () => {
    (device as any).pollTimer = setTimeout(() => {}, 10000);
    await device.onDeleted();
    expect((device as any).pollTimer).toBeNull();
  });
});

describe('calculateEstimatedEarnings helper', () => {
  it('calculates correct net earnings given gross price and fee percentage', () => {
    const basis = { price_per_ere: 0.20, effective_fee_pct: 10 };
    // 100 credits * (0.20 * (1 - 0.10)) = 100 * 0.18 = 18.00
    expect(calculateEstimatedEarnings(100, basis)).toBe(18);
  });

  it('returns 0 when basis is undefined or price is missing', () => {
    expect(calculateEstimatedEarnings(100, undefined)).toBe(0);
    expect(calculateEstimatedEarnings(100, {})).toBe(0);
  });
});

