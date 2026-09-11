import Homey from 'homey';

class JouloApp extends Homey.App {
  /**
   * onInit is called when the app is initialized.
   */
  async onInit(): Promise<void> {
    this.log('Joulo app has been initialized');
  }
}

export = JouloApp;

