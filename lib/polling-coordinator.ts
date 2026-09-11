import {
  JouloClient,
  JouloAuthError,
} from './joulo-client';
import type {
  JouloCharger,
  JouloEnergyResponse,
  JouloEstimateBasis,
} from './types';

export interface PollingTimerProvider {
  setInterval(callback: (...args: unknown[]) => void, ms: number): NodeJS.Timeout;
  clearInterval(timer: NodeJS.Timeout): void;
}

export interface AccountDeviceReceiver {
  onAccountData(energy: JouloEnergyResponse, estimateBasis?: JouloEstimateBasis): Promise<void>;
  onCoordinatorError(message: string, isAuthError: boolean): Promise<void>;
  onCoordinatorAvailable(): Promise<void>;
}

export interface ChargerDeviceReceiver {
  getChargerId(): string;
  onChargerData(charger: JouloCharger): Promise<void>;
  onCoordinatorError(message: string, isAuthError: boolean): Promise<void>;
  onCoordinatorAvailable(): Promise<void>;
}

export interface PollingCoordinatorOptions {
  timerProvider?: PollingTimerProvider;
  activeIntervalSeconds?: number;
  idleIntervalSeconds?: number;
  logger?: {
    log(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };
}

export const MAX_CONSECUTIVE_TRANSIENT_FAILURES = 3;

/**
 * Centralized Application-level Polling Coordinator (ADR 0002)
 * Coordinates Joulo REST API requests across all registered Account and Charger devices.
 * Uses adaptive polling (default 60s active charging / 300s idle) and single-source data distribution.
 */
export class PollingCoordinator {
  private client: JouloClient | null = null;
  private token: string | null = null;
  private timerProvider: PollingTimerProvider;
  private activeIntervalSeconds: number;
  private idleIntervalSeconds: number;
  private currentIntervalSeconds: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;
  private isCurrentlyCharging = false;
  private logger: { log(...args: unknown[]): void; error(...args: unknown[]): void };
  private cachedEstimateBasis?: JouloEstimateBasis | undefined;

  private accountDevices = new Set<AccountDeviceReceiver>();
  private chargerDevices = new Map<string, Set<ChargerDeviceReceiver>>();

  constructor(options: PollingCoordinatorOptions = {}) {
    this.timerProvider = options.timerProvider ?? {
      setInterval: (cb, ms) => setInterval(cb, ms),
      clearInterval: (t) => clearInterval(t),
    };
    this.activeIntervalSeconds = options.activeIntervalSeconds ?? 60;
    this.idleIntervalSeconds = options.idleIntervalSeconds ?? 300;
    this.currentIntervalSeconds = this.idleIntervalSeconds;
    this.logger = options.logger ?? {
      log: console.log,
      error: console.error,
    };
  }

  /**
   * Set or update the active Bearer token and initialize the JouloClient.
   */
  public setToken(token: string | null): void {
    const trimmed = token?.trim() || null;
    if (trimmed === this.token && this.client) {
      return;
    }

    this.token = trimmed;
    this.cachedEstimateBasis = undefined;
    if (this.token) {
      this.client = new JouloClient({ token: this.token });
      this.consecutiveFailures = 0;
      this.restartPolling();
    } else {
      this.client = null;
      this.stopPolling();
      void this.notifyAllError('API Bearer token is required. Please configure in settings.', true);
    }
  }

  /**
   * Get the active JouloClient instance, if initialized.
   */
  public getClient(): JouloClient | null {
    return this.client;
  }

  /**
   * Update active and idle polling intervals from settings.
   */
  public updateIntervals(activeSec?: number, idleSec?: number): void {
    if (activeSec && activeSec >= 15) {
      this.activeIntervalSeconds = activeSec;
    }
    if (idleSec && idleSec >= 30) {
      this.idleIntervalSeconds = idleSec;
    }

    const targetInterval = this.isCurrentlyCharging
      ? this.activeIntervalSeconds
      : this.idleIntervalSeconds;

    if (this.currentIntervalSeconds !== targetInterval) {
      this.currentIntervalSeconds = targetInterval;
      this.restartPolling();
    }
  }

  /**
   * Register an Account device to receive aggregated data.
   */
  public registerAccountDevice(device: AccountDeviceReceiver): void {
    this.accountDevices.add(device);
    if (!this.token) {
      void device.onCoordinatorError('API Bearer token is required. Please configure in settings.', true);
    } else if (this.accountDevices.size === 1 && this.getTotalDeviceCount() === 1) {
      this.restartPolling();
    }
  }

  /**
   * Unregister an Account device.
   */
  public unregisterAccountDevice(device: AccountDeviceReceiver): void {
    this.accountDevices.delete(device);
    if (this.getTotalDeviceCount() === 0) {
      this.stopPolling();
    }
  }

  /**
   * Register a Charger device to receive charger metrics.
   */
  public registerChargerDevice(device: ChargerDeviceReceiver): void {
    const chargerId = device.getChargerId();
    let set = this.chargerDevices.get(chargerId);
    if (!set) {
      set = new Set();
      this.chargerDevices.set(chargerId, set);
    }
    set.add(device);

    if (!this.token) {
      void device.onCoordinatorError('API Bearer token is required. Please configure in settings.', true);
    } else if (this.getTotalDeviceCount() === 1) {
      this.restartPolling();
    }
  }

