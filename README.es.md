# ECC para Pi

[English](README.md) · **Español**

Trae el núcleo portable de ingeniería de [Everything Claude Code (ECC)](https://github.com/affaan-m/ECC)
a [Pi](https://pi.dev): skills curadas, comandos como prompt templates, reglas de
código, adaptador de hooks, runner de agentes aislado y flujo SDD — empaquetado
como un paquete real de Pi.

[![CI](https://github.com/AndresArreguy/ecc-pi-port/actions/workflows/ci.yml/badge.svg)](https://github.com/AndresArreguy/ecc-pi-port/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/ecc-pi-port?logo=npm)](https://www.npmjs.com/package/ecc-pi-port)
[![npm downloads](https://img.shields.io/npm/dm/ecc-pi-port)](https://www.npmjs.com/package/ecc-pi-port)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Pi package](https://img.shields.io/badge/Pi-package-8A2BE2)](https://pi.dev/packages)
[![ECC](https://img.shields.io/badge/ECC-v2.2.3-orange)](https://github.com/affaan-m/ECC)
[![Stars](https://img.shields.io/github/stars/AndresArreguy/ecc-pi-port?style=social)](https://github.com/AndresArreguy/ecc-pi-port)

- **Fuente ECC:** [`affaan-m/ECC`](https://github.com/affaan-m/ECC) v2.2.3 (MIT, © 2026 Affaan Mustafa).
- **Este port:** adaptadores, generadores, empaquetado y docs (MIT, © 2026 BaráDev).
- `skills/`, `prompts/` y `rules/` generadas son contenido curado de ECC bajo la
  misma licencia MIT. Ver [`LICENSE`](LICENSE).

> Estado y pendientes: [`docs/pi-port/STATUS.md`](docs/pi-port/STATUS.md).
> Checklist de seguridad: [`SECURITY.md`](SECURITY.md).
> Notas de la release base: [`docs/pi-port/06-release.md`](docs/pi-port/06-release.md).

## ¿Es realmente un paquete de Pi?

Sí. `package.json` declara el manifest `pi` (`extensions`, `skills`, `prompts`),
la keyword `pi-package` y las peer dependencies de Pi. Una vez publicado se
instala con `pi install npm:ecc-pi-port` y es elegible para la
[galería de paquetes de Pi](https://pi.dev/packages).

## Requisitos

- Pi `1.5.x` o superior.
- Node.js `>= 22.6` para buildear/testear desde el repo (Pi carga las extensiones
  TypeScript con su propio runtime).
- `git` + red para `npm run setup` / `npm run update-ecc` (ECC se clona desde
  GitHub y queda fijado en `ecc.lock`).

## Instalación

### Desde npm (recomendada)

```bash
pi install npm:ecc-pi-port
```

Se agrega a `~/.pi/agent/settings.json`. Usá `-l` desde la raíz de un proyecto
para escribir `.pi/settings.json`.

### Desde el repo

```bash
git clone https://github.com/AndresArreguy/ecc-pi-port.git
cd ecc-pi-port

# un solo comando: instala deps, clona ECC en el commit del lock,
# rebuildea todos los artefactos y corre los smoke tests
npm run setup

pi install .
```

`npm run setup` es idempotente: reutiliza `./ecc`, verifica que coincida con
`ecc.lock`, hace fetch de tags y rebuildea. Flags útiles:

```bash
npm run setup -- --skip-tests
npm run setup -- --skip-install
npm run setup -- --ecc-ref v2.2.3   # primer bootstrap sin ecc.lock
```

Probar sin instalar:

```bash
pi -e .
```

### Primeros chequeos dentro de Pi

```text
/ecc-rules            # lista/inyecta reglas ECC por stack
/plan-prd             # spec/PRD
/plan                 # plan de implementación
/sdd-spec <feature>   # flujo SDD
```

## Qué incluye

| Recurso | Cantidad | Detalle |
|---|---|---|
| Skills | 123 | Curadas con el manifest `pi-core.json` de ECC (lenguajes, testing, review, seguridad defensiva, planificación, docs, git/PR). `council` se publica como `ecc-council`. |
| Prompt commands | 7 | `/plan-prd`, `/plan`, `/prp-implement`, `/feature-dev`, `/code-review`, `/test-coverage`, `/quality-gate`. |
| Reglas | 22 stacks · 121 archivos | `common` + TypeScript, React, Python, Go, Rust, Java, Kotlin, PHP, Ruby, Swift, C#, C++, Dart, Vue, Nuxt, Angular, Perl, F#, ArkTS, Web, React Native. |
| Extensiones | 4 | `ecc-hooks`, `ecc-rules`, `ecc-agents`, `ecc-sdd`. |
| Agentes | 6 | `planner`, `code-reviewer`, `security-reviewer`, `build-error-resolver`, `tdd-guide`, `architect` vía tool `run_agent`. |
| Hooks | 5 activos / 4 opcionales | `session:start`, `session:end:marker`, `pre:bash:dispatcher`, `post:quality-gate`, `stop:format-typecheck`. |
| Flujo SDD | 6 comandos | `/sdd-model`, `/sdd-spec`, `/sdd-plan`, `/sdd-implement`, `/sdd-review`, `/sdd-verify`. |

### Comandos

```text
/plan-prd        PRD / spec liviana
/plan            plan de implementación (espera confirmación)
/prp-implement   ejecuta un plan con loops de validación
/feature-dev     feature end-to-end (inline o vía run_agent)
/code-review     review local; modo PR requiere gh + red
/test-coverage   análisis y completado de cobertura
/quality-gate    gate de formatter (hook o fallback inline)
```

Los templates conservan rutas `.claude/` de ECC por compatibilidad.

### Hooks

| Hook | Evento Pi | Qué hace |
|---|---|---|
| `session:start` | `session_start` | Carga contexto de ECC e inyecta `additionalContext` en el system prompt. |
| `session:end:marker` | `session_shutdown` | Limpieza de lease de sesión/observer. |
| `pre:bash:dispatcher` | `tool_call` (bash) | Bloquea comandos peligrosos con exit code 2. |
| `post:quality-gate` | `tool_result` (edit/write) | Ejecuta el formatter del proyecto sobre el archivo editado. |
| `stop:format-typecheck` | `agent_end` | Formatea el lote editado y corre `tsc --noEmit` si hay `tsconfig.json`. |

Opcionales (apagados): `pre:compact`, `stop:session-end`,
`pre:write:doc-file-warning`, `pre:config-protection`.

### Reglas

Pi no tiene recurso nativo de reglas, así que `ecc-rules` inyecta
`rules/<stack>/*.md` en el system prompt:

```bash
ECC_PI_RULES=auto pi          # detecta por marcadores del proyecto
ECC_PI_RULES=typescript,react pi
ECC_PI_RULES=off pi
```

```text
/ecc-rules                    # lista stacks y selección actual
/ecc-rules auto
/ecc-rules typescript python
/ecc-rules off
```

`common` se incluye siempre. `ECC_PI_RULES_MAX_CHARS` limita el contenido
(default 60000).

### Agentes

`run_agent` ejecuta un agente ECC en un proceso `pi` hijo aislado (`--mode json`,
`--no-session`, `--no-extensions`, `--no-skills`, `--no-prompt-templates`,
`--no-themes`) y devuelve solo el resultado final. Los límites están en
`config/agents-models.json` (`maxTurns`, `timeoutMs`, `maxParallel`, y opcional
provider/model/thinking por agente).

### Flujo SDD

`config/sdd-models.json` elige provider/model/thinking por fase (`spec`, `plan`,
`implement`, `review`, `verify`, `light`). Los artefactos van a
`specs/<feature>/` (`spec.md`, `plan.md`, `tasks.md`, `review.md`, `verify.md`,
`costs.md`).

## Qué NO incluye

- No es ECC completo: 123/293 skills y 7/94 comandos. La curación excluye
  integraciones SaaS, hooks exclusivos de Claude Code, packs de dominio y flujos
  dependientes de `Task`.
- No hay subagentes nativos: `run_agent` usa un proceso hijo, no el `Task` de
  Claude.
- Los hooks no son 1:1. `Stop` se mapea a `agent_end` + `session_shutdown`; el
  `transcript_path` no es un transcript JSONL de Claude.
- No incluye temas, MCP servers ni providers — se usa la configuración de Pi.
- No bundlea formatters/linters ni `gh`. Los hooks pueden llamar a
  `npx`/package managers (y por lo tanto a la red) si el proyecto no tiene
  formatter.
- No hay tests end-to-end con LLM en CI; la suite cubre generadores, payloads,
  gating y registro de extensiones.

## Build y tests

```bash
npm run setup          # bootstrap (clona ECC, instala, buildea, testea)
npm run build          # regenera skills/, rules/, prompts/, agentes
npm run build:check    # falla si los artefactos están desactualizados
npm test               # 31 smoke tests, sin LLM
npm run verify         # build:check + tests
npm run verify:install # chequeo RPC contra el paquete instalado
npm run release:check  # metadata + contenido del tarball
npm run pack:dry       # inspeccionar el tarball npm
```

Pipeline:

```text
ecc/manifests/pi-core.json ──► skills/            (123 skills curadas)
ecc/rules/**               ──► rules/             (+ índice)
ecc/commands/*.md          ──► prompts/           (config/commands-allowlist.json)
ecc/agents/*.md            ──► config/agents-generated.json
ecc/VERSION + ecc.lock     ──► stamps sourceVersion/sourceRef
```

`./ecc` **no se commitea**: es un checkout git que crea `npm run setup` y queda
fijado por `ecc.lock` (repo, tag, commit, versión). `npm run build` nunca modifica
`./ecc`. Si ECC agrega una skill sin clasificar en su manifest de curación, el
build falla a propósito.

## Actualizar ECC

```bash
# solo analizar (escribe reporte, no cambia nada)
npm run update-ecc -- v2.2.4 --dry-run

# aplicar
npm run update-ecc -- v2.2.4

# también acepta un commit
npm run update-ecc -- a1b2c3d
```

El updater:

1. Verifica que `./ecc` esté limpio y que su HEAD coincida con `ecc.lock`.
2. Convierte clones shallow (`git fetch --unshallow --tags`) y hace fetch de tags.
3. Muestra los commits del rango filtrados a `skills/`, `agents/`, `commands/`,
   `hooks/`, `rules/` y `scripts/`.
4. Hace checkout de la ref pedida.
5. Rebuildea **todos** los artefactos (skills, rules, prompts, agentes, docs
   generadas) aplicando `overlays/`.
6. Corre `npm test`. Si falla el build o los tests, restaura el commit anterior
   de ECC, los artefactos generados y el lock — nunca deja el repo a medias.
7. Escribe `docs/pi-port/update-<fecha>.md` con desapariciones/renombres de la
   allowlist, skills nuevas sin clasificar, commands nuevos/eliminados, cambios
   en `hooks.json`, cambios de scripts, riesgo de contrato de entrada/salida,
   resultado de build/tests y rollback.
8. Actualiza `ecc.lock` solo en éxito.
9. Muestra un resumen y pide confirmación. **Nunca commitea.**

### Revisar cambios de hooks

- **Riesgo alto 🔴:** cambió `hookSpecificOutput`, `additionalContext`,
  `permissionDecision`, el exit code `2` (bloqueo) o un script usado por
  `lib/ecc-hooks-core.ts`. Revisá el diff y los tests del adaptador; si cambió el
  contrato, actualizá `lib/ecc-hooks-core.ts` antes de commitear.
- **Riesgo medio 🟡:** cambió `tool_input`/`tool_output`/`tool_response`,
  `hook_event_name`, stdin/stdout o el runtime (`run-with-flags.js`,
  `hook-input.js`, `hook-flags.js`). Confirmá que los payloads sigan mapeando y
  que `pre:bash:dispatcher` siga bloqueando `--no-verify`.
- **Scripts agregados/eliminados:** un script del adaptador ausente se reporta;
  actualizá `HOOK_SPECS` o desactivá ese hook.
- Después de cada update: `npm run verify:install` (skills, commands, hook de
  sesión, `run_agent`).

### Overlays

Mantené ediciones locales de una skill curada en
`overlays/skills/<nombre-de-skill-en-ecc>/`. El build usa el overlay en lugar de
la copia de ECC; el updater avisa cuando la base cambió o desapareció. Ver
[`overlays/README.md`](overlays/README.md).

## Desactivar hooks

```bash
export ECC_HOOKS_ENABLED=false          # todos los hooks de ECC
export ECC_HOOK_PROFILE=minimal         # minimal | standard | strict
export ECC_DISABLED_HOOKS=post:quality-gate,stop:format-typecheck
export ECC_PI_RULES=off                 # solo reglas
```

PowerShell: `$env:ECC_HOOKS_ENABLED = "false"`.

## Seguridad

Las extensiones corren con los permisos completos de tu usuario; los hooks
ejecutan código Node de ECC y pueden lanzar formatters/`npx`; `run_agent` hereda
el entorno y no está sandboxeado. Leé [`SECURITY.md`](SECURITY.md) antes de
instalar en otra máquina y conservá `LICENSE` (MIT del port + de ECC).

## Publicación (mantainers)

`prepublishOnly` corre `npm run verify` + `npm run release:check`, y `prepack`
corre `build:check`. Para publicar:

```bash
npm version patch|minor|major
npm publish --access public
```

El workflow de release de GitHub publica en tags `v*` usando `NPM_TOKEN`. El
tarball incluye los artefactos generados más `ecc/scripts/` y `ecc/hooks/`
(runtime de hooks) pero **no** `ecc/.git`, `node_modules` ni `.pi-port`.

## Estructura del repo

```text
ecc-pi-port/
├── package.json          # manifest Pi + metadata npm
├── ecc.lock              # repo/tag/commit/versión de ECC fijados
├── extensions/           # ecc-hooks, ecc-rules, ecc-agents, ecc-sdd
├── lib/                  # lógica pura y testeable del adaptador
├── skills/ prompts/ rules/   # generados (no editar a mano)
├── config/               # allowlists, config de modelos, datos de agentes
├── ecc/                  # checkout git (gitignored, lo crea setup)
├── overlays/             # overrides locales de skills
├── scripts/              # setup, build, update-ecc, release-check
├── tests/pi-port/        # suite node:test + verificación de instalación
└── docs/pi-port/         # recon, commands, hooks, agents, SDD, estado, reportes
```

## Troubleshooting

- **No aparecen skills:** revisá `pi list` y `~/.pi/agent/settings.json`. Quitá
  `ecc/pi/core` si está instalado: colisiona con los nombres de este paquete.
- **Los hooks no corren:** mirá `.pi-port/logs/ecc-hooks.log` en el cwd y
  `ECC_HOOKS_ENABLED`. Si dice “ECC root not found”, seteá
  `ECC_HOOKS_ECC_ROOT=/ruta/a/ecc-pi-port/ecc`.
- **Formatter/typecheck lento o con red:** desactivá `post:quality-gate` y
  `stop:format-typecheck`, o instalá el formatter y `typescript` en el proyecto.
- **`/ecc-rules` no inyecta nada:** el stack no existe o `auto` no encontró
  marcadores; probá `/ecc-rules typescript`.
- **`npm run setup` no puede clonar ECC:** revisá git/red, o cloná manualmente en
  `./ecc` y reintentá. Offline con checkout existente:
  `npm run setup -- --no-fetch`.
- **`ecc HEAD != ecc.lock`:** corré `npm run update-ecc -- <ref>` o restaurá el
  commit fijado; el build se niega a mezclar versiones en silencio.

## Licencia

MIT. Ver [`LICENSE`](LICENSE):

- Port: © 2026 BaráDev.
- ECC: © 2026 Affaan Mustafa — <https://github.com/affaan-m/ECC> (MIT).
- `skills/`, `prompts/` y `rules/` derivan de ECC.

---

## ⭐ Si te sirvió

Dale una estrella al repo — ayuda a que otros usuarios de Pi encuentren el port y
a sostener el trabajo de curación y del updater. Issues y PRs son bienvenidos.

[![Star this repo](https://img.shields.io/github/stars/AndresArreguy/ecc-pi-port?style=social)](https://github.com/AndresArreguy/ecc-pi-port)
