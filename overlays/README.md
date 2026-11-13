# Overlays

`overlays/` permite mantener una edición local de una skill curada de ECC sin
tocar `./ecc` (que se actualiza con `npm run update-ecc`).

## Estructura

```text
overlays/
└── skills/
    └── <nombre-de-skill-en-ecc>/
        ├── SKILL.md
        └── ...archivos de apoyo
```

Ejemplo:

```text
overlays/skills/verification-loop/SKILL.md
```

En el próximo `npm run build`, esa skill se copia desde el overlay en lugar de
`ecc/skills/verification-loop`. El nombre del directorio debe ser el nombre de la
skill en ECC (el mismo que aparece en `ecc/manifests/pi-core.json`); también se
acepta el nombre final publicado (por ejemplo `ecc-council`).

## Reglas

- El overlay debe tener `SKILL.md` con frontmatter `name` y `description`.
- Si el `name` no coincide con el nombre final esperado, el build falla.
- `npm run build` informa qué overlays usó.
- `npm run update-ecc -- <ref>` avisa cuando la skill base de ECC cambió en el
  rango actualizado, para que revises y re-apliques tus cambios al overlay.
- Si la skill base desaparece de ECC, el reporte lo marca como error y el overlay
  deja de usarse.

## Cuándo usar overlays (y cuándo no)

Usalo para correcciones locales pequeñas y deliberadas (por ejemplo, ajustar una
guía de testing a tu stack). Si el cambio es genérico, conviene proponerlo aguas
arriba en ECC en lugar de mantener un overlay.
