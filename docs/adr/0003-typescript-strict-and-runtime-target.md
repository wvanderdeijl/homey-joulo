# ADR 0003: Strikte TypeScript Configuratie en Node.js Runtime Target

## Status
Accepted

## Context
De Homey app moet robuust, type-veilig en onderhoudbaar zijn. Athom Homey Pro devices (2016-2019, Early 2023 en nieuwer) draaien op Node.js runtimes (Node.js 18 / Node.js 22 afhankelijk van de firmware).

We willen moderne TypeScript functionaliteiten en de meest strikte typechecking gebruiken, maar voorkomen dat de gegenereerde JavaScript syntax bevat die niet wordt ondersteund door de doel-runtimes van Homey.

## Besluit
1. **TypeScript Striktheid**: We configureren `tsconfig.json` met maximale striktheid:
   - `strict: true`
   - `noImplicitAny: true`
   - `strictNullChecks: true`
   - `noUnusedLocals: true`
   - `noUnusedParameters: true`
   - `exactOptionalPropertyTypes: true`
2. **Compiler Target**: 
   - `target: "ES2022"` (ondersteund door Node.js 18+ en Node.js 22).
   - `module: "CommonJS"` of `moduleResolution: "Node"`.
3. **Build Pipeline**:
   - TypeScript code leeft in de projectstructuur (`app.ts`, `lib/**/*.ts`, `drivers/**/*.ts`) en compileert naar geldige Node.js code in `.homeybuild/` conform de Homey Apps SDK v3 structuur.
   - `package.json` bevat `npm run build` (`tsc`) en `homey app validate` voor CI/CD en lokale checks.

## Gevolgen
- Hoogst mogelijke typeveiligheid tijdens ontwikkeling.
- Gegarandeerde runtime-compatibiliteit met Homey Pro (Early 2023 en recente Homey OS updates).
