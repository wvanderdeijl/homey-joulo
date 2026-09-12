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
    this.log('AccountDriver: onPair session started');
    let token = '';
    let client: JouloClient | null = null;

    session.setHandler('showView', async (viewId: string) => {
      this.log(`AccountDriver: Pair session view changed to: ${viewId}`);
    });

    session.setHandler('validate_token', async (data: { token?: string }) => {
      this.log('AccountDriver: received validate_token request from frontend');
      const rawToken = data?.token?.trim();
      if (!rawToken) {
        this.error('AccountDriver: token is empty');
        throw new Error('Please enter a valid personal Bearer token');
      }

      this.log('AccountDriver: validating token with Joulo API (/energy)...');
      const testClient = new JouloClient({ token: rawToken });
      
      try {
        await testClient.getEnergy();
        this.log('AccountDriver: token verified successfully with Joulo API!');
      } catch (err: unknown) {
        this.error('AccountDriver: token verification failed:', err);
        throw err;
      }

      token = rawToken;
      client = testClient;

      // Programmatically tell Homey to transition to the list_devices view
      try {
        this.log('AccountDriver: showing view list_devices...');
        await session.showView('list_devices');
      } catch (navErr) {
        this.log('AccountDriver: session.showView handled or deferred to frontend:', navErr);
      }

      return true;
    });

    session.setHandler('list_devices', async () => {
      this.log('AccountDriver: list_devices handler triggered');
      if (!token || !client) {
        this.error('AccountDriver: list_devices called without validated token');
        throw new Error('Token has not been validated');
      }

      // Return only the Account device representing cumulative Joulo statistics (ADR 0001)
      return [
        {
          name: 'Joulo Account',
          data: { id: 'joulo-account' },
          settings: { token },
        },
      ];
    });
  }
}

export = AccountDriver;