  /**
   * Unregister a Charger device.
   */
  public unregisterChargerDevice(device: ChargerDeviceReceiver): void {
    const chargerId = device.getChargerId();
    const set = this.chargerDevices.get(chargerId);
    if (set) {
      set.delete(device);
      if (set.size === 0) {
        this.chargerDevices.delete(chargerId);
      }
    }

    if (this.getTotalDeviceCount() === 0) {
      this.stopPolling();
    }
  }

  public getTotalDeviceCount(): number {
    let chargerCount = 0;
    for (const set of this.chargerDevices.values()) {
      chargerCount += set.size;
    }
    return this.accountDevices.size + chargerCount;
  }

  /**
   * Perform a single coordinated poll across Joulo API endpoints.
   */
  public async poll(): Promise<void> {
    if (!this.client || !this.token) {
      return;
    }

    try {
      // 1. Fetch chargers list
      const chargers = await this.client.getChargers();

      // Check if any charger is actively charging
      const anyCharging = chargers.some(
        (c) => c.is_charging === true || c.status === 'charging' || c.status === 'active',
      );
      this.updateChargingState(anyCharging);

      // 2. Fetch energy overview
      const energy = await this.client.getEnergy();

      // 3. Fetch latest sessions for earnings estimation basis only if not yet cached
      if (!this.cachedEstimateBasis) {
        try {
          const sessionsResp = await this.client.getSessionsResponse({ limit: 1 });
          this.cachedEstimateBasis = sessionsResp.estimate_basis;
        } catch (err) {
          this.logger.error('Failed to fetch sessions estimate basis during coordinated poll:', err);
        }
      }

      // Fan-out to registered devices
      await this.distributeData(chargers, energy, this.cachedEstimateBasis);

      // Successful poll resets failure counter and restores device availability
      this.consecutiveFailures = 0;
      await this.notifyAllAvailable();
    } catch (err) {
      await this.handlePollError(err);
    }
  }

  /**
   * Dynamically adjust polling interval if charging state changes.
   */
  private updateChargingState(isCharging: boolean): void {
    if (this.isCurrentlyCharging !== isCharging) {
      this.isCurrentlyCharging = isCharging;
      const targetInterval = isCharging ? this.activeIntervalSeconds : this.idleIntervalSeconds;
      this.logger.log(`Adaptive polling: Charging state changed to ${isCharging ? 'ACTIVE' : 'IDLE'}, setting interval to ${targetInterval}s`);
      if (this.currentIntervalSeconds !== targetInterval) {
        this.currentIntervalSeconds = targetInterval;
        this.restartPolling();
      }
    }
  }

  /**
   * Distribute received API data to registered Account and Charger devices.
   */
  private async distributeData(
    chargers: JouloCharger[],
    energy: JouloEnergyResponse,
    estimateBasis?: JouloEstimateBasis,
  ): Promise<void> {
    // Notify Account devices
    const accountPromises = Array.from(this.accountDevices).map((dev) =>
      dev.onAccountData(energy, estimateBasis).catch((err) => {
        this.logger.error('Error in account device onAccountData:', err);
      }),
    );

    // Notify Charger devices
    const chargerPromises: Promise<void>[] = [];
    const chargerMap = new Map<string, JouloCharger>();
    for (const c of chargers) {
      chargerMap.set(c.id, c);
    }

    for (const [chargerId, devices] of this.chargerDevices.entries()) {
      const charger = chargerMap.get(chargerId);
      if (charger) {
        for (const dev of devices) {
          chargerPromises.push(
            dev.onChargerData(charger).catch((err) => {
              this.logger.error(`Error in charger device ${chargerId} onChargerData:`, err);
            }),
          );
        }
      }
    }

    await Promise.all([...accountPromises, ...chargerPromises]);
  }

  /**
   * Handle errors during polling with resilience (CONTEXT.md).
   */
  private async handlePollError(err: unknown): Promise<void> {
    if (err instanceof JouloAuthError) {
      this.logger.error('Coordinated poll authentication error (401/403):', err);
      await this.notifyAllError('Invalid or expired Bearer token. Please update in settings.', true);
      return;
    }

    this.consecutiveFailures += 1;
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`Coordinated poll failure (attempt ${this.consecutiveFailures}):`, err);

    if (this.consecutiveFailures >= MAX_CONSECUTIVE_TRANSIENT_FAILURES) {
      await this.notifyAllError(msg, false);
    }
  }

  private async notifyAllError(message: string, isAuthError: boolean): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const dev of this.accountDevices) {
      promises.push(dev.onCoordinatorError(message, isAuthError));
    }
    for (const devices of this.chargerDevices.values()) {
      for (const dev of devices) {
        promises.push(dev.onCoordinatorError(message, isAuthError));
      }
    }
    await Promise.all(promises);
  }

  private async notifyAllAvailable(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const dev of this.accountDevices) {
      promises.push(dev.onCoordinatorAvailable());
    }
    for (const devices of this.chargerDevices.values()) {
      for (const dev of devices) {
        promises.push(dev.onCoordinatorAvailable());
      }
    }
    await Promise.all(promises);
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    const ms = Math.max(this.currentIntervalSeconds, 15) * 1000;
    this.pollTimer = this.timerProvider.setInterval(() => {
      void this.poll();
    }, ms);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      this.timerProvider.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private restartPolling(): void {
    this.stopPolling();
    if (this.token && this.getTotalDeviceCount() > 0) {
      this.startPolling();
    }
  }

  /**
   * Stop all polling and clear registered devices.
   */
  public destroy(): void {
    this.stopPolling();
    this.accountDevices.clear();
    this.chargerDevices.clear();
    this.client = null;
    this.token = null;
    this.cachedEstimateBasis = undefined;
  }
}
