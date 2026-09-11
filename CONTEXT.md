# Domain Context: Homey Joulo

Integratie tussen de Nederlandse ERE (Emissiereductie-eenheden) inboekdienstverlener **Joulo** en het **Homey** smart home platform.

## Glossary

- **Joulo**: Een door de Nederlandse Emissieautoriteit (NEa) geregistreerde inboekdienstverlener voor ERE's (Emissiereductie-eenheden). Joulo registreert en monetiseert thuisgeladen elektriciteit van elektrische voertuigen (EV's) conform de Europese RED III-richtlijn.
- **ERE (Emissiereductie-eenheid)**: Certificaten die de vermeden CO₂-uitstoot van hernieuwbaar geladen elektriciteit vertegenwoordigen. Deze eenheden worden door Joulo verkocht aan brandstofleveranciers.
- **MID-meter (Measuring Instruments Directive)**: Een gecertificeerde energiemeter in of bij het laadstation die wettelijk vereist is om laadsessies in te mogen boeken als officiële ERE's.
- **Bearer Token**: Een persoonlijke API-sleutel die de gebruiker aanmaakt in het Joulo Dashboard (`Settings → API`) om veilige toegang te verlenen aan externe integraties.
- **OAuth2 PKCE**: Het officiële authenticatieprotocol van Joulo voor third-party applicaties. Vereist een geregistreerd `client_id` en pre-registered redirect URI vanuit Joulo (gepland voor toekomstige versies zodra Joulo partner-credentials verstrekt).
- **Joulo Account Device**: Een Homey apparaat dat de overkoepelende statistieken van het Joulo-account toont (totaal geregistreerde kWh over alle laadpalen, actueel ERE creditsaldo, geschatte financiële opbrengst in EUR).
- **Joulo Charger Device**: Een Homey apparaat (klasse `evcharger`) dat een specifieke fysieke laadpaal representeert met live vermogen (`measure_power`), totaal cumulatief verbruik (`meter_power`), laadstatus (`evcharger_charging`), en huidige/laatste sessie (`meter_session_kwh`).
- **Centrale App-level Poller**: Een gedeelde client binnen de Homey app die periodiek de Joulo API aanroept (`GET /chargers` en `GET /energy`) en de data centraal distribueert naar de gekoppelde apparaten, om dubbele API-aanroepen en rate-limiting te voorkomen.
- **Adaptieve Polling**: Het dynamisch aanpassen van de poll-frequentie: standaard 60 seconden tijdens een actieve laadsessie en 5 minuten (300 seconden) in standby/idle.

## Architecture Guidelines

- **App ID**: `com.vanderdeijl.homey.joulo`
- **TypeScript**: Strict mode enabled (`strict: true`, `noImplicitAny: true`, etc.). Doelplatform ES2022 (compatibel met Homey Pro Node.js v18/v22 runtime).
- **Homey Apps SDK**: SDK v3 met declarative manifest (`app.json` / Homey Compose).
- **Foutafhandeling**: Apparaatwaarden blijven persistent bewaard in Homey (`setCapabilityValue`). Bij langdurige API-onbereikbaarheid wordt `device.setUnavailable()` geactiveerd om de rode foutstatus in de Homey UI weer te geven.
