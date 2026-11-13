# Changelog

## [0.7.0] - 2026-11-13

- `npm run update-ecc -- <tag-o-commit>`: updater seguro y reproducible de ECC.
- `ecc.lock` fija repo, tag, commit y versión usados por el build; `sourceRef` se estampa en `config/agents-generated.json`.
- `./ecc` convertido de clon shallow a clon completo para checkout de tags.
- Reportes `docs/pi-port/update-<fecha>.md` con allowlist/renombres, skills nuevas, commands, hooks.json, scripts y riesgo de contrato de hooks.
- Overlays en `overlays/skills/<name>/` con aviso cuando cambia la skill base de ECC.
- Rollback automático de checkout + artefactos + lock si falla el build o los tests.
- Nuevos tests: helpers de update, overlays y flujo de update/rollback con repos git locales (31 tests).
- Repo publicable como `ecc-pi-port`: `npm run setup` (clona ECC + build + tests), README en inglés/español con badges, CI/release workflows, `release:check` y `prepublishOnly`.
- `./ecc` pasa a estar gitignored y se recrea desde `ecc.lock`.
- Publicado en npm: `ecc-pi-port@0.7.0` (maintainer `andresarreguydev`).

## [0.6.0] - 2026-11-13

- Primera release instalable del port de ECC a Pi (etapas 1–6).
- `package.json` con manifest `pi` (extensions, skills, prompts) y atribución MIT a ECC.
- `npm run build` único: regenera `skills/`, `rules/`, `prompts/` y `config/agents-generated.json` desde `./ecc`.
- Nueva extensión `ecc-rules`: inyecta reglas de ECC por stack (`ECC_PI_RULES`, `/ecc-rules`).
- Hooks adapter extraído a `lib/ecc-hooks-core.ts` con tests de payloads y gating.
- Smoke tests sin LLM: generadores, reglas, hooks (incluye ejecución real de `pre:bash:dispatcher`), registro de `run_agent`.
- Instalación local verificada con `pi install` en un proyecto limpio.
- README en español + checklist de seguridad (`SECURITY.md`).

## [0.5.0]

- Etapa 5: flujo SDD (`ecc-sdd`) con modelos por fase y tracking de costos.

## [0.4.0]

- Etapa 4: `run_agent` con agentes ECC en subprocesos `pi` aislados.

## [0.3.0]

- Etapa 3: adaptador de hooks ECC → eventos de Pi.

## [0.2.0]

- Etapa 2: comandos ECC convertidos a prompt templates.

## [0.1.0]

- Etapa 1: recon y base del port.
