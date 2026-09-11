import Homey from 'homey';
import {
  JouloClient,
  JouloAuthError,
  calculateEstimatedEarnings,
} from '../../lib/joulo-client';

const MAX_CONSECUTIVE_TRANSIENT_FAILURES = 3;

class AccountDevice extends Homey.Device {
  private client: JouloClient | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;

  /**
   * onInit is called when the device is initialized.
   */
  override async onInit(): Promise<void> {
    this.log('AccountDevice has been initialized');
    const token = this.getSetting('token');
    await this.initializeClient(typeof token === 'string' ? token : undefined);
    this.setupPolling();
  }

  /**
   * Initialize or update the API client with a given token.
   */
  private async initializeClient(rawToken?: string): Promise<void> {
    const token = rawToken?.trim();
    if (token) {
      this.client = new JouloClient({ token });
      await this.syncAccountData();
    } else {
      this.client = null;
      await this.setUnavailable('API Bearer token is required. Please configure in settings.');
    }
  }

  /**
   * Set up recurring synchronization timer.
   */
  private setupPolling(): void {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    const intervalSec = Number(this.getSetting('poll_interval')) || 300;
    const intervalMs = Math.max(intervalSec, 60) * 1000;

    this.pollTimer = this.homey.setInterval(() => {
      void this.syncAccountData();
    }, intervalMs);
  }

  /**
   * Synchronize account energy metrics, ERE credits, and estimated earnings from Joulo.
   */
  async syncAccountData(): Promise<void> {
    if (!this.client) {
      await this.setUnavailable('API Bearer token is required. Please configure in settings.');
      return;
    }

    try {
      const energy = await this.client.getEnergy();

      // Cumulative energy reading in kWh
      await this.setCapabilityValue('meter_power', energy.total_kwh);

      // Cumulative ERE credits
      await this.setCapabilityValue('ere_credits', energy.total_ere_credits);

      // Calculate estimated net earnings in EUR from Joulo sessions estimate basis
      try {
        const sessionsResp = await this.client.getSessionsResponse({ limit: 1 });
        const earnings = calculateEstimatedEarnings(
          energy.total_ere_credits,
          sessionsResp.estimate_basis,
        );
        await this.setCapabilityValue('ere_earnings', earnings);
      } catch (err) {
        this.error('Could not fetch sessions estimate basis for earnings calculation:', err);
      }

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

        // Per CONTEXT.md: Keep persistent capability values; mark unavailable only on prolonged failure
        if (this.consecutiveFailures >= MAX_CONSECUTIVE_TRANSIENT_FAILURES) {
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

    if (changedKeys.includes('token')) {
      const token = typeof newSettings['token'] === 'string' ? newSettings['token'] : undefined;
      await this.initializeClient(token);
    }

    if (changedKeys.includes('poll_interval')) {
      this.setupPolling();
    }
  }

  /**
   * onDeleted is called when the user deletes the device.
   */
  override async onDeleted(): Promise<void> {
    if (this.pollTimer) {
      this.homey.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.log('AccountDevice has been deleted');
  }
}

export = AccountDevice;
