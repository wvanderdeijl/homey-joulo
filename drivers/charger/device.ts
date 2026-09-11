import Homey from 'homey';
import type {
  PollingCoordinator,
  ChargerDeviceReceiver,
} from '../../lib/polling-coordinator';
import type { JouloCharger } from '../../lib/types';

class ChargerDevice extends Homey.Device implements ChargerDeviceReceiver {
  private lastMeterWh: number | null = null;
  private lastMeterTime: number | null = null;

  /**
   * Return the unique Joulo charger identifier.
   */
  public getChargerId(): string {
    return this.getData().id;
  }

  /**
   * Get the central PollingCoordinator from the App instance.
   */
  private getCoordinator(): PollingCoordinator | undefined {
    return (this.homey?.app as { pollingCoordinator?: PollingCoordinator } | undefined)?.pollingCoordinator;
  }

  /**
   * onInit is called when the device is initialized.
   */
  override async onInit(): Promise<void> {
    this.log(`ChargerDevice ${this.getName()} (${this.getChargerId()}) initialized`);

    const coordinator = this.getCoordinator();
    if (coordinator) {
      const activeSec = Number(this.getSetting('poll_interval_active'));
      const idleSec = Number(this.getSetting('poll_interval_idle'));
      if (activeSec || idleSec) {
        coordinator.updateIntervals(activeSec, idleSec);
      }
      coordinator.registerChargerDevice(this);
    }
  }

  /**
   * Called by PollingCoordinator when new charger data is available.
   */
  async onChargerData(charger: JouloCharger): Promise<void> {
    const isCharging =
      charger.is_charging === true ||
      charger.status === 'charging' ||
      charger.status === 'active';

    // 1. evcharger_charging (boolean)
    await this.setCapabilityValue('evcharger_charging', isCharging);

    // 2. meter_power (cumulative kWh)
    if (typeof charger.latest_meter_wh === 'number') {
      const meterKwh = Number((charger.latest_meter_wh / 1000).toFixed(2));
      await this.setCapabilityValue('meter_power', meterKwh);
    }

    // 3. meter_session_kwh (current or recent session kWh, retained across idle/restarts)
    if (
      charger.current_session?.kwh_so_far !== undefined &&
      charger.current_session.kwh_so_far !== null
    ) {
      await this.setCapabilityValue('meter_session_kwh', charger.current_session.kwh_so_far);
    }

    // 4. measure_power (instantaneous power in Watts)
    let powerWatts = 0;
    if (isCharging) {
      const now = Date.now();
      if (
        this.lastMeterWh !== null &&
        this.lastMeterTime !== null &&
        typeof charger.latest_meter_wh === 'number'
      ) {
        const deltaWh = charger.latest_meter_wh - this.lastMeterWh;
        const deltaHours = (now - this.lastMeterTime) / 3600000;
        if (deltaHours > 0 && deltaWh > 0) {
          powerWatts = Math.round(deltaWh / deltaHours);
        }
      }

      if (
        powerWatts === 0 &&
        charger.current_session?.started_at &&
        typeof charger.current_session.kwh_so_far === 'number' &&
        charger.current_session.kwh_so_far > 0
      ) {
        const startMs = new Date(charger.current_session.started_at).getTime();
        const durationHours = (now - startMs) / 3600000;
        if (durationHours > 0) {
          powerWatts = Math.round(
            (charger.current_session.kwh_so_far * 1000) / durationHours,
          );
        }
      }
    }

    if (typeof charger.latest_meter_wh === 'number') {
      this.lastMeterWh = charger.latest_meter_wh;
      this.lastMeterTime = Date.now();
    }

    await this.setCapabilityValue('measure_power', powerWatts);
  }

  /**
   * Called by PollingCoordinator on prolonged failure or authentication error.
   */
  async onCoordinatorError(message: string, isAuthError: boolean): Promise<void> {
    if (isAuthError) {
      await this.setUnavailable('Invalid or expired Bearer token. Please update in Joulo Account settings.');
    } else {
      await this.setUnavailable(message);
    }
  }

  /**
   * Called by PollingCoordinator when communication is restored.
   */
  async onCoordinatorAvailable(): Promise<void> {
    await this.setAvailable();
  }

  /**
   * onSettings is called when user updates settings.
   */
  override async onSettings({
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log('ChargerDevice settings changed:', changedKeys);
    const coordinator = this.getCoordinator();
    if (coordinator) {
      const active = Number(newSettings['poll_interval_active']);
      const idle = Number(newSettings['poll_interval_idle']);
      coordinator.updateIntervals(active, idle);
    }
  }

  /**
   * onDeleted is called when the device is deleted.
   */
  override async onDeleted(): Promise<void> {
    const coordinator = this.getCoordinator();
    if (coordinator) {
      coordinator.unregisterChargerDevice(this);
    }
    this.log(`ChargerDevice ${this.getName()} deleted`);
  }
}

export = ChargerDevice;

