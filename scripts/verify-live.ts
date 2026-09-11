#!/usr/bin/env node
/**
 * Verification script to test JouloClient against a live Joulo account.
 *
 * Usage:
 *   JOULO_TOKEN="joulo_xxx" npx tsx scripts/verify-live.ts
 *
 * Optional charger reboot test:
 *   JOULO_TOKEN="joulo_xxx" JOULO_TEST_REBOOT_CHARGER_ID="charger-uuid" npx tsx scripts/verify-live.ts
 */

import {
  JouloClient,
  JouloAuthError,
  JouloCooldownError,
  JouloOfflineError,
  JouloRateLimitError,
  JouloNetworkError,
  JouloServerError,
  JouloApiError,
} from '../lib/joulo-client';
import type { JouloRebootType } from '../lib/types';

async function main() {
  const token = process.env.JOULO_TOKEN;

  if (!token) {
    console.error(`
================================================================================
Joulo Live API Verification
================================================================================

⚠️  No JOULO_TOKEN environment variable provided.

To test against your live Joulo account and EV charger (e.g. Peblar):
  1. Open https://joulo.nl/dashboard
  2. Navigate to Settings → API and copy your Bearer Token.
  3. Run:
     JOULO_TOKEN="your_token_here" npx tsx scripts/verify-live.ts

Optional charger reboot test:
  JOULO_TOKEN="your_token" JOULO_TEST_REBOOT_CHARGER_ID="uuid" npx tsx scripts/verify-live.ts
================================================================================
`);
    process.exit(1);
  }

  console.log('🔄 Initializing JouloClient with live token...');
  const client = new JouloClient({ token });

  try {
    console.log('\n📡 1. Fetching linked chargers (GET /chargers)...');
    const chargers = await client.getChargers();
    console.log(`✅ Found ${chargers.length} charger(s):`);
    for (const charger of chargers) {
      console.log(`   - [${charger.status}] ${charger.nickname || charger.name || 'Unnamed'} (ID: ${charger.id})`);
      console.log(`     Connection: ${charger.connection_type || 'unknown'} | MID Certified: ${charger.mid_certified ? 'Yes' : 'No'} | Charging: ${charger.is_charging ? 'Yes' : 'No'}`);
      if (charger.latest_meter_wh !== undefined) {
        console.log(`     Meter reading: ${(charger.latest_meter_wh / 1000).toFixed(2)} kWh (updated: ${charger.meter_updated_at || 'unknown'})`);
      }
      if (charger.current_session) {
        console.log(`     ⚡ Active session: ${charger.current_session.kwh_so_far} kWh so far, RFID: ${charger.current_session.id_tag || 'none'}`);
      }
    }

    console.log('\n📊 2. Fetching energy aggregates (GET /energy)...');
    const energy = await client.getEnergy();
    console.log('✅ Energy overview:');
    console.log(`   - Lifetime MID kWh: ${energy.total_kwh} kWh`);
    console.log(`   - Lifetime ERE Credits: ${energy.total_ere_credits}`);
    console.log(`   - Lifetime Sessions: ${energy.total_sessions}`);
    if (energy.total_kwh_all !== undefined) {
      console.log(`   - Total (all chargers): ${energy.total_kwh_all} kWh (${energy.total_sessions_all} sessions)`);
    }
    if (energy.months && energy.months.length > 0) {
      console.log(`   - History available for ${energy.months.length} month(s). Latest month (${energy.months[0].month}): ${energy.months[0].kwh} kWh, ${energy.months[0].ere_credits} ERE`);
    }

    console.log('\n⏱️ 3. Fetching recent sessions (GET /sessions?limit=5)...');
    const sessions = await client.getSessions({ limit: 5 });
    console.log(`✅ Retrieved ${sessions.length} session(s):`);
    for (const session of sessions) {
      console.log(`   - Session ${session.id.substring(0, 8)}...: ${session.kwh} kWh | ${session.ere_credits ?? 0} ERE | Started: ${session.started_at}`);
    }

    const testRebootId = process.env.JOULO_TEST_REBOOT_CHARGER_ID;
    if (testRebootId) {
      const rebootType = (process.env.JOULO_TEST_REBOOT_TYPE as JouloRebootType) || 'Soft';
      console.log(`\n🔌 4. Testing reboot for charger ${testRebootId} (${rebootType})...`);
      const rebootResult = await client.rebootCharger(testRebootId, rebootType);
      console.log(`✅ Reboot request dispatched (HTTP ${rebootResult.status}): confirmed_by_boot=${rebootResult.confirmed_by_boot}`);
    } else {
      console.log('\n💡 Tip: To test charger reboot, specify JOULO_TEST_REBOOT_CHARGER_ID="<id>"');
    }

    console.log('\n✨ All live endpoints verified successfully!');
  } catch (error) {
    if (error instanceof JouloAuthError) {
      console.error(`\n❌ Authentication error (HTTP ${error.statusCode}): ${error.message}`);
      if (error.requiredScope) {
        console.error(`   Required scope: ${error.requiredScope}`);
      }
    } else if (error instanceof JouloCooldownError) {
      console.error(`\n⏳ Reboot cooldown active (HTTP 409): ${error.message}`);
    } else if (error instanceof JouloOfflineError) {
      console.error(`\n🔌 Charger or service offline (HTTP ${error.statusCode}): ${error.message}`);
    } else if (error instanceof JouloRateLimitError) {
      console.error(`\n🛑 Rate limit exceeded (HTTP 429): ${error.message} (Retry after: ${error.retryAfterSeconds ?? 'unknown'}s)`);
    } else if (error instanceof JouloServerError) {
      console.error(`\n💥 Joulo upstream server error (HTTP ${error.statusCode}): ${error.message}`);
    } else if (error instanceof JouloNetworkError) {
      console.error(`\n🌐 Network transport error: ${error.message}`);
    } else if (error instanceof JouloApiError) {
      console.error(`\n❌ Joulo API error: ${error.message}`);
    } else {
      console.error('\n❌ Unexpected error:', error);
    }
    process.exit(1);
  }
}

main();
