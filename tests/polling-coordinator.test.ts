import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PollingCoordinator,
  type AccountDeviceReceiver,
  type ChargerDeviceReceiver,
  type PollingTimerProvider,
} from '../lib/polling-coordinator';
import type { JouloCharger, JouloEnergyResponse, JouloEstimateBasis } from '../lib/types';

describe('PollingCoordinator (ADR 0002 Centralized Adaptive Poller)', () => {
  let timerCallbacks: (() => void)[] = [];
  let mockTimerProvider: PollingTimerProvider;

  beforeEach(() => {
    timerCallbacks = [];
    mockTimerProvider = {
      setInterval: vi.fn((cb: () => void) => {
        timerCallbacks.push(cb);
        return {} as NodeJS.Timeout;
      }),
      clearInterval: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('manages token, registers devices, and coordinates single API poll', async () => {
    const mockChargers: JouloCharger[] = [
      {
        id: 'charger-1',
        nickname: 'Home Peblar',
        status: 'online',
        is_charging: false,
        latest_meter_wh: 120000,
        current_session: null,
      },
    ];

    const mockEnergy: JouloEnergyResponse = {
      total_kwh: 120,
      total_ere_credits: 40,
      total_sessions: 10,
    };

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/chargers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ chargers: mockChargers }),
        });
      }
      if (url.includes('/energy')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => mockEnergy,
        });
      }
      if (url.includes('/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            sessions: [],
            estimate_basis: { price_per_ere: 0.22, effective_fee_pct: 10 },
          }),
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
    vi.stubGlobal('fetch', mockFetch);

    const coordinator = new PollingCoordinator({
      timerProvider: mockTimerProvider,
      activeIntervalSeconds: 60,
      idleIntervalSeconds: 300,
    });

    const accountReceiver: AccountDeviceReceiver = {
      onAccountData: vi.fn().mockResolvedValue(undefined),
      onCoordinatorError: vi.fn().mockResolvedValue(undefined),
      onCoordinatorAvailable: vi.fn().mockResolvedValue(undefined),
    };

    const chargerReceiver: ChargerDeviceReceiver = {
      getChargerId: () => 'charger-1',
      onChargerData: vi.fn().mockResolvedValue(undefined),
      onCoordinatorError: vi.fn().mockResolvedValue(undefined),
      onCoordinatorAvailable: vi.fn().mockResolvedValue(undefined),
    };

    coordinator.setToken('test-bearer-token');
    coordinator.registerAccountDevice(accountReceiver);
    coordinator.registerChargerDevice(chargerReceiver);

    // Initial poll was triggered on registration
    await coordinator.poll();

    expect(accountReceiver.onAccountData).toHaveBeenCalledWith(
      mockEnergy,
      { price_per_ere: 0.22, effective_fee_pct: 10 },
    );
    expect(chargerReceiver.onChargerData).toHaveBeenCalledWith(mockChargers[0]);
    expect(accountReceiver.onCoordinatorAvailable).toHaveBeenCalled();
    expect(chargerReceiver.onCoordinatorAvailable).toHaveBeenCalled();

    coordinator.destroy();
    vi.unstubAllGlobals();
  });

  it('adaptively switches to activeInterval (60s) when a charger is charging and back to idle (300s)', async () => {
    const activeCharger: JouloCharger = {
      id: 'charger-1',
      status: 'charging',
      is_charging: true,
      latest_meter_wh: 125000,
      current_session: { id: 's1', started_at: '2026-09-11T20:00:00Z', kwh_so_far: 5 },
    };

    const idleCharger: JouloCharger = {
      ...activeCharger,
      status: 'online',
      is_charging: false,
    };

    let returnActive = true;
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/chargers')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ chargers: [returnActive ? activeCharger : idleCharger] }),
        });
      }
      if (url.includes('/energy')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ total_kwh: 100, total_ere_credits: 30, total_sessions: 8 }),
        });
      }
      if (url.includes('/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ sessions: [] }),
        });
      }
      return Promise.reject(new Error('Unknown'));
    });
    vi.stubGlobal('fetch', mockFetch);

    const coordinator = new PollingCoordinator({
      timerProvider: mockTimerProvider,
      activeIntervalSeconds: 60,
      idleIntervalSeconds: 300,
    });

    const accountReceiver: AccountDeviceReceiver = {
      onAccountData: vi.fn().mockResolvedValue(undefined),
      onCoordinatorError: vi.fn().mockResolvedValue(undefined),
      onCoordinatorAvailable: vi.fn().mockResolvedValue(undefined),
    };

    coordinator.setToken('valid-token');
    coordinator.registerAccountDevice(accountReceiver);

    // Initial state: idle
    expect(mockTimerProvider.setInterval).toHaveBeenCalledWith(expect.any(Function), 300000);

    // First poll returns active charging
    await coordinator.poll();

    // Timer should have been restarted with active interval: 60s (60000ms)
    expect(mockTimerProvider.setInterval).toHaveBeenCalledWith(expect.any(Function), 60000);

    // Next poll returns idle charger
    returnActive = false;
    await coordinator.poll();

    // Timer should have switched back to idle interval: 300s (300000ms)
    expect(mockTimerProvider.setInterval).toHaveBeenLastCalledWith(expect.any(Function), 300000);

    coordinator.destroy();
    vi.unstubAllGlobals();
  });

  it('notifies devices immediately on auth error (401)', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Unauthorized' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const coordinator = new PollingCoordinator({ timerProvider: mockTimerProvider });
    const accountReceiver: AccountDeviceReceiver = {
      onAccountData: vi.fn().mockResolvedValue(undefined),
      onCoordinatorError: vi.fn().mockResolvedValue(undefined),
      onCoordinatorAvailable: vi.fn().mockResolvedValue(undefined),
    };

    coordinator.setToken('expired-token');
    coordinator.registerAccountDevice(accountReceiver);

    await coordinator.poll();

    expect(accountReceiver.onCoordinatorError).toHaveBeenCalledWith(
      expect.stringContaining('Invalid or expired Bearer token'),
      true,
    );

    coordinator.destroy();
    vi.unstubAllGlobals();
  });

  it('tolerates transient errors and only notifies prolonged unavailability on 3 consecutive failures', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Service Unavailable' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const coordinator = new PollingCoordinator({ timerProvider: mockTimerProvider });
    const accountReceiver: AccountDeviceReceiver = {
      onAccountData: vi.fn().mockResolvedValue(undefined),
      onCoordinatorError: vi.fn().mockResolvedValue(undefined),
      onCoordinatorAvailable: vi.fn().mockResolvedValue(undefined),
    };

    coordinator.setToken('valid-token');
    coordinator.registerAccountDevice(accountReceiver);

    // Attempt 1: transient failure
    await coordinator.poll();
    expect(accountReceiver.onCoordinatorError).not.toHaveBeenCalled();

    // Attempt 2: transient failure
    await coordinator.poll();
    expect(accountReceiver.onCoordinatorError).not.toHaveBeenCalled();

    // Attempt 3: threshold reached
    await coordinator.poll();
    expect(accountReceiver.onCoordinatorError).toHaveBeenCalledWith(
      expect.any(String),
      false,
    );

    coordinator.destroy();
    vi.unstubAllGlobals();
  });
});

