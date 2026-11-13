# Estado del port ECC → Pi

Actualizado: 2026-11-13

## Versión de ECC

Fijada en `ecc.lock`:

| Campo | Valor |
|---|---|
| Repositorio | `https://github.com/affaan-m/ECC.git` |
| Ref | `v2.2.3` |
| Commit | `c05b2d6614f62f6db0047669aa4eefb223d478f9` |
| Versión ECC | `2.2.3` |

`./ecc` es un clon **completo** (se convirtió desde shallow en la etapa 7) y está
en checkout detached del commit del lock. El build estampa `sourceRef` en
`config/agents-generated.json`.

## Etapas

| Etapa | Estado | Artefactos |
|---|---|---|
| 1 · Recon | ✅ | `docs/pi-port/00-recon.md` |
| 2 · Commands | ✅ | `prompts/`, `config/commands-allowlist.json`, `docs/pi-port/02-commands.md` |
| 3 · Hooks | ✅ | `extensions/ecc-hooks.ts`, `lib/ecc-hooks-core.ts`, `docs/pi-port/03-hooks.md` |
| 4 · Agents | ✅ | `extensions/ecc-agents.ts`, `config/agents-*.json`, `docs/pi-port/04-agents.md` |
| 5 · SDD | ✅ | `extensions/ecc-sdd.ts`, `config/sdd-models.json`, `docs/pi-port/05-sdd.md` |
| 6 · Release | ✅ | `package.json`, `README.md`, `SECURITY.md`, `docs/pi-port/06-release.md` |
| 7 · Updater | ✅ | `scripts/update-ecc.ts`, `scripts/lib/ecc-{git,lock,report}.ts`, `overlays/`, `ecc.lock` |

## Repo, npm y bootstrap

- Nombre npm/repo: **`ecc-pi-port`**.
- README: `README.md` (inglés) + `README.es.md` (español), con badges, instalación,
  actualización y pedido de estrellas.
- `./ecc` está **gitignored**: lo crea `npm run setup` en el commit de `ecc.lock`.
- Publicación: `prepublishOnly` = `npm run verify && npm run release:check`;
  `prepack` = `build:check`.
- CI: `.github/workflows/ci.yml` (setup + build + tests + release-check).
- Release: `.github/workflows/release.yml` (tags `v*` → `npm publish --provenance`).
- Repo URL usada en metadata/badges: `github.com/andresarreguy/ecc-pi-port`
  (ajustar si el handle real es distinto).

## Bootstrap

```bash
git clone https://github.com/andresarreguy/ecc-pi-port.git
cd ecc-pi-port
npm run setup          # instala, clona ECC, build, tests
pi install .
```

`npm run setup` es idempotente y soporta `--skip-install`, `--skip-tests`,
`--no-fetch`, `--force` y `--ecc-ref <ref>` (primer bootstrap sin lock).

## Build

```bash
npm run build          # skills + rules + prompts + agentes desde ./ecc
npm run build:check    # detecta drift de artefactos generados
npm test               # smoke tests sin LLM (31 tests)
npm run verify         # build:check + tests
npm run verify:install # verificación RPC contra Pi instalado
npm run release:check  # metadata + contenido del tarball
```

Salida actual esperada:

```text
ECC source version: 2.2.3 (v2.2.3)
skills: 123 (165 files, 0 overlay(s))
rules: 22 stacks (121 files)
prompts: 7
agents: 6
build OK
```

## Actualización de ECC

```bash
npm run update-ecc -- <tag-o-commit> [--dry-run] [--no-fetch] [--skip-tests]
```

Garantías:

- Convierte clones shallow, hace fetch de tags y resuelve la ref.
- Rebuild de todos los artefactos (incluidos prompts) con `overlays/`.
- Tests post-build; rollback de checkout + artefactos + lock si algo falla.
- Reporte en `docs/pi-port/update-<fecha>.md`.
- Nunca commitea; pide confirmación al final.

## Overlays

`overlays/skills/<skill-de-ecc>/` reemplaza la skill base en el build. El updater
avisa si la base cambió o desapareció. Ver `overlays/README.md`.

## Pendientes conocidos

- El reporte de contrato de hooks es heurístico (tokens); requiere revisión
  humana para cambios semánticos.
- El updater no convierte `./ecc` en submodule: la reproducibilidad se apoya en
  `ecc.lock` + el clon git local.
- `ecc/` no se versiona en el repo externo (git embebido); el commit manual debe
  decidir si se agrega como gitlink/submodule.
- Los tests del updater usan repos git locales (sin red), pero no cubren un
  `git fetch` real.
- El tarball publicado incluye `ecc/scripts/` y `ecc/hooks/` (runtime de hooks)
  pero no `ecc/.git`; `npm run update-ecc` es una herramienta del repo, no del
  paquete instalado.
