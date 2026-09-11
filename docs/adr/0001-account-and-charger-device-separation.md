# ADR 0001: Scheiding van Account en Charger Apparaten

## Status
Accepted

## Context
Gebruikers van Joulo kunnen één of meerdere laadpalen gekoppeld hebben aan hun Joulo account. Daarnaast houdt Joulo geaggregeerde totalen bij voor het gehele account (totaal geladen kWh, opgebouwde ERE-credits en financiële uitbetalingen in EUR).

Als alle statistieken op het laadpaal-apparaat worden getoond, ontstaat er verwarring bij gebruikers met meerdere laadpalen doordat account-totalen dubbel zichtbaar zijn.

## Besluit
We splitsen de functionaliteit op in twee aparte Homey drivers:
1. **Joulo Account (`account`)**: Toont de overkoepelende accountstatistieken (`meter_power`, `ere_credits`, `ere_earnings`).
2. **Joulo Laadpaal (`charger`)**: Toont de specifieke laadpaal met klasse `evcharger` (`measure_power`, `meter_power`, `evcharger_charging`, `meter_session_kwh`) en bevat de herstart-acties.

Tijdens de pairing flow kan de gebruiker het account-apparaat en/of de gevonden laadpaal-apparaten selecteren en toevoegen.

## Gevolgen
- Duidelijke scheiding tussen financiële/account totalen en fysieke laadpaalmetingen.
- Flexibel voor gebruikers met zowel 1 als meerdere laders.
