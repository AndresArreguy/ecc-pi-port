# Changelog

## [Unreleased]

- **Subset completo de agentes**: `config/agents-subset.json` pasa de 6 a los 68 agentes de `ecc/agents/` (28 con `write`/`edit`, 40 de sólo lectura). Se regenera con `npm run build` (no `build:agents` solo, que deja `sourceRef` en null y rompe `build:check`).
- **Límites por agente**: `config/agents-models.json` sube los defaults a `maxTurns: 25`, `timeoutMs: 600000`, `maxParallel: 3` y fija overrides para los que escriben (`tdd-guide`, `code-simplifier`, `refactor-cleaner` 40/15 min; `e2e-runner` 45/20 min; `build-error-resolver` 30/10 min).
- **`/ecc-models`** reemplaza a `/sdd-model` (que queda como alias, junto con `/sdd-models`) y suma una **sección de agentes**: `Tab` alterna fases/agentes, `/` filtra por nombre, `PgUp`/`PgDn` recorren el roster y `Ctrl+S` persiste fases y pines en sus dos archivos. Nunca toca `maxTurns`/`timeoutMs`/comentarios.
- **Perfiles con agentes**: `SddProfile.agents` guarda el pin de cada subagente, así cargar un perfil restaura fases *y* modelos de agentes. Los límites quedan fuera del perfil a propósito.
- **Routing por intención**: `lib/ecc-agent-routing.ts` define 12 rutas (plan, feature, bug, build, review, security, cleanup, performance, a11y, tests, docs, ship) con guardrails, y `extensions/ecc-agents.ts` las renderiza en las `promptGuidelines` de `run_agent`. El routing viaja con el tool (sobrevive compactación) en vez de depender de una tabla en un doc.
- **Los prompts de comando vuelven a delegar**: la degradación estaba hardcodeada en `adaptBody` (`scripts/lib/generate-prompts.ts`). `plan` → `planner`; `feature-dev` → `code-explorer → architect → tdd-guide → code-reviewer` y pasa a `status: ready`; `code-review` → `code-reviewer` + reviewer del stack + `security-reviewer`; `test-coverage` → `pr-test-analyzer` + `tdd-guide`; `prp-implement` → `tdd-guide` / `build-error-resolver`; `quality-gate` → `build-error-resolver` cuando falla algo más que formato.
- `tests/pi-port/agent-routing.test.ts`: valida que cada agente de las rutas exista en el subset generado, que el bloque renderizado no pase de 22 líneas y que ningún prompt generado tenga frases anti-delegación.
- Nueva capa testeable `lib/ecc-agent-models.ts` (roster, snapshots, merge con límites preservados) y stubs de `pi-tui` para poder importar la extensión en tests (`tests/pi-port/ecc-sdd-registration.test.ts`).


## [0.8.0] - 2026-11-16

- Contribución: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, reporte privado en `SECURITY.md` y templates de issues/PR.
- README: banner **ECC for Pi** (assets/banner.png + SVG) y preview para la galería de paquetes de Pi (`pi.image`).
- `run_agent` ahora resuelve el provider/modelo del hijo desde `PI_PROVIDER`/`PI_MODEL` y, si faltan, desde `~/.pi/agent/settings.json` (`defaultProvider`/`defaultModel`, override con `PI_CODING_AGENT_DIR`). Antes leía `~/.pi/settings.json`, que no es el settings del agente: el child podía caer a un provider sin crédito y no cargar `pi-<provider>-provider`. El test del config shipped ahora acepta cualquier idioma válido (`auto|es|en`), no solo `auto`.
- `/sdd-model` (alias `/sdd-models`) ahora edita **todas las fases en una sola pantalla**: una fila por fase (`spec`, `plan`, `implement`, `review`, `verify`, `light`) con columnas de modelo y thinking.
- `Ctrl+S` guarda la configuración activa; `Ctrl+P` guarda el estado actual como **perfil con nombre** desde la misma pantalla. `Esc` cierra sin autoguardar.
- Perfiles/presets persistentes en `config/sdd-models.json` (`profiles`, `activeProfile`): guardar, cargar, listar y eliminar desde el menú o con `/sdd-model save|load|delete|profiles`.
- El selector de modelo permite búsqueda fuzzy, "sin override" y entrada manual `provider/model`.
- `ECC_PI_SDD_CONFIG` permite apuntar la config a otra ruta (tests/proyectos).
- **i18n propia** para la UI de SDD: `auto | es | en` con precedencia `ECC_PI_SDD_LANG` > `language` del config > locale del sistema. Pi no tiene locale de TUI, así que se detecta con `LANG`/`LC_ALL` e `Intl`; locales `es*` → español, el resto → inglés. Se cambia desde el menú (`Idioma / Language…`) o con `/sdd-model language auto|es|en`.
- Nueva lógica pura en `lib/ecc-sdd-config.ts` con tests de normalización, snapshots de perfiles y resúmenes. Los errores de perfiles ahora son códigos traducibles en `lib/ecc-sdd-i18n.ts`.

## [0.7.1] - 2026-11-16

- `run_agent` funciona con el modelo barato de la sesión: el orquestador ahora agrega un **contrato de runtime** al system prompt de cada agente (tools reales en minúscula, `read`/`grep`/`find`/`ls`, se invocan como llamada y no escribiendo XML/JSON) y recuerda lo mismo en el prompt de la tarea. Sin eso, un modelo barato imprimía el llamado de tool como texto y el turno terminaba sin leer ni responder.
- El hijo carga automáticamente la extensión del provider de la sesión (`pi-<provider>-provider`, override con `ECC_PI_EXTENSIONS`): `--no-extensions` apagaba providers que no son built-in y el child caía a un default sin credenciales.
- Sin pin por agente, el hijo hereda `PI_PROVIDER`/`PI_MODEL` de la sesión en lugar de resolver un provider por su cuenta.
- Estados honestos en el resultado: `status=provider_error` y `status=empty` con el mensaje del provider, en vez de `status=ok` con cero texto (un 402 se reportaba como éxito).
- Probado con `deepseek-v4.1-flash`: planner (58 llamadas de tool), code-reviewer, security-reviewer, architect y tdd-guide llaman tools y terminan en texto.

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
