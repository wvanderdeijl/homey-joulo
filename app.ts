import Homey from 'homey';
import { PollingCoordinator } from './lib/polling-coordinator';

class JouloApp extends Homey.App {
  public pollingCoordinator!: PollingCoordinator;

  /**
   * onInit is called when the app is initialized.
   */
  override async onInit(): Promise<void> {
    this.log('Joulo app has been initialized');

    this.pollingCoordinator = new PollingCoordinator({
      timerProvider: {
        setInterval: (cb, ms) => this.homey.setInterval(cb, ms),
        clearInterval: (t) => this.homey.clearInterval(t),
      },
      logger: {
        log: (...args: unknown[]) => this.log(...args),
        error: (...args: unknown[]) => this.error(...args),
      },
    });
  }

  /**
   * onUninit is called when the app is uninitialized or destroyed.
   */
  async onUninit(): Promise<void> {
    if (this.pollingCoordinator) {
      this.pollingCoordinator.destroy();
    }
  }
}

export = JouloApp;

