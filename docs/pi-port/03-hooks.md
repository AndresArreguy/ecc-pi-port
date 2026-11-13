# Pi Port — Hooks Adapter (`extensions/ecc-hooks.ts`)

Extensión TypeScript para Pi que ejecuta los **scripts originales de ECC** (sin reescribirlos) desde `./ecc`, traduciendo eventos/payloads de Pi al formato esperado por los hooks de ECC y ejecutándolos vía `scripts/hooks/run-with-flags.js` con `child_process.execFile` (sin shell).

- Extensión: `extensions/ecc-hooks.ts`
- Scripts ECC ejecutados: `ecc/scripts/hooks/*` (no modificados)
- Runner usado: `ecc/scripts/hooks/run-with-flags.js` (respeta gating/perfiles/flags y normalización de salida)
- Log: `.pi-port/logs/ecc-hooks.log` (dentro del workspace)
- Raíz ECC: `ECC_HOOKS_ECC_ROOT` (o `ECC_ROOT`) si se define; por defecto `./ecc` (o `../ecc` relativo a la extensión)

> No se modificó `./ecc` ni se tocaron `~/.pi` / `~/.claude`.

## 1) Tabla de equivalencia de eventos (ECC/Claude hooks → Pi)

Solo se usan nombres de eventos de Pi confirmados por la documentación oficial instalada (`extensions.md`).

| Evento ECC (`hooks.json` / Claude) | Evento Pi (confirmado) | Mapeo en el adaptador | Notas de semántica |
|---|---|---|---|
| `SessionStart` | `session_start` | `session_start` → ejecuta hooks ECC de `SessionStart` habilitados (subset: `session:start` → `scripts/hooks/session-start.js`). Traduce `reason` (`startup/reload/new/resume/fork`) a `source` ECC (`startup`/`resume`). Inyecta `hookSpecificOutput.additionalContext` en el system prompt en el siguiente `before_agent_start`. | Equivalente funcional cercano. `session_start` también ocurre en `reload/new/resume/fork`. |
| `SessionEnd` | `session_shutdown` | `session_shutdown` → ejecuta hooks ECC de `SessionEnd` habilitados (subset: `session:end:marker`). | `session_shutdown` se dispara al desmontar runtime de sesión (`quit/reload/new/resume/fork`), no es idéntico 1:1 al `SessionEnd` de Claude en todos los casos, pero es el punto de limpieza disponible. |
| `PreToolUse` | `tool_call` | `tool_call` → traduce payload, ejecuta hooks ECC `PreToolUse` que matchean la herramienta (subset: `pre:bash:dispatcher` para `Bash`). Si el hook sale con código `2`, el adaptador devuelve `{ block: true, reason }`. | `tool_call` puede bloquear antes de ejecutar la herramienta (capacidad equivalente). |
| `PostToolUse` | `tool_result` (`isError === false`) | `tool_result` → traduce payload y ejecuta hooks ECC `PostToolUse` que matchean (subset: `post:quality-gate` para `Edit|Write|MultiEdit`). | `tool_result` puede modificar resultado en Pi; el adaptador actualmente ejecuta scripts y registra contexto adicional (no reescribe el resultado salvo extensión futura). Semántica de timing/orden difiere en tool calls paralelos. |
| `PostToolUseFailure` | `tool_result` (`isError === true`) | `tool_result` con error → se mapea al tipo ECC `PostToolUseFailure` para hooks habilitados que coincidan. | **Sin subset habilitado por defecto** (los hooks ECC de este evento quedan detrás de la lista de habilitados). No hay evento Pi dedicado `tool_failure`; se usa `tool_result.isError`. |
| `PreCompact` | `session_before_compact` | `session_before_compact` → ejecuta hooks ECC `PreCompact` habilitados (`pre:compact` disponible, no habilitado por defecto). | `session_before_compact` permite cancelar/customizar compactación; el adaptador no cancela por defecto. Payload ECC incluye `transcript_path` (se pasa `ctx.sessionManager.getSessionFile()` como best-effort; formato puede no ser JSONL Claude). |
| `Stop` | `agent_end` (best-effort) **y** `session_shutdown` (para hooks de guardado/limpieza en el subset) | `agent_end` → ejecuta hooks ECC `Stop` habilitados. `session_shutdown` → también ejecuta hooks `Stop` habilitados para asegurar persistencia/limpieza de sesión en el subset. | **No equivalente exacto confirmado.** En Claude `Stop` corre tras cada respuesta; en Pi `agent_end` puede no ser “idle final” en todos los flujos y `agent_settled` tiene semántica distinta. Se eligió `agent_end` como mapeo general y se documenta la diferencia. |

