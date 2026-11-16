# Seguridad — checklist antes de instalar `ecc-pi-port`

Este paquete **no es un sandbox**. Las extensiones de Pi corren con los permisos
completos de tu usuario, y los hooks ejecutan código Node de ECC que, a su vez,
puede lanzar otros procesos. Revisá esta lista antes de instalarlo en una máquina
distinta de la de desarrollo.

## Reporte de vulnerabilidades

**No abras un issue público.** Usá la pestaña **Security** del repo → **Report a
vulnerability** para enviar un reporte privado. Incluí versión/commit del paquete,
sistema operativo, versión de Pi y Node, pasos para reproducir, impacto y una
prueba de concepto si aplica. No incluyas API keys, sesiones ni datos de cuenta.

Si el reporte privado no está disponible, contactá al maintainer por GitHub y
pedí un canal privado.

## 1. Qué se ejecuta

### Al arrancar cada sesión de Pi

| Componente | Qué hace | Procesos / red |
|---|---|---|
| `extensions/ecc-hooks.ts` | Traduce eventos de Pi a payloads de hooks ECC y ejecuta `ecc/scripts/hooks/run-with-flags.js` con `child_process.execFile` (sin shell). | Lanza un proceso Node por hook habilitado. |
| `extensions/ecc-rules.ts` | Lee `rules/**/*.md` e inyecta el texto en el system prompt. | Solo lectura de archivos. |
| `extensions/ecc-agents.ts` | Registra la tool `run_agent`. No ejecuta nada hasta que el modelo la usa. | Ninguno al arrancar. |
| `extensions/ecc-sdd.ts` | Registra comandos `/sdd-*`, cambia de modelo y escribe `specs/`. En `review` ejecuta `git diff`/`git status`. | `git` (local). |

### Hooks habilitados por defecto (`HOOK_SPECS` + `enabledByDefault`)

| Hook | Script ECC | Efectos secundarios |
|---|---|---|
| `session:start` | `scripts/hooks/session-start.js` | Lee sesiones/instintos en `~/.claude`, detecta project type, escribe un *lease* en `~/.local/share/ecc-homunculus/projects/...`, puede inyectar contexto adicional. |
| `session:end:marker` | `scripts/hooks/session-end-marker.js` | Borra el lease; si no quedan leases, puede enviar `SIGTERM` al PID guardado en `observer.pid` del proyecto. |
| `pre:bash:dispatcher` | `scripts/hooks/pre-bash-dispatcher.js` | Analiza el comando bash y puede **bloquearlo** (exit 2). No ejecuta el comando. |
| `post:quality-gate` | `scripts/hooks/quality-gate.js` | Detecta el formatter del proyecto y puede ejecutarlo (`prettier`, `biome`, `ruff`, etc.) sobre el archivo editado. Puede usar el package manager (`npx`/`pnpm`/`yarn`) → **posible descarga de red** si el formatter no está instalado. |
| `stop:format-typecheck` | `scripts/hooks/stop-format-typecheck.js` | Formatea archivos editados y ejecuta `npx tsc --noEmit` en proyectos TS. `npx` sin `--no-install` puede descargar `typescript`. |

### Hooks incluidos pero desactivados por defecto

| Hook | Por qué está apagado |
|---|---|
| `pre:compact` | `pre-compact.js` usa `llm-summary`, que puede invocar el CLI `claude` con `-p` para resumir la sesión. |
| `stop:session-end` | `session-end.js` también usa `llm-summary` y escribe resúmenes de sesión en `~/.claude`. |
| `pre:write:doc-file-warning` | Aviso no bloqueante sobre archivos de documentación. |
| `pre:config-protection` | Protección de archivos de configuración; puede bloquear escrituras. |

Se pueden activar con `ECC_PI_ADAPTER_HOOKS=all` o por ID. Ver README.

### Otras ejecuciones a tener en cuenta

- `ecc-agents` (`run_agent`) lanza un proceso `pi` hijo por invocación con
  `--no-session --no-extensions --no-skills --no-prompt-templates --no-themes`
  y allowlist `--tools`. El hijo hereda el entorno (incluidas API keys) y corre
  en el `cwd` indicado. Tiene límites de turnos, timeout y paralelismo en
  `config/agents-models.json`.
- `ecc-sdd` cambia el modelo activo de la sesión y escribe en `specs/` (incluye
  `costs.md`). No hace red por sí mismo, pero los prompts disparan llamadas al
  proveedor de modelos configurado.
