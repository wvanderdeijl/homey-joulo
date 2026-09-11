import Homey from 'homey';
import {
  JouloClient,
  JouloAuthError,
  calculateEstimatedEarnings,
} from '../../lib/joulo-client';
import type {
  PollingCoordinator,
  AccountDeviceReceiver,
} from '../../lib/polling-coordinator';
import type {
  JouloEnergyResponse,
  JouloEstimateBasis,
} from '../../lib/types';

class AccountDevice extends Homey.Device implements AccountDeviceReceiver {
  private client: JouloClient | null = null;
  private consecutiveFailures = 0;
  private lastEreCredits: number | null = null;

  /**
   * Get the central PollingCoordinator from the App instance if available.
   */
  private getCoordinator(): PollingCoordinator | undefined {
    return (this.homey?.app as { pollingCoordinator?: PollingCoordinator } | undefined)?.pollingCoordinator;
  }

  /**
   * onInit is called when the device is initialized.
   */
  override async onInit(): Promise<void> {
    this.log('AccountDevice has been initialized');

    const token = this.getSetting('token');
    if (token && typeof token === 'string') {
      this.client = new JouloClient({ token });

      const coordinator = this.getCoordinator();
      if (coordinator) {
        coordinator.setToken(token);
        const pollInterval = Number(this.getSetting('poll_interval'));
        if (pollInterval) {
          coordinator.updateIntervals(undefined, pollInterval);
        }
        coordinator.registerAccountDevice(this);
      } else {
        await this.syncAccountData();
      }
    } else {
      await this.setUnavailable('API Bearer token is required. Please configure in settings.');
    }
  }

  /**
   * Handle account data distributed centrally by the PollingCoordinator (ADR 0002).
   */
  async onAccountData(energy: JouloEnergyResponse, estimateBasis?: JouloEstimateBasis): Promise<void> {
    // Cumulative energy reading in kWh
    await this.setCapabilityValue('meter_power', energy.total_kwh);

    // Cumulative ERE credits
    await this.setCapabilityValue('ere_credits', energy.total_ere_credits);

    // Calculate estimated net earnings in EUR from Joulo sessions estimate basis
    const earnings = calculateEstimatedEarnings(energy.total_ere_credits, estimateBasis);
    await this.setCapabilityValue('ere_earnings', earnings);

    // Detect ERE credits change and fire trigger card
    if (typeof energy.total_ere_credits === 'number') {
      if (this.lastEreCredits !== null && energy.total_ere_credits !== this.lastEreCredits) {
        const delta = Number((energy.total_ere_credits - this.lastEreCredits).toFixed(2));
        void this.triggerEreCreditsUpdated({
          total_credits: energy.total_ere_credits,
          credits_delta: delta,
        });
      }
      this.lastEreCredits = energy.total_ere_credits;
    }

    this.consecutiveFailures = 0;
  }

  /**
   * Trigger the "account_ere_credits_updated" Flow card with tokens.
   */
  public async triggerEreCreditsUpdated(tokens: { total_credits: number; credits_delta: number }): Promise<void> {
    try {
      const card = this.homey.flow.getDeviceTriggerCard('account_ere_credits_updated');
      await card.trigger(this, tokens);
    } catch (err) {
      this.error('Failed to trigger account_ere_credits_updated:', err);
    }
  }

  /**
   * Called by coordinator on prolonged failure or authentication error.
   */
  async onCoordinatorError(message: string, isAuthError: boolean): Promise<void> {
    if (isAuthError) {
      await this.setUnavailable('Invalid or expired Bearer token. Please update in settings.');
    } else {
      await this.setUnavailable(message);
    }
  }

  /**
   * Called by coordinator when communication is restored.
   */
  async onCoordinatorAvailable(): Promise<void> {
    await this.setAvailable();
  }

  /**
   * Synchronize account energy metrics, ERE credits, and estimated earnings directly.
   * Used for direct manual calls or fallback environments.
   */
  async syncAccountData(): Promise<void> {
    if (!this.client) {
      await this.setUnavailable('API Bearer token is required. Please configure in settings.');
      return;
    }

    try {
      const energy = await this.client.getEnergy();
      let estimateBasis: JouloEstimateBasis | undefined;

      try {
        const sessionsResp = await this.client.getSessionsResponse({ limit: 1 });
        estimateBasis = sessionsResp.estimate_basis;
      } catch (err) {
        this.error('Could not fetch sessions estimate basis for earnings calculation:', err);
      }

      await this.onAccountData(energy, estimateBasis);
      this.consecutiveFailures = 0;
      await this.setAvailable();
    } catch (err) {
      if (err instanceof JouloAuthError) {
        this.error('Joulo authentication error:', err);
        await this.setUnavailable('Invalid or expired Bearer token. Please update in settings.');
      } else {
        this.consecutiveFailures += 1;
        const msg = err instanceof Error ? err.message : String(err);
        this.error(`Failed to synchronize Joulo account data (attempt ${this.consecutiveFailures}):`, err);

        if (this.consecutiveFailures >= 3) {
          await this.setUnavailable(msg);
        }
      }
    }
  }

  /**
   * onSettings is called when the user updates the device's settings.
   */
  override async onSettings({
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log('AccountDevice settings were changed:', changedKeys);
    const coordinator = this.getCoordinator();

    if (changedKeys.includes('token')) {
      const rawToken = newSettings['token'];
      const token = typeof rawToken === 'string' ? rawToken.trim() : '';
      if (token) {
        this.client = new JouloClient({ token });
        if (coordinator) {
          coordinator.setToken(token);
        } else {
          void this.syncAccountData();
        }
      } else {
        this.client = null;
        if (coordinator) {
          coordinator.setToken(null);
        }
        await this.setUnavailable('API Bearer token is required. Please configure in settings.');
      }
    }

    if (changedKeys.includes('poll_interval')) {
      const pollInterval = Number(newSettings['poll_interval']);
      if (coordinator && pollInterval) {
        coordinator.updateIntervals(undefined, pollInterval);
      }
    }
  }

  /**
   * onDeleted is called when the user deletes the device.
   */
  override async onDeleted(): Promise<void> {
    const coordinator = this.getCoordinator();
    if (coordinator) {
      coordinator.unregisterAccountDevice(this);
    }
    this.log('AccountDevice has been deleted');
  }
}

export = AccountDevice;
