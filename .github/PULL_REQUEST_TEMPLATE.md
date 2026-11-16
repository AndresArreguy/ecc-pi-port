## What

<!-- One paragraph: what changed and why. -->

## Layer

- [ ] Extension (`extensions/`)
- [ ] Pure lib / tests (`lib/`, `tests/`)
- [ ] Generator / build / updater (`scripts/`)
- [ ] Hooks adapter / contract
- [ ] Agents runner / config
- [ ] SDD flow / config / docs
- [ ] Packaging / metadata / docs

## How tested

- [ ] `npm run verify`
- [ ] `npm run release:check` (packaging/metadata/updater changes)
- [ ] Manual Pi run (describe the command/phase)
- [ ] Generated artifacts rebuilt with `npm run build` (not hand-edited)

## Checklist

- [ ] Focused PR (one change)
- [ ] `./ecc` is not committed
- [ ] No secrets, sessions, logs or `node_modules`
- [ ] Docs updated when behavior or config changed
- [ ] Security issues reported privately (see SECURITY.md)