- El adaptador de hooks escribe logs en `<cwd>/.pi-port/logs/ecc-hooks.log`
  (IDs de hook, stderr acotado, extractos de `additionalContext`).

## 2. Permisos que usan los agentes

| Agente ECC | Tools ECC | Tools Pi mapeadas |
|---|---|---|
| `planner` | Read, Grep, Glob | `read`, `grep`, `find`, `ls` |
| `code-reviewer` | Read, Grep, Glob, Bash | `read`, `grep`, `find`, `ls`, `bash` |
| `security-reviewer` | Read, Grep, Glob, Bash | `read`, `grep`, `find`, `ls`, `bash` |
| `build-error-resolver` | Read, Edit, Bash, Grep, Glob | `read`, `edit`, `bash`, `grep`, `find`, `ls` |
| `tdd-guide` | Read, Write, Edit, Bash, Grep, Glob | todos los anteriores |
| `architect` | Read, Grep, Glob | `read`, `grep`, `find`, `ls` |

- Los agentes **solo** reciben las tools mapeadas; tools desconocidas o MCP se
  listan en `unmappedTools` y no se pasan al hijo.
- `run_agent` no corre hooks ECC dentro del hijo (`--no-extensions`), así que el
  subagente no hereda el bloqueo de `--no-verify` ni el quality gate.
- Los agentes de revisión (`code-reviewer`, `security-reviewer`) tienen `bash`:
  pueden ejecutar comandos locales aunque su rol sea de lectura.

## 3. Checklist antes de instalar en otra máquina

- [ ] **Revisar procedencia de `./ecc`.** Confirmar commit/tag de
      `https://github.com/affaan-m/ECC` y que `ecc/VERSION` coincide con lo
      esperado (`2.2.3` en esta release).
- [ ] **Revisar el contenido que se empaqueta:** `npm pack --dry-run`. Confirmar
      que no se incluyen `.git`, `node_modules`, `.pi-port/`, sesiones ni logs.
- [ ] **Revisar hooks antes de confiar:** leer `extensions/ecc-hooks.ts`,
      `lib/ecc-hooks-core.ts` y `ecc/scripts/hooks/*` (en particular
      `quality-gate.js`, `stop-format-typecheck.js`, `pre-bash-dispatcher.js`).
- [ ] **Confirmar si querés ejecución de formatters/typecheck.** Si no, arrancar
      con `ECC_DISABLED_HOOKS=post:quality-gate,stop:format-typecheck` o
      `ECC_HOOKS_ENABLED=false`.
- [ ] **Confirmar que `llm-summary` no se dispare:** no activar `pre:compact` ni
      `stop:session-end` salvo que aceptes que se invoque el CLI `claude`.
- [ ] **Revisar `config/agents-models.json`.** Vacío por defecto (usa el modelo
      de la sesión). Si agregás provider/model, verificá que las credenciales
      sean las esperadas; el hijo hereda el entorno.
- [ ] **Revisar logs:** `.pi-port/logs/ecc-hooks.log` puede contener rutas,
      stderr de hooks y extractos de contexto de sesión. No lo compartas sin
      revisarlo.
- [ ] **Revisar `~/.local/share/ecc-homunculus/`** si te preocupa el observer de
      ECC: los hooks de sesión escriben leases ahí y pueden terminar un proceso
      observador.
- [ ] **Proyecto limpio / trust:** los packages declarados en `.pi/settings.json`
      solo cargan después de aprobar el proyecto. En máquinas compartidas usá
      instalación de usuario (`pi install`) y revisá `~/.pi/agent/settings.json`.
- [ ] **Licencias:** conservar `LICENSE` (MIT del port + MIT de ECC). Las
      carpetas generadas `skills/`, `prompts/` y `rules/` son contenido de ECC.
- [ ] **Windows:** `npx.cmd` se ejecuta con `shell: true` en algunos hooks. Si
      el proyecto tiene rutas con caracteres raros, el hook de formato puede
      omitir el lote (no bloqueante).

## 4. Cómo desactivar todo

```bash
# Desactivar todos los hooks ECC (el resto del paquete sigue funcionando)
export ECC_HOOKS_ENABLED=false

# O elegir perfil: minimal | standard | strict
export ECC_HOOK_PROFILE=minimal

# O desactivar hooks puntuales
export ECC_DISABLED_HOOKS=post:quality-gate,stop:format-typecheck

# Desactivar solo reglas
export ECC_PI_RULES=off

# Quitar el paquete de Pi
pi remove ~/ruta/a/pi-ecc
```

En Windows (PowerShell): `$env:ECC_HOOKS_ENABLED = "false"`.
