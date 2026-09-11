import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock homey module
const mockTriggerSessionStarted = vi.fn().mockResolvedValue(undefined);
const mockTriggerSessionCompleted = vi.fn().mockResolvedValue(undefined);
const mockTriggerEreCreditsUpdated = vi.fn().mockResolvedValue(undefined);

const mockSoftRebootActionCard = {
  registerRunListener: vi.fn(),
};
const mockHardRebootActionCard = {
  registerRunListener: vi.fn(),
};

const mockGetDeviceTriggerCard = vi.fn((id: string) => {
  if (id === 'charger_session_started') {
    return { trigger: mockTriggerSessionStarted };
  }
  if (id === 'charger_session_completed') {
    return { trigger: mockTriggerSessionCompleted };
  }
  if (id === 'account_ere_credits_updated') {
    return { trigger: mockTriggerEreCreditsUpdated };
  }
  return { trigger: vi.fn().mockResolvedValue(undefined) };
});

const mockGetActionCard = vi.fn((id: string) => {
  if (id === 'charger_reboot_soft') {
    return mockSoftRebootActionCard;
  }
  if (id === 'charger_reboot_hard') {
    return mockHardRebootActionCard;
  }
  return { registerRunListener: vi.fn() };
});

vi.mock('homey', () => {
  class MockDriver {
    log = vi.fn();
    error = vi.fn();
    homey = {
      flow: {
        getActionCard: mockGetActionCard,
        getDeviceTriggerCard: mockGetDeviceTriggerCard,
      },
      __: vi.fn((key: string) => key),
    };
    async onInit() {}
  }

  class MockDevice {
    settings: Record<string, unknown> = {};
    capabilities: Record<string, unknown> = {};
    available = true;
    unavailableReason: string | null = null;
    deviceData: Record<string, unknown> = { id: 'test-charger-uuid' };
    name = 'Peblar Test Charger';

    homey = {
      app: {},
      flow: {
        getActionCard: mockGetActionCard,
        getDeviceTriggerCard: mockGetDeviceTriggerCard,
      },
      __: vi.fn((key: string) => {
        const translations: Record<string, string> = {
          'errors.reboot_cooldown': 'Charger was rebooted recently. A 5-minute cooldown is required between reboots.',
          'errors.charger_offline': 'Charger is currently offline or unreachable.',
          'errors.auth_error': 'Authentication failed. Please verify Bearer token in Joulo Account settings.',
          'errors.client_unavailable': 'Joulo API client is not configured.',
        };
        return translations[key] || key;
      }),
    };

    log = vi.fn();
    error = vi.fn();

    getData() {
      return this.deviceData;
    }

    getName() {
      return this.name;
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

import ChargerDriver from '../drivers/charger/driver';
import ChargerDevice from '../drivers/charger/device';
import AccountDevice from '../drivers/account/device';
import {
  JouloAuthError,
  JouloCooldownError,
  JouloOfflineError,
} from '../lib/joulo-client';
import type { JouloCharger, JouloEnergyResponse } from '../lib/types';

describe('Issue #6 Flow Cards & Automation Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Flow Manifest Definitions (.homeycompose/flow/)', () => {
    it('defines charger_session_started trigger correctly', () => {
      const file = path.join(
        __dirname,
        '../.homeycompose/flow/triggers/charger_session_started.json',
      );
      expect(fs.existsSync(file)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(manifest.title.en).toBe('Charging session started');
      expect(manifest.title.nl).toBe('Laadsessie gestart');
      expect(manifest.args[0]).toEqual({
        name: 'device',
        type: 'device',
        filter: 'driver_id=charger',
      });
    });

    it('defines charger_session_completed trigger with all 4 required tokens', () => {
      const file = path.join(
        __dirname,
        '../.homeycompose/flow/triggers/charger_session_completed.json',
      );
      expect(fs.existsSync(file)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(manifest.title.en).toBe('Charging session completed');
      expect(manifest.title.nl).toBe('Laadsessie voltooid');
      expect(manifest.args[0].filter).toBe('driver_id=charger');

      const tokenNames = manifest.tokens.map((t: { name: string }) => t.name);
      expect(tokenNames).toContain('kwh_total');
      expect(tokenNames).toContain('session_duration');
      expect(tokenNames).toContain('ere_earned');
      expect(tokenNames).toContain('id_tag');
    });

    it('defines account_ere_credits_updated trigger with tokens', () => {
      const file = path.join(
        __dirname,
        '../.homeycompose/flow/triggers/account_ere_credits_updated.json',
      );
      expect(fs.existsSync(file)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(manifest.title.en).toBe('ERE credits updated');
      expect(manifest.args[0].filter).toBe('driver_id=account');

      const tokenNames = manifest.tokens.map((t: { name: string }) => t.name);
      expect(tokenNames).toContain('total_credits');
      expect(tokenNames).toContain('credits_delta');
    });

    it('defines charger_reboot_soft and charger_reboot_hard actions', () => {
      const softFile = path.join(
        __dirname,
        '../.homeycompose/flow/actions/charger_reboot_soft.json',
      );
      const hardFile = path.join(
        __dirname,
        '../.homeycompose/flow/actions/charger_reboot_hard.json',
      );
      expect(fs.existsSync(softFile)).toBe(true);
      expect(fs.existsSync(hardFile)).toBe(true);

      const softManifest = JSON.parse(fs.readFileSync(softFile, 'utf8'));
      const hardManifest = JSON.parse(fs.readFileSync(hardFile, 'utf8'));

      expect(softManifest.title.en).toBe('Restart charger (Soft)');
      expect(hardManifest.title.en).toBe('Restart charger (Hard)');
      expect(softManifest.args[0].filter).toBe('driver_id=charger');
      expect(hardManifest.args[0].filter).toBe('driver_id=charger');
    });
  });

  describe('ChargerDriver Action Listeners', () => {
    it('registers reboot run listeners on onInit', async () => {
      const driver = new ChargerDriver();
      await driver.onInit();

      expect(mockGetActionCard).toHaveBeenCalledWith('charger_reboot_soft');
      expect(mockGetActionCard).toHaveBeenCalledWith('charger_reboot_hard');
      expect(mockSoftRebootActionCard.registerRunListener).toHaveBeenCalledTimes(1);
      expect(mockHardRebootActionCard.registerRunListener).toHaveBeenCalledTimes(1);
    });

    it('invokes device.reboot("Soft") and device.reboot("Hard") from action card listener', async () => {
      const driver = new ChargerDriver();
      await driver.onInit();

      const softListener = mockSoftRebootActionCard.registerRunListener.mock.calls[0][0];
      const hardListener = mockHardRebootActionCard.registerRunListener.mock.calls[0][0];

      const mockDevice = {
        reboot: vi.fn().mockResolvedValue(undefined),
      };

      await softListener({ device: mockDevice });
      expect(mockDevice.reboot).toHaveBeenCalledWith('Soft');

      await hardListener({ device: mockDevice });
      expect(mockDevice.reboot).toHaveBeenCalledWith('Hard');
    });
  });

  describe('ChargerDevice Session Flow Triggers', () => {
    it('fires charger_session_started when charger transitions to charging', async () => {
      const device = new ChargerDevice();

      // Initial state: idle
      const idleCharger: JouloCharger = {
        id: 'test-charger-uuid',
        status: 'online',
        is_charging: false,
        latest_meter_wh: 500000,
        current_session: null,
      };
      await device.onChargerData(idleCharger);
      expect(mockTriggerSessionStarted).not.toHaveBeenCalled();

      // Transition to charging
      const activeCharger: JouloCharger = {
        id: 'test-charger-uuid',
        status: 'charging',
        is_charging: true,
        latest_meter_wh: 501000,
        current_session: {
          id: 'sess-001',
          started_at: new Date(Date.now() - 5 * 60000).toISOString(),
          kwh_so_far: 1.0,
          id_tag: 'RFID-1234',
        },
      };
      await device.onChargerData(activeCharger);

      expect(mockTriggerSessionStarted).toHaveBeenCalledWith(device);
      expect(mockTriggerSessionCompleted).not.toHaveBeenCalled();
    });

    it('fires charger_session_completed with tokens when charging completes', async () => {
      const device = new ChargerDevice();

      // Initial state: idle
      await device.onChargerData({
        id: 'test-charger-uuid',
        status: 'online',
        is_charging: false,
        latest_meter_wh: 500000,
        current_session: null,
      });

      // Active charging
      const sessionStart = new Date(Date.now() - 45 * 60000).toISOString(); // 45 min ago
      await device.onChargerData({
        id: 'test-charger-uuid',
        status: 'charging',
        is_charging: true,
        latest_meter_wh: 512000,
        current_session: {
          id: 'sess-002',
          started_at: sessionStart,
          kwh_so_far: 12.0,
          id_tag: 'jlaPBLR0067249',
        },
      });

      expect(mockTriggerSessionStarted).toHaveBeenCalledTimes(1);

      // Session finished
      await device.onChargerData({
        id: 'test-charger-uuid',
        status: 'online',
        is_charging: false,
        latest_meter_wh: 512000,
        current_session: null,
      });

      expect(mockTriggerSessionCompleted).toHaveBeenCalledTimes(1);
      const call = mockTriggerSessionCompleted.mock.calls[0];
      expect(call[0]).toBe(device);
      expect(call[1]).toEqual({
        kwh_total: 12.0,
        session_duration: expect.any(Number),
        ere_earned: 4.0, // 12.0 / 3 = 4.0
        id_tag: 'jlaPBLR0067249',
      });
      expect(call[1].session_duration).toBeGreaterThanOrEqual(44);
    });

    it('does not fire charger_session_started if vehicle is already charging on initial sync', async () => {
      const device = new ChargerDevice();

      // First sync right after app restart when vehicle was already plugged in
      await device.onChargerData({
        id: 'test-charger-uuid',
        status: 'charging',
        is_charging: true,
        latest_meter_wh: 501000,
        current_session: {
          id: 'sess-already-active',
          started_at: new Date(Date.now() - 15 * 60000).toISOString(),
          kwh_so_far: 3.5,
          id_tag: 'RFID-1234',
        },
      });

      expect(mockTriggerSessionStarted).not.toHaveBeenCalled();
    });

    it('sets ere_earned to 0 when charger is not MID-certified', async () => {
      const device = new ChargerDevice();

      // Start idle
      await device.onChargerData({
        id: 'test-charger-uuid',
        status: 'online',
        is_charging: false,
        mid_certified: false,
        latest_meter_wh: 500000,
      });

      // Charge
      await device.onChargerData({
        id: 'test-charger-uuid',
        status: 'charging',
        is_charging: true,
        mid_certified: false,
        latest_meter_wh: 509000,
        current_session: {
          id: 'sess-non-mid',
          kwh_so_far: 9.0,
          id_tag: 'RFID-NOMID',
        },
      });

      // Complete session
      await device.onChargerData({
        id: 'test-charger-uuid',
        status: 'online',
        is_charging: false,
        mid_certified: false,
        latest_meter_wh: 509000,
      });

      expect(mockTriggerSessionCompleted).toHaveBeenCalledTimes(1);
      const call = mockTriggerSessionCompleted.mock.calls[0];
      expect(call[1].ere_earned).toBe(0); // Non-MID chargers cannot claim official ERE credits
      expect(call[1].kwh_total).toBe(9.0);
    });
  });

  describe('AccountDevice Flow Triggers', () => {
    it('fires account_ere_credits_updated when balance changes', async () => {
      const device = new AccountDevice();

      const initialEnergy: JouloEnergyResponse = {
        total_kwh: 500.0,
        total_ere_credits: 160.0,
        total_sessions: 25,
        chargers: [],
      };

      // Initial sync establishes baseline
      await device.onAccountData(initialEnergy);
      expect(mockTriggerEreCreditsUpdated).not.toHaveBeenCalled();

      // Second sync with updated credits
      const updatedEnergy: JouloEnergyResponse = {
        ...initialEnergy,
        total_ere_credits: 163.5,
      };
      await device.onAccountData(updatedEnergy);

      expect(mockTriggerEreCreditsUpdated).toHaveBeenCalledTimes(1);
      expect(mockTriggerEreCreditsUpdated).toHaveBeenCalledWith(device, {
        total_credits: 163.5,
        credits_delta: 3.5,
      });

      // Third sync with same credits -> should not trigger
      await device.onAccountData(updatedEnergy);
      expect(mockTriggerEreCreditsUpdated).toHaveBeenCalledTimes(1);
    });
  });

  describe('Remote Reboot Action & Error Handling', () => {
    it('executes soft and hard reboot successfully on 200/202', async () => {
      const mockRebootCharger = vi.fn().mockResolvedValue({
        success: true,
        status: 202,
        confirmed_by_boot: false,
      });

      const mockClient = {
        rebootCharger: mockRebootCharger,
      };

      const device = new ChargerDevice();
      (device.homey.app as any).pollingCoordinator = {
        getClient: () => mockClient,
      };

      await device.reboot('Soft');
      expect(mockRebootCharger).toHaveBeenCalledWith('test-charger-uuid', 'Soft');

      await device.reboot('Hard');
      expect(mockRebootCharger).toHaveBeenCalledWith('test-charger-uuid', 'Hard');
    });

    it('throws user-friendly localized error on 409 Cooldown', async () => {
      const mockClient = {
        rebootCharger: vi.fn().mockRejectedValue(
          new JouloCooldownError('Conflict: Cooldown active', {
            statusCode: 409,
            endpoint: '/chargers/reboot',
          }),
        ),
      };

      const device = new ChargerDevice();
      (device.homey.app as any).pollingCoordinator = {
        getClient: () => mockClient,
      };

      await expect(device.reboot('Soft')).rejects.toThrow(
        'Charger was rebooted recently. A 5-minute cooldown is required between reboots.',
      );
    });

    it('throws user-friendly localized error on 503 Offline', async () => {
      const mockClient = {
        rebootCharger: vi.fn().mockRejectedValue(
          new JouloOfflineError('Service Unavailable: Charger offline', {
            statusCode: 503,
            endpoint: '/chargers/reboot',
          }),
        ),
      };

      const device = new ChargerDevice();
      (device.homey.app as any).pollingCoordinator = {
        getClient: () => mockClient,
      };

      await expect(device.reboot('Hard')).rejects.toThrow(
        'Charger is currently offline or unreachable.',
      );
    });

    it('throws user-friendly localized error on 401 Auth error', async () => {
      const mockClient = {
        rebootCharger: vi.fn().mockRejectedValue(
          new JouloAuthError('Unauthorized', {
            statusCode: 401,
            endpoint: '/chargers/reboot',
          }),
        ),
      };

      const device = new ChargerDevice();
      (device.homey.app as any).pollingCoordinator = {
        getClient: () => mockClient,
      };

      await expect(device.reboot('Soft')).rejects.toThrow(
        'Authentication failed. Please verify Bearer token in Joulo Account settings.',
      );
    });
  });
});

