# Reglas ECC para Pi

Generado por `npm run build` desde `ecc/rules/`. No editar a mano.

Pi no descubre reglas de forma nativa. La extensión `extensions/ecc-rules.ts`
las inyecta en el system prompt cuando se activa `ECC_PI_RULES` o `/ecc-rules`.

| Stack | Archivos | Cómo activarlo |
|---|---|---|
| `angular` | 5 | `ECC_PI_RULES=angular` o `/ecc-rules angular` |
| `arkts` | 5 | `ECC_PI_RULES=arkts` o `/ecc-rules arkts` |
| `common` | 10 | `ECC_PI_RULES=common` o `/ecc-rules common` |
| `cpp` | 5 | `ECC_PI_RULES=cpp` o `/ecc-rules cpp` |
| `csharp` | 5 | `ECC_PI_RULES=csharp` o `/ecc-rules csharp` |
| `dart` | 5 | `ECC_PI_RULES=dart` o `/ecc-rules dart` |
| `fsharp` | 5 | `ECC_PI_RULES=fsharp` o `/ecc-rules fsharp` |
| `golang` | 5 | `ECC_PI_RULES=golang` o `/ecc-rules golang` |
| `java` | 5 | `ECC_PI_RULES=java` o `/ecc-rules java` |
| `kotlin` | 5 | `ECC_PI_RULES=kotlin` o `/ecc-rules kotlin` |
| `nuxt` | 5 | `ECC_PI_RULES=nuxt` o `/ecc-rules nuxt` |
| `perl` | 5 | `ECC_PI_RULES=perl` o `/ecc-rules perl` |
| `php` | 5 | `ECC_PI_RULES=php` o `/ecc-rules php` |
| `python` | 6 | `ECC_PI_RULES=python` o `/ecc-rules python` |
| `react` | 5 | `ECC_PI_RULES=react` o `/ecc-rules react` |
| `react-native` | 8 | `ECC_PI_RULES=react-native` o `/ecc-rules react-native` |
| `ruby` | 5 | `ECC_PI_RULES=ruby` o `/ecc-rules ruby` |
| `rust` | 5 | `ECC_PI_RULES=rust` o `/ecc-rules rust` |
| `swift` | 5 | `ECC_PI_RULES=swift` o `/ecc-rules swift` |
| `typescript` | 5 | `ECC_PI_RULES=typescript` o `/ecc-rules typescript` |
| `vue` | 5 | `ECC_PI_RULES=vue` o `/ecc-rules vue` |
| `web` | 7 | `ECC_PI_RULES=web` o `/ecc-rules web` |

`common` se inyecta siempre junto con el stack elegido.
