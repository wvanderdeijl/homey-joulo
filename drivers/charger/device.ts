import Homey from 'homey';
import type {
  PollingCoordinator,
  ChargerDeviceReceiver,
} from '../../lib/polling-coordinator';
import type { JouloCharger, JouloRebootType } from '../../lib/types';
import {
  JouloAuthError,
  JouloCooldownError,
  JouloOfflineError,
} from '../../lib/joulo-client';

/**
 * Standard conversion heuristic: ~3 kWh per ERE credit.
 */
const DEFAULT_KWH_PER_ERE_CREDIT = 3.0;

interface ActiveSessionState {
  id: string | null;
  startedAt: number | null;
  idTag: string;
  kwh: number;
}

class ChargerDevice extends Homey.Device implements ChargerDeviceReceiver {
  private lastMeterWh: number | null = null;
  private lastMeterTime: number | null = null;

  // Flow triggers and session tracking
  private wasCharging: boolean | null = null;
  private activeSession: ActiveSessionState | null = null;

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
      void coordinator.poll?.();
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

    const currentSession = charger.current_session;

    // Detect session started:
    // Only fire when transitioning from known idle (false) to charging,
    // or when already charging and a distinctly new session ID is reported.
    // Avoid false positive on initial Homey app startup when wasCharging is null.
    const isNewSession = Boolean(
      this.wasCharging === true &&
      currentSession?.id &&
      this.activeSession?.id &&
      currentSession.id !== this.activeSession.id,
    );

    if ((this.wasCharging === false && isCharging) || isNewSession) {
      this.log(`Charging session started for charger ${this.getName()}`);
      void this.triggerSessionStarted();
    }

    if (isCharging) {
      const startedAt = currentSession?.started_at
        ? new Date(currentSession.started_at).getTime()
        : this.activeSession?.startedAt ?? Date.now();

      this.activeSession = {
        id: currentSession?.id ?? this.activeSession?.id ?? null,
        startedAt,
        idTag: currentSession?.id_tag ?? this.activeSession?.idTag ?? '',
        kwh: typeof currentSession?.kwh_so_far === 'number'
          ? currentSession.kwh_so_far
          : this.activeSession?.kwh ?? 0,
      };
    }

    // Detect session completed (transition from active charging to idle)
    if (this.wasCharging === true && !isCharging) {
      this.log(`Charging session completed for charger ${this.getName()}`);
      const durationMs = this.activeSession?.startedAt
        ? Math.max(0, Date.now() - this.activeSession.startedAt)
        : 0;
      const durationMinutes = Math.max(1, Math.round(durationMs / 60000));
      const totalKwh = this.activeSession?.kwh ?? 0;

      // Only MID-certified chargers earn official ERE credits per RED III / CONTEXT.md
      const isMidCertified = charger.mid_certified !== false;
      const ereEarned = isMidCertified
        ? Number((totalKwh / DEFAULT_KWH_PER_ERE_CREDIT).toFixed(2))
        : 0;
      const idTag = this.activeSession?.idTag ?? '';

      void this.triggerSessionCompleted({
        kwh_total: totalKwh,
        session_duration: durationMinutes,
        ere_earned: ereEarned,
        id_tag: idTag,
      });

      this.activeSession = null;
    }

    this.wasCharging = isCharging;

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
   * Trigger the "charger_session_started" Flow card.
   */
  public async triggerSessionStarted(): Promise<void> {
    try {
      const card = this.homey.flow.getDeviceTriggerCard('charger_session_started');
      await card.trigger(this);
    } catch (err) {
      this.error('Failed to trigger charger_session_started:', err);
    }
  }

  /**
   * Trigger the "charger_session_completed" Flow card with session tokens.
   */
  public async triggerSessionCompleted(tokens: {
    kwh_total: number;
    session_duration: number;
    ere_earned: number;
    id_tag: string;
  }): Promise<void> {
    try {
      const card = this.homey.flow.getDeviceTriggerCard('charger_session_completed');
      await card.trigger(this, tokens);
    } catch (err) {
      this.error('Failed to trigger charger_session_completed:', err);
    }
  }

  /**
   * Reboot the charger remotely via Joulo OCPP gateway.
   */
  public async reboot(type: JouloRebootType): Promise<void> {
    const client = this.getCoordinator()?.getClient();
    if (!client) {
      throw new Error(this.homey.__('errors.client_unavailable') || 'Joulo API client is not configured.');
    }

    try {
      const response = await client.rebootCharger(this.getChargerId(), type);
      this.log(`Reboot (${type}) triggered for charger ${this.getName()}: status ${response.status}`);
    } catch (err) {
      if (err instanceof JouloCooldownError) {
        throw new Error(this.homey.__('errors.reboot_cooldown') || 'Charger was rebooted recently. A 5-minute cooldown is required between reboots.');
      }
      if (err instanceof JouloOfflineError) {
        throw new Error(this.homey.__('errors.charger_offline') || 'Charger is currently offline or unreachable.');
      }
      if (err instanceof JouloAuthError) {
        throw new Error(this.homey.__('errors.auth_error') || 'Authentication failed. Please verify Bearer token in Joulo Account settings.');
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
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