### Eventos ECC presentes pero no mapeados
- No hay otros eventos en `ecc/hooks/hooks.json` fuera de: `PreToolUse`, `PreCompact`, `SessionStart`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `SessionEnd`.

### Eventos Pi no usados por este adaptador (relevantes)
- `tool_execution_start/update/end`, `turn_start/turn_end`, `before_agent_start` (solo se usa para inyectar contexto de SessionStart), `agent_start/agent_before_settle/agent_settled`, `input`, `user_bash`, `session_before_switch/session_before_fork/session_compact/session_compact_failed`, `message_*`, `context*`, etc. No se inventan equivalencias adicionales.

## 2) Traducción de payloads al formato esperado por scripts ECC

Los scripts ECC se ejecutan sin cambios y reciben JSON por stdin (vía `run-with-flags.js`). El adaptador construye payloads estilo Claude:

- **Común:** `hook_event_name`, `session_id`, `cwd`
- **SessionStart:** `{ hook_event_name: "SessionStart", source: "startup"|"resume", reason: <pi reason>, session_id, cwd, transcript_path }`
- **SessionEnd:** `{ hook_event_name: "SessionEnd", reason: <pi reason>, session_id, cwd, transcript_path }`
- **PreCompact:** `{ hook_event_name: "PreCompact", reason, will_retry, session_id, cwd, transcript_path }`
- **PreToolUse (`tool_call`):** `{ hook_event_name: "PreToolUse", tool_name: <Claude>, tool_input: <event.input>, tool_use_id: <toolCallId>, session_id, cwd }`
- **PostToolUse (`tool_result`, ok):** `{ hook_event_name: "PostToolUse", tool_name, tool_input, tool_output, tool_response, tool_use_id, is_error, session_id, cwd }`
- **PostToolUseFailure (`tool_result`, error):** mismo shape con `hook_event_name: "PostToolUseFailure"` e `is_error: true`
- **Stop (best-effort):** `{ hook_event_name: "Stop", session_id, cwd, transcript_path }`

Notas:
- `transcript_path` se rellena con `ctx.sessionManager.getSessionFile()` cuando existe; **no garantiza** formato JSONL de transcript de Claude (algunos hooks como `session-end.js` dependen de transcript Claude y pueden degradar su utilidad).
- `tool_output`/`tool_response` incluyen `content`, `text` (serializado), `details`, `structuredContent`, `isError`, `usage` para maximizar compatibilidad.

## 3) Mapeo de herramientas (Claude Code → Pi)

Para que los matchers de ECC funcionen, el adaptador traduce nombres de herramientas Pi a nombres Claude en payloads y en matching:

| Pi tool | Claude/ECC tool name |
|---|---|
| `bash` | `Bash` |
| `read` | `Read` |
| `write` | `Write` |
| `edit` | `Edit` |
| `grep` | `Grep` |
| `find` | `Find` |
| `ls` | `Ls` |
| (otros) | Capitalización inicial del nombre recibido (fallback) |

Matcher soportado: nombres exactos, listas separadas por `|`, `*`/`.*`, y regex simples (p.ej. `^mcp__`) cuando aplica.

## 4) Respeto de perfiles y deshabilitación ECC

- Se ejecuta vía `node <ecc>/scripts/hooks/run-with-flags.js <hookId> <script> <profiles>` con `CLAUDE_PLUGIN_ROOT`/`ECC_PLUGIN_ROOT` y `CLAUDE_PROJECT_DIR` configurados.
- `run-with-flags.js` y `scripts/lib/hook-flags.js` aplican:
  - `ECC_HOOK_PROFILE` (`minimal|standard|strict`, default `standard`)
  - `ECC_DISABLED_HOOKS` (IDs separados por coma)
  - `ECC_HOOKS_ENABLED`, `ECC_DRY_RUN`, y precedencias/fallbacks soportados por ECC
