# ADR 0002: Centrale App-Level Polling en Caching

## Status
Accepted

## Context
De Joulo REST API biedt geen individuele endpoints per lader (geen `GET /chargers/:id`), maar retourneert via `GET /chargers` een array van alle gekoppelde laadpalen. Daarnaast is er een apart endpoint `GET /energy` voor account-statistieken.

Wanneer meerdere apparaten (Account en 1 of meerdere Chargers) in Homey onafhankelijk van elkaar zouden pollen, leidt dit tot identieke netwerkaanroepen, onnodige netwerkoverhead en risico op rate-limiting door Joulo.

## Besluit
We implementeren een centrale polling-coördinator op applicatieniveau (`JouloApp` of centrale client-service):
- De coördinator voert periodiek de noodzakelijke API-aanroepen uit.
- De poll-frequentie is adaptief: standaard 60 seconden tijdens een actieve laadsessie en 5 minuten (300 seconden) in standby/idle (instelbaar in apparaatinstellingen).
- Ontvangen data wordt direct gedistribueerd naar de geregistreerde apparaten in Homey.

## Gevolgen
- Minimaal aantal externe API-calls.
- Gegarandeerd synchrone data tussen Account- en Charger-apparaten in Homey.
