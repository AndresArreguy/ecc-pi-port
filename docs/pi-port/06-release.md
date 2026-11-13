# Release 0.6.0 — resultados de pruebas y problemas conocidos

Fecha: 2026-11-13
Workspace: `C:\BaráDev\pi-ecc`
Fuente ECC: `ecc-universal` v2.2.3 (MIT, <https://github.com/affaan-m/ECC>)
Entorno verificado: Windows, Node `v24.14.1`, npm `11.11.0`, Pi `1.5.2`.

## 1. Entregables de la release

| Artefacto | Estado |
|---|---|
| `package.json` con manifest `pi` (`extensions`, `skills`, `prompts`, `changelogPath`), `version 0.6.0`, `license MIT`, bloque `ecc` con repo/versión/licencia originales | ✅ |
| `npm run build` único (skills + rules + prompts + agentes) | ✅ |
| Instalación local con `pi install` en proyecto limpio | ✅ |
| Smoke tests sin LLM (`npm test`) | ✅ 20/20 |
| `README.md` en español | ✅ |
| `SECURITY.md` (checklist) | ✅ |
| Verificación de instalación (`npm run verify:install`) | ✅ 8/8 |

Archivos principales:

```text
package.json
README.md
SECURITY.md
LICENSE            # MIT del port + atribución MIT de ECC
CHANGELOG.md
extensions/        # ecc-hooks.ts, ecc-rules.ts, ecc-agents.ts, ecc-sdd.ts
lib/               # ecc-hooks-core.ts, ecc-rules-core.ts (lógica pura)
scripts/build.ts   # entrypoint único
scripts/lib/       # generadores (skills, rules, prompts, agents)
tests/pi-port/     # generators, hooks-core, rules-core, extension-registration
tests/pi-port/verify-install.mjs
tests/pi-port/probe-tools.mjs
```

## 2. Resultado del build

`npm run build`:

```text
ECC source version: 2.2.3
skills: 123 (165 files)
rules: 22 stacks (121 files)
prompts: 7
agents: 6
build OK
```

`npm run build:check`:

```text
check OK: generated outputs are up to date
```

Notas del pipeline:

- Las skills se copian desde `ecc/skills` usando la curación de
  `ecc/manifests/pi-core.json` (la misma que usa ECC para su profile Pi). Si ECC
  agrega o quita una skill sin actualizar el manifest, el build **falla** con
  “curation drift”.
- `council` se publica como `ecc-council` (rename de frontmatter, igual que ECC).
- Las reglas se copian desde `ecc/rules`; el `README.md` de `rules/` se regenera.
- Los prompts se generan con `config/commands-allowlist.json`.
- Los agentes se generan con `config/agents-subset.json`; se eliminó el timestamp
  (`generatedAt`) y se reemplazó por `sourceVersion` para que `build:check` sea
  determinista.
- `npm run build` no modifica `./ecc`.

## 3. Smoke tests (`npm test`)

Comando: `node --test "tests/pi-port/*.test.ts"` (Node test runner + type stripping).

```text
tests 20 | pass 20 | fail 0 | duration ~1.7s
```

Cobertura:

| Archivo | Qué verifica |
|---|---|
| `generators.test.ts` | Fixture ECC mínimo → skills (con rename y archivos de apoyo), rules + índice, prompts con header de procedencia, `agents-generated.json` con mapeo de tools y `sourceVersion`. Falla ante drift de curación y ante entradas del manifest sin archivo. |
| `hooks-core.test.ts` | Mapeo Pi→Claude de tools, matchers (`*`, pipes, regex), payloads de `SessionStart/End`, `PreCompact`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`; gating por `ECC_PI_ADAPTER_HOOKS`; extracción de `additionalContext` y razones de bloqueo. |
| `rules-core.test.ts` | Listado de stacks, detección por marcadores (`go.mod`, `tsconfig`, React/React Native, etc.), selección `auto/off/explícita`, stacks inválidos, presupuesto de caracteres y stacks faltantes. |
| `extension-registration.test.ts` | Registro de los 7 eventos de `ecc-hooks`; ejecución real de `pre:bash:dispatcher` a través del adaptador (bloquea `git commit --no-verify`, respeta `ECC_DISABLED_HOOKS`); `/ecc-rules` lista/inyecta/apaga reglas; `run_agent` registrado, agentes generados con system prompt y tools, y ejecución con agente inexistente devuelve error sin invocar al LLM. |

Lo que **no** cubren los tests: llamadas reales al modelo, calidad de prompts,
flujo SDD end-to-end (requiere modelos/credenciales y fue validado en la etapa 5).

## 4. Instalación local y verificación

Instalación realizada **desde** un proyecto limpio
(`.pi-port/clean-install-project`, sin `AGENTS.md` ni `.pi/`), con scope de
usuario (`~/.pi/agent/settings.json`):

```bash
pi remove "..\..\..\..\BaráDev\pi-ecc\ecc\pi\core"   # evitar colisión de skills
pi install "C:\BaráDev\pi-ecc"
```

`pi list`:

```text
User packages:
  npm:pi-commandcode-provider
  ..\..\..\..\BaráDev\pi-ecc
    C:\BaráDev\pi-ecc
```

`~/.pi/agent/settings.json` quedó con:

```json
"packages": [
  "npm:pi-commandcode-provider",
  "..\\..\\..\\..\\BaráDev\\pi-ecc"
]
```

### Verificación sin LLM (`npm run verify:install`)

Arranca `pi --mode rpc --no-session --offline -e tests/pi-port/probe-tools.mjs`
(con `ECC_HOOK_PROFILE=standard`) desde el proyecto limpio, consulta `get_commands`, inspecciona las tools vía una
extensión sonda y comprueba el efecto real del hook `session:start` en un
`CLV2_HOMUNCULUS_DIR` temporal.

```text
PASS - package skills discovered (>= 120) (123 skills)
PASS - known skill discovered (verification-loop) (ok)
PASS - prompt templates discovered (7 prompts)
PASS - extension commands registered (7 commands)
PASS - no extension load errors (none)
PASS - ECC session_start hook ran (lease written) (1 lease(s))
PASS - agent definitions available (6 agents)
PASS - run_agent tool registered and active (active)

8/8 checks passed
```

Interpretación:

- **Skills descubiertas:** 123 comandos `/skill:*` con `sourceInfo.baseDir`
  apuntando al package instalado.
- **Commands disponibles:** 7 prompt templates (`/plan-prd`, `/plan`,
  `/prp-implement`, `/feature-dev`, `/code-review`, `/test-coverage`,
  `/quality-gate`) y 7 comandos de extensión (`/ecc-rules` + 6 `/sdd-*`).
- **Hooks activos:** el hook `session:start` de ECC escribió su lease real a
  través del adaptador, usando el runtime vendido en `ecc/scripts`.
- **Agentes ejecutables:** `run_agent` aparece registrado y activo; los 6
  agentes tienen `systemPrompt` y `piTools` en `config/agents-generated.json`.
  La ejecución end-to-end con LLM no forma parte de esta verificación.

### Empaquetado

`npm pack --dry-run`:

```text
package size:   1.5 MB
unpacked size:  5.2 MB
total files:    660
```

Incluye `ecc/scripts` + `ecc/hooks` (runtime de hooks) pero excluye `.git`,
`docs/` de ECC, tests de ECC, `.pi-port/` y `node_modules/`.

## 5. Problemas conocidos / limitaciones

### Port y funcionalidad

1. **Cobertura parcial de ECC.** 123/293 skills y 7/94 comandos. La curación deja
   afuera integraciones SaaS, hooks de Claude Code, packs de dominio y comandos
   que dependen de `Task`/subagentes.
2. **`/feature-dev` degradado.** El flujo multi-agente original
   (`code-explorer`/`code-architect`/`code-reviewer`) se ejecuta inline o vía
   `run_agent`; no hay orquestación automática de tres agentes.
3. **Hooks no 1:1.** `Stop` se mapea a `agent_end` + `session_shutdown` (no es un
   “idle final” exacto). `SessionEnd` se mapea a `session_shutdown`. El
   `transcript_path` que reciben los hooks no es JSONL de Claude, así que
   `session-end.js`/`pre-compact.js` perderían fidelidad si se activaran.
4. **Hooks que usan LLM apagados por defecto.** `pre:compact` y `stop:session-end`
   invocan `llm-summary`, que puede ejecutar el CLI `claude -p`. Se dejaron
   desactivados; activarlos requiere aceptar esa dependencia externa.
5. **Hooks de formato pueden usar red.** `post:quality-gate` y
   `stop:format-typecheck` resuelven formatters y, si faltan, pueden usar
   `npx`/package manager (descarga). `stop:format-typecheck` corre `npx tsc
   --noEmit` en proyectos TS sin `--no-install`.
6. **Rutas `.claude/` en prompts.** Los templates conservan rutas de artefactos
   (`.claude/plans`, `.claude/prds`, etc.) por compatibilidad con ECC.
7. **Sin temas, MCP ni providers propios.** Se usa la configuración de Pi.
8. **`run_agent` no hereda hooks.** El hijo corre con `--no-extensions`, por lo
   que no aplica el bloqueo de `--no-verify` ni el quality gate dentro del
   subagente. Además hereda el entorno completo (incluidas API keys) y no está
   sandboxeado.
9. **Tools desconocidas en agentes.** El generador mapea tools no reconocidas a
   minúsculas y las pasa en `--tools` (ej. `websearch`), además de listarlas en
   `unmappedTools`. Es inocuo pero ruidoso; conviene filtrarlas en una próxima
   iteración.
10. **SDD sin verificación en esta release.** El flujo se validó en la etapa 5
    con `tests/pi-port/test-sdd-rpc.mjs` (requiere modelos). No se re-ejecutó en
    la etapa 6 para no depender de credenciales/costos.
11. **`docs/pi-port/02-commands.md` es generado.** No editarlo a mano: se
    sobrescribe en cada build.

### Instalación / operación

12. **Colisión con `ecc/pi/core`.** Ambos packages exponen las mismas skills. En
    esta máquina se removió `ecc/pi/core` de `~/.pi/agent/settings.json` antes de
    instalar. Si se reinstala, Pi conservará la primera skill descubierta y
    emitirá warnings.
13. **El path local queda relativo en settings.** `pi install C:\BaráDev\pi-ecc`
    se guardó como `..\..\..\..\BaráDev\pi-ecc` (relativo al settings de usuario).
    Mover o renombrar la carpeta rompe la carga: reinstalar con `pi install`.
14. **`npm install` es solo para build/test.** El runtime usa el `typebox` que
    provee Pi. El `node_modules/` local no se empaqueta.
15. **Windows:** los scripts de ECC usan `shell: true` para `.cmd` (npx,
    formatters). Rutas con caracteres especiales pueden hacer que el hook omita
    el lote de formato (no bloqueante).
16. **Logs locales.** El adaptador escribe `.pi-port/logs/ecc-hooks.log` en el
    cwd; puede contener extractos de contexto y stderr de hooks.
17. **Lease/observer de ECC.** Los hooks de sesión escriben en
    `~/.local/share/ecc-homunculus/projects/...` y `session:end:marker` puede
    enviar `SIGTERM` a un PID de observer si existe. Ver `SECURITY.md`.

## 6. Checklist de seguridad (resumen)

Detalle completo en `SECURITY.md`. Antes de instalar en otra máquina:

- Revisar procedencia/commit de `./ecc` y que `ecc/VERSION` sea el esperado.
- Revisar `extensions/ecc-hooks.ts`, `lib/ecc-hooks-core.ts` y los scripts de
  hooks usados (`pre-bash-dispatcher`, `quality-gate`, `stop-format-typecheck`,
  `session-start`, `session-end-marker`).
- Decidir si se aceptan hooks de formato con posible `npx`/red; si no:
  `ECC_DISABLED_HOOKS=post:quality-gate,stop:format-typecheck`.
- No activar hooks con `llm-summary` (`pre:compact`, `stop:session-end`) sin
  aceptar la invocación del CLI `claude`.
- Revisar `config/agents-models.json`; el proceso hijo de `run_agent` hereda el
  entorno y los permisos del usuario.
- Revisar `npm pack --dry-run` y no compartir `.pi-port/logs` sin sanitizar.
- Conservar `LICENSE` (MIT del port + MIT de ECC).

## 7. Reproducir

```bash
cd C:\BaráDev\pi-ecc
npm install
npm run build
npm run build:check
npm test
pi install C:\BaráDev\pi-ecc          # o: pi install -l C:\BaráDev\pi-ecc
npm run verify:install
npm run pack:dry
```
