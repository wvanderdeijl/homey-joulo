/**
 * Joulo API Type Definitions
 * Based on official Joulo REST API specs (https://developer.joulo.nl)
 */

export type JouloConnectionType = 'cloud_api' | 'ocpp';

export type JouloChargerStatus =
  | 'online'
  | 'charging'
  | 'active'
  | 'offline'
  | 'unavailable'
  | 'unknown';

export type JouloSessionStatus =
  | 'completed'
  | 'charging'
  | 'active'
  | 'stopped';

export type JouloRebootType = 'Soft' | 'Hard';

export interface JouloChargerSession {
  id: string;
  started_at: string;
  kwh_so_far: number;
  id_tag?: string | undefined;
}

export interface JouloCharger {
  id: string;
  nickname?: string | undefined;
  name?: string | undefined;
  connection_type?: JouloConnectionType | string | undefined;
  status: JouloChargerStatus | string;
  mid_certified?: boolean | undefined;
  is_charging?: boolean | undefined;
  current_session?: JouloChargerSession | null | undefined;
  latest_meter_wh?: number | undefined;
  meter_updated_at?: string | undefined;
}

export interface JouloChargersResponse {
  chargers?: JouloCharger[] | undefined;
}

export interface JouloSession {
  id: string;
  charger_id: string;
  charger_nickname?: string | undefined;
  started_at: string;
  ended_at?: string | null | undefined;
  kwh: number;
  status?: JouloSessionStatus | string | undefined;
  id_tag?: string | null | undefined;
  counts_for_ere?: boolean | undefined;
  ere_credits?: number | undefined;
}

export interface JouloSessionsResponse {
  sessions?: JouloSession[] | undefined;
}

export interface JouloListSessionsOptions {
  limit?: number | undefined;
  offset?: number | undefined;
  charger_id?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export interface JouloEnergyMonth {
  month: string; // 'YYYY-MM'
  kwh: number;
  ere_credits: number;
  sessions: number;
  kwh_all?: number | undefined;
  sessions_all?: number | undefined;
}

export interface JouloEnergyResponse {
  total_kwh: number;
  total_ere_credits: number;
  total_sessions: number;
  total_kwh_all?: number | undefined;
  total_sessions_all?: number | undefined;
  months?: JouloEnergyMonth[] | undefined;
}

export interface JouloRebootOptions {
  charger_id: string;
  type?: JouloRebootType | undefined;
}

export interface JouloRebootResponse {
  success: boolean;
  status: 200 | 202;
  confirmed_by_boot?: boolean | undefined;
  message?: string | undefined;
}

export interface JouloErrorResponse {
  error?: string | undefined;
  message?: string | undefined;
  required_scope?: string | undefined;
}
