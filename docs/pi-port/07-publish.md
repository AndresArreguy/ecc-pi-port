# Publicación en npm — runbook

Estado actual: **`ecc-pi-port@0.7.0` publicado** (2026-11-13).  
Cuenta npm maintainer: **`andresarreguydev`** (`andresarreguy@gmail.com`).  
Repo: <https://github.com/AndresArreguy/ecc-pi-port>

El primer publish se hizo manual con un token granular (bypass 2FA). A partir de
ahora, la idea es publicar desde GitHub Actions con **Trusted Publishing (OIDC)**:
sin `NPM_TOKEN`, sin OTP y con provenance.

## 1. Configurar Trusted Publishing (una vez)

1. Iniciar sesión en npmjs.com con la cuenta dueña del paquete
   (`andresarreguydev`).
2. Ir a la página del paquete → **Settings** → **Trusted Publisher**.
3. Elegir **GitHub Actions** y completar:
   - **Owner / organization:** `AndresArreguy`
   - **Repository:** `ecc-pi-port`
   - **Workflow filename:** `release.yml`
   - **Environment:** vacío (el workflow no usa environment)
4. Guardar.

Si existe el secret `NPM_TOKEN` en GitHub → Settings → Secrets → Actions, se
puede borrar: el workflow ya no lo usa.

> El workflow `.github/workflows/release.yml` está preparado para OIDC:
> `permissions.id-token: write`, sin `NODE_AUTH_TOKEN`, verifica que el tag
> coincida con `package.json` y publica con `--provenance`.

## 2. Preparar una release

```bash
# desde main, working tree limpio
npm version patch        # o minor / major
# esto actualiza package.json + package-lock y crea commit + tag vX.Y.Z
```

Antes de pushear:

- [ ] `CHANGELOG.md` tiene la sección `## [X.Y.Z]`
- [ ] `ecc.lock` está actualizado (`npm run update-ecc -- <ref>` si cambió ECC)
- [ ] `npm run verify` pasa
- [ ] `npm run release:check` pasa
- [ ] Los badges del README apuntan al paquete correcto

## 3. Publicar

```bash
git push --follow-tags
```

Eso dispara `release.yml`:

1. `npm ci`
2. `npm run setup -- --skip-install` (clona ECC en `ecc.lock` + build)
3. chequeo tag == `package.json.version`
4. `npm publish --provenance --access public` con OIDC

Verificar:

```bash
npm view ecc-pi-port version
npm view ecc-pi-port dist-tags.latest
```

Y en un proyecto limpio:

```bash
pi install npm:ecc-pi-port@X.Y.Z
pi list
```

## 4. Fallback manual (solo si OIDC falla)

Con un token granular de `andresarreguydev` con permiso de publish (y bypass 2FA
si el dispositivo no genera OTP):

```powershell
$env:NODE_AUTH_TOKEN="npm_xxxxxxxx"
npm publish --access public
Remove-Item Env:\NODE_AUTH_TOKEN
```

O en una terminal interactiva con OTP:

```bash
npm publish --access public
# Enter OTP: 123456
```

No guardar tokens en el repo ni en `.npmrc` versionado.

## 5. Reglas y problemas comunes

- **No reutilizar versión:** npm rechaza publicar `X.Y.Z` si ya existe. Si algo
  salió mal, `npm version patch` y publicar de nuevo.
- **No taggear dos veces:** el tag `vX.Y.Z` debe existir una sola vez y coincidir
  con `package.json`.
- **Tag no coincide:** el workflow falla a propósito antes de publicar.
- **403 2FA:** el token/OTP no sirve para writes; usar OIDC o token con bypass.
- **Trusted publisher no configurado:** `npm publish` devuelve 403/404 de OIDC.
  Revisar owner/repo/workflow exactos en npm.
- **El paquete tarda en aparecer:** npm muestra un placeholder temporal
  `0.0.0-stage` mientras procesa; esperar y volver a consultar.
- **Unpublish:** solo dentro de las 72 h y con restricciones. Preferir
  `npm deprecate ecc-pi-port@X.Y.Z "reason"` y publicar un patch.
- **Ownership:** si querés que `andresarreguy` también figure como owner:
  `npm owner add andresarreguy ecc-pi-port` (con la cuenta dueña actual).

## 6. Checklist rápido

```bash
npm run verify
npm run release:check
npm version patch
git push --follow-tags
gh run watch --repo AndresArreguy/ecc-pi-port
npm view ecc-pi-port version
```