- El adaptador **no** omite esta lógica: delega el gating al runner/scripts originales.

## 5) Subset habilitado por defecto y lista de habilitados del adaptador

Por defecto (subset solicitado) se habilitan solo:
- **Bloqueo de comandos peligrosos:** `pre:bash:dispatcher` (`PreToolUse`, matcher `Bash`)
- **Formateo/lint post-edit:** `post:quality-gate` (`PostToolUse`, `Edit|Write|MultiEdit`) y `stop:format-typecheck` (`Stop`, best-effort)
- **Guardado de contexto de sesión:** `session:start` (`SessionStart`, inyección de contexto) y `session:end:marker` (`SessionEnd`/shutdown)

Hooks mapeados pero **no habilitados por defecto** (detrás de lista de habilitados): `pre:compact`, `stop:session-end`, `pre:write:doc-file-warning`, `pre:config-protection` (y cualquier otro que se agregue al mapa).

Control del adaptador:
- `ECC_PI_ADAPTER_HOOKS=<id1,id2,...>`: habilita explícitamente IDs listados (además de los defaults).
- `ECC_PI_ADAPTER_HOOKS=all`: habilita todos los hooks definidos en el mapa del adaptador.
- Esto es adicional al gating de ECC (`ECC_HOOK_PROFILE` / `ECC_DISABLED_HOOKS`).

## 6) Timeouts, errores y logging

- Cada ejecución de hook usa `execFile` sin shell, timeout de **30s** y `maxBuffer` de **1 MiB**.
- Un hook que falla, devuelve error o se cuelga (timeout) **no tumba la sesión**: el error se captura, se registra y el adaptador continúa.
- Logging a archivo: `.pi-port/logs/ecc-hooks.log` (append, con timestamp). Errores críticos de resolución de raíz ECC también se notifican vía `ctx.ui.notify` si está disponible.
- `session_before_compact` no cancela compactación por defecto.

## 7) Soporte, limitaciones y elementos sin soporte

### Implementado en el adaptador
- Mapeos de eventos Pi confirmados: `session_start`, `session_shutdown`, `session_before_compact`, `tool_call`, `tool_result`, `agent_end`, `before_agent_start` (para inyectar contexto de sesión).
- Ejecución de scripts ECC originales vía `run-with-flags.js`.
- Traducción de tool names Pi→Claude y de payloads básicos.
- Bloqueo en `tool_call` cuando un hook `PreToolUse` retorna exit code `2`.
- Inyección de `additionalContext` de `SessionStart` al system prompt.
- Respeto de `ECC_HOOK_PROFILE` y `ECC_DISABLED_HOOKS` mediante el runner ECC.

### Sin soporte o soporte parcial (actual)
- **Equivalencia exacta de `Stop`:** no hay evento Pi confirmado idéntico a “después de cada respuesta” de Claude; se usa `agent_end` (best-effort) y soporte en `session_shutdown` para persistencia del subset.
- **`PostToolUseFailure` dedicado:** no existe como evento Pi; se aproxima con `tool_result` + `isError`.
- **Paridad completa de payloads Claude:** algunos campos avanzados (p.ej. transcript Claude JSONL real, estructuras específicas de herramientas MCP/Skill, metadatos de harness Claude) no están disponibles o difieren. Hooks que dependen fuertemente de `transcript_path` Claude (p.ej. resúmenes LLM en `stop:session-end`, `pre:compact`) pueden operar en modo degradado.
- **Aplicación de mutaciones de `tool_result`:** el adaptador no aplica actualmente parches de salida al resultado de la herramienta (solo ejecuta hooks/loguea). Bloqueo pre-tool sí está soportado.
- **Cobertura total de hooks ECC:** solo el subset por defecto está habilitado; el resto queda detrás de `ECC_PI_ADAPTER_HOOKS` y/o puede requerir mapeos/payloads adicionales.
- **Ejecución `async: true`/dispatchers complejos de `hooks.json`:** el adaptador invoca scripts/hook IDs específicos; no reproduce literalmente la orquestación completa de `hooks.json` del lado Claude.
- **Interacción con `.pi` adapter oficial de ECC:** si ambos están activos, pueden solaparse en `session_start`/`session_shutdown` (p.ej. doble ejecución de `session:start` o `session:end:marker`). Configurar habilitados/deshabilitados para evitar duplicación.

