import Homey from 'homey';
import type { PollingCoordinator } from '../../lib/polling-coordinator';
import type { JouloClient } from '../../lib/joulo-client';

class ChargerDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  override async onInit(): Promise<void> {
    this.log('ChargerDriver has been initialized');
  }

  /**
   * Helper to retrieve active JouloClient from the app PollingCoordinator.
   */
  private getClient(): JouloClient | null {
    const coordinator = (this.homey?.app as { pollingCoordinator?: PollingCoordinator } | undefined)?.pollingCoordinator;
    return coordinator?.getClient() ?? null;
  }

  /**
   * onPair is called when a pairing session starts.
   */
  override async onPair(session: Homey.Driver.PairSession): Promise<void> {
    this.log('Charger pairing session started');

    session.setHandler('list_devices', async () => {
      const client = this.getClient();
      if (!client) {
        this.error('No active Joulo client found. Please pair the Joulo Account first.');
        return [];
      }

      try {
        const chargers = await client.getChargers();
        return chargers.map((c) => ({
          name: c.nickname || c.name || `Peblar (${c.id})`,
          data: { id: c.id },
          settings: {},
        }));
      } catch (err) {
        this.error('Failed to list chargers during pairing:', err);
        throw new Error('Failed to retrieve chargers from Joulo. Please check your connection.');
      }
    });
  }
}

export = ChargerDriver;

