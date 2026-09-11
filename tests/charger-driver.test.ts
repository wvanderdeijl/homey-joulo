import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock homey module
vi.mock('homey', () => {
  class MockDriver {
    homey: any = {};
    log() {}
    error() {}
    async onInit() {}
    async onPair(_session: any) {}
  }

  class MockDevice {
    settings: Record<string, unknown> = {};
    capabilities: Record<string, unknown> = {};
    data: Record<string, unknown> = { id: 'test-charger-id' };
    available = true;
    unavailableReason: string | null = null;
    homey: any = {
      app: {},
      setInterval: vi.fn((fn: () => void, ms: number) => setTimeout(fn, ms)),
      clearInterval: vi.fn((id: NodeJS.Timeout) => clearTimeout(id)),
      __: vi.fn((key: string) => key),
    };

    log() {}
    error() {}

    getData() {
      return this.data;
    }

    getName() {
      return 'Test Peblar Charger';
    }

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
import ChargerDriver from '../drivers/charger/driver';
import ChargerDevice from '../drivers/charger/device';
import type { JouloCharger } from '../lib/types';

describe('Charger Driver & Capabilities Manifest Configuration', () => {
  it('should define meter_session_kwh custom capability correctly', () => {
    const filePath = path.join(__dirname, '../.homeycompose/capabilities/meter_session_kwh.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const cap = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    expect(cap.type).toBe('number');
    expect(cap.title.en).toBe('Session Energy');
    expect(cap.title.nl).toBe('Sessie-energie');
    expect(cap.units).toBe('kWh');
    expect(cap.decimals).toBe(2);
    expect(cap.getable).toBe(true);
    expect(cap.setable).toBe(false);
  });

  it('should configure charger driver manifest with class evcharger and capabilities', () => {
    const filePath = path.join(__dirname, '../drivers/charger/driver.compose.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const manifest = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    expect(manifest.class).toBe('evcharger');
    expect(manifest.energy?.evCharger).toBe(true);
    expect(manifest.capabilities).toContain('measure_power');
    expect(manifest.capabilities).toContain('meter_power');
    expect(manifest.capabilities).toContain('evcharger_charging');
    expect(manifest.capabilities).toContain('meter_session_kwh');
  });

  it('should configure adaptive polling interval settings in driver.settings.compose.json', () => {
    const filePath = path.join(__dirname, '../drivers/charger/driver.settings.compose.json');
    expect(fs.existsSync(filePath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    const activeSetting = settings.find((s: any) => s.id === 'poll_interval_active');
    const idleSetting = settings.find((s: any) => s.id === 'poll_interval_idle');

    expect(activeSetting).toBeDefined();
    expect(activeSetting.value).toBe(60);
    expect(idleSetting).toBeDefined();
    expect(idleSetting.value).toBe(300);
  });
});

describe('ChargerDriver Pairing Flow', () => {
  let driver: ChargerDriver;

  beforeEach(() => {
    driver = new ChargerDriver();
  });

  it('should list chargers from active Joulo client on list_devices', async () => {
    const mockChargers: JouloCharger[] = [
      {
        id: 'ad315397-2fa8-4582-8846-0ff9d9b07228',
        nickname: 'Peblar Home',
        status: 'online',
      },
    ];

    const mockClient = {
      getChargers: vi.fn().mockResolvedValue(mockChargers),
    };

    (driver as any).homey = {
      app: {
        pollingCoordinator: {
          getClient: () => mockClient,
        },
      },
    };

    const handlers: Record<string, (...args: any[]) => Promise<any>> = {};
    const mockSession = {
      setHandler: (event: string, handler: any) => {
        handlers[event] = handler;
      },
    };

    await driver.onPair(mockSession as any);
    expect(handlers['list_devices']).toBeDefined();

    const result = await handlers['list_devices']!();
    expect(result).toHaveLength(1);
    expect(result[0].data.id).toBe('ad315397-2fa8-4582-8846-0ff9d9b07228');
    expect(result[0].name).toBe('Peblar Home');
  });

  it('should return empty array if no Joulo client is configured yet', async () => {
    (driver as any).homey = { app: {} };
    const handlers: Record<string, (...args: any[]) => Promise<any>> = {};
    const mockSession = {
      setHandler: (event: string, handler: any) => {
        handlers[event] = handler;
      },
    };

    await driver.onPair(mockSession as any);
    const result = await handlers['list_devices']!();
    expect(result).toEqual([]);
  });
});

describe('ChargerDevice Lifecycle and Capabilities', () => {
  let device: ChargerDevice;
  let mockCoordinator: any;

  beforeEach(() => {
    mockCoordinator = {
      registerChargerDevice: vi.fn(),
      unregisterChargerDevice: vi.fn(),
      updateIntervals: vi.fn(),
    };

    device = new ChargerDevice();
    device.homey = {
      app: {
        pollingCoordinator: mockCoordinator,
      },
    } as any;
    (device as any).settings = {
      poll_interval_active: 45,
      poll_interval_idle: 240,
    };
  });

  it('registers device with central PollingCoordinator on onInit', async () => {
    await device.onInit();
    expect(mockCoordinator.updateIntervals).toHaveBeenCalledWith(45, 240);
    expect(mockCoordinator.registerChargerDevice).toHaveBeenCalledWith(device);
  });

  it('synchronizes capabilities when charger is idle and retains previous session kwh', async () => {
    // Simulate previous session energy
    device.capabilities['meter_session_kwh'] = 4.25;

    const idleCharger: JouloCharger = {
      id: 'test-charger-id',
      status: 'online',
      is_charging: false,
      latest_meter_wh: 500120, // 500.12 kWh
      current_session: null,
    };

    await device.onChargerData(idleCharger);

    expect(device.capabilities['evcharger_charging']).toBe(false);
    expect(device.capabilities['meter_power']).toBe(500.12);
    // Recent session kWh is retained, NOT wiped to 0
    expect(device.capabilities['meter_session_kwh']).toBe(4.25);
    expect(device.capabilities['measure_power']).toBe(0);
  });

  it('synchronizes capabilities and computes power when charger is charging', async () => {
    const activeCharger: JouloCharger = {
      id: 'test-charger-id',
      status: 'charging',
      is_charging: true,
      latest_meter_wh: 505120,
      current_session: {
        id: 'session-123',
        started_at: new Date(Date.now() - 30 * 60000).toISOString(), // 30 minutes ago
        kwh_so_far: 5.5,
      },
    };

    await device.onChargerData(activeCharger);

    expect(device.capabilities['evcharger_charging']).toBe(true);
    expect(device.capabilities['meter_power']).toBe(505.12);
    expect(device.capabilities['meter_session_kwh']).toBe(5.5);
    expect(device.capabilities['measure_power']).toBeGreaterThan(0);
  });

  it('updates coordinator availability on error and recovery callbacks', async () => {
    await device.onCoordinatorError('Joulo API is unreachable', false);
    expect(device.available).toBe(false);
    expect(device.unavailableReason).toBe('Joulo API is unreachable');

    await device.onCoordinatorError('Invalid token', true);
    expect(device.available).toBe(false);
    expect(device.unavailableReason).toContain('Joulo Account');

    await device.onCoordinatorAvailable();
    expect(device.available).toBe(true);
    expect(device.unavailableReason).toBeNull();
  });

  it('updates coordinator intervals on onSettings', async () => {
    await device.onSettings({
      oldSettings: {},
      newSettings: { poll_interval_active: 30, poll_interval_idle: 180 },
      changedKeys: ['poll_interval_active', 'poll_interval_idle'],
    });

    expect(mockCoordinator.updateIntervals).toHaveBeenCalledWith(30, 180);
  });

  it('unregisters device on onDeleted', async () => {
    await device.onDeleted();
    expect(mockCoordinator.unregisterChargerDevice).toHaveBeenCalledWith(device);
  });
});