## 8) Riesgos de seguridad

- **Ejecución de código arbitrario del repositorio:** los hooks ECC son scripts ejecutables (Node/JS, y potencialmente otros) que corren con los permisos del proceso `pi`/usuario. Cargar y ejecutar hooks desde `./ecc` implica confiar en ese contenido.
- **Superficie de bloqueo/denegación:** hooks `PreToolUse` pueden bloquear operaciones (exit code `2`); una configuración errónea o un hook malicioso puede impedir trabajo legítimo.
- **Efectos secundarios en el sistema de archivos/proyecto:** hooks pueden leer/escribir archivos, ejecutar herramientas, modificar estado de sesión, formatear código, etc., dentro del `cwd`/entorno configurado.
- **Exfiltración/fugas a logs:** payloads, stderr/stdout y contexto pueden contener rutas o datos sensibles; el adaptador registra en `.pi-port/logs/ecc-hooks.log`. Revisar y proteger logs.
- **Payloads parciales/no confiables:** traducciones Pi→Claude son best-effort; un hook que asuma invariantes de Claude puede comportarse de forma inesperada. El adaptador aísla fallos, pero no garantiza corrección semántica total.
- **Timeouts y procesos colgados:** procesos terminados por timeout pueden dejar trabajo parcial externo si el script no es idempotente (riesgo inherente al hook).
- **No usar en repos no confiables sin revisión:** especialmente con hooks habilitados fuera del subset mínimo.

## 9) Pruebas y uso

### Simulación de payloads (sin Pi runtime)
Script: `tests/pi-port/simulate-hook-payloads.mjs`

Ejecuta `run-with-flags.js` con payloads traducidos de ejemplo y verifica recepción/comportamiento esperado (p.ej. bloqueo de `git commit --no-verify`, pass-through de `session:end:marker`, aceptación de payloads de SessionStart/PreCompact/PostToolUse).

```bash
cd C:\BaráDev\pi-ecc
ECC_AGENT_DATA_HOME="$PWD/.pi-port/tmp-agent-home" node tests/pi-port/simulate-hook-payloads.mjs
```

> Recomendado redirigir `ECC_AGENT_DATA_HOME` en pruebas para evitar writes en `~/.claude` (los scripts ECC pueden persistir estado de sesión/observador según configuración).

### Carga en vivo en Pi
```bash
cd C:\BaráDev\pi-ecc
pi -e ./extensions/ecc-hooks.ts
# o prueba de carga no interactiva:
printf '' | pi --offline --mode rpc --no-session --no-context-files -e ./extensions/ecc-hooks.ts
```

### Habilitar hooks adicionales del adaptador
```bash
# habilitar IDs específicos del mapa del adaptador
set ECC_PI_ADAPTER_HOOKS=pre:compact,stop:session-end

# habilitar todos los mapeados en el adaptador (sujetos además a ECC_HOOK_PROFILE/ECC_DISABLED_HOOKS)
set ECC_PI_ADAPTER_HOOKS=all
```

## 10) Referencia de implementación

- Traduce y despacha por evento Pi (`session_start`, `session_shutdown`, `session_before_compact`, `tool_call`, `tool_result`, `agent_end`).
- Ejecuta scripts originales de ECC a través de `run-with-flags.js` (sin modificar `./ecc`).
- Respeta `ECC_HOOK_PROFILE`/`ECC_DISABLED_HOOKS` y registra fallos/timeouts sin interrumpir la sesión.
- Subset inicial habilitado por defecto: bloqueo de comandos peligrosos, formateo/lint post-edit, guardado/carga de contexto de sesión (best-effort según equivalencias disponibles).
