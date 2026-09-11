import Homey from 'homey';
import { JouloClient } from '../../lib/joulo-client';

class AccountDriver extends Homey.Driver {
  /**
   * onInit is called when the driver is initialized.
   */
  override async onInit(): Promise<void> {
    this.log('AccountDriver has been initialized');
  }

  /**
   * onPair is called when a user initiates a pairing session.
   */
  override async onPair(session: Homey.Driver.PairSession): Promise<void> {
    let token = '';
    let client: JouloClient | null = null;

    session.setHandler('validate_token', async (data: { token?: string }) => {
      const rawToken = data?.token?.trim();
      if (!rawToken) {
        throw new Error('Please enter a valid personal Bearer token');
      }

      const testClient = new JouloClient({ token: rawToken });
      // Validate token by making a live verification call
      await testClient.getEnergy();
      token = rawToken;
      client = testClient;
      return true;
    });

    session.setHandler('list_devices', async () => {
      if (!token || !client) {
        throw new Error('Token has not been validated');
      }

      const devices: Array<{
        name: string;
        data: { id: string };
        settings: { token: string };
      }> = [];

      // 1. Account device representing cumulative Joulo statistics
      devices.push({
        name: 'Joulo Account',
        data: { id: 'joulo-account' },
        settings: { token },
      });

      // 2. Discovered chargers linked to this account
      try {
        const chargers = await client.getChargers();
        for (const charger of chargers) {
          devices.push({
            name: charger.nickname || charger.name || `Peblar (${charger.id})`,
            data: { id: charger.id },
            settings: { token },
          });
        }
      } catch (err) {
        this.error('Failed to discover chargers during pairing:', err);
      }

      return devices;
    });
  }
}

export = AccountDriver;
