# Issue tracker: GitHub (Separate Private Issues Repo)

Issues, specs en wayfinding voor dit project leven in de **private** repository `wvanderdeijl/homey-joulo-design`.
De broncode staat in de publieke repository `wvanderdeijl/homey-joulo`.

Gebruik altijd expliciet de `--repo wvanderdeijl/homey-joulo-design` vlag bij `gh` commando's.

## Conventions

- **Create an issue / spec**: `gh issue create --repo wvanderdeijl/homey-joulo-design --title "..." --body "..."`
- **Read an issue**: `gh issue view --repo wvanderdeijl/homey-joulo-design <number> --comments`
- **List issues**: `gh issue list --repo wvanderdeijl/homey-joulo-design --state open --json number,title,body,labels,comments`
- **Comment on an issue**: `gh issue comment --repo wvanderdeijl/homey-joulo-design <number> --body "..."`
- **Apply / remove labels**: `gh issue edit --repo wvanderdeijl/homey-joulo-design <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close --repo wvanderdeijl/homey-joulo-design <number> --comment "..."`

## Pull requests as a triage surface

PRs as a request surface: no.

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `wvanderdeijl/homey-joulo-design`.

## When a skill says "fetch the relevant ticket"

Run `gh issue view --repo wvanderdeijl/homey-joulo-design <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets in `wvanderdeijl/homey-joulo-design`.

- **Map**: `gh issue create --repo wvanderdeijl/homey-joulo-design --label wayfinder:map`
- **Child ticket**: `gh issue create --repo wvanderdeijl/homey-joulo-design ...`
- **Frontier query**: list open children in `wvanderdeijl/homey-joulo-design`.
