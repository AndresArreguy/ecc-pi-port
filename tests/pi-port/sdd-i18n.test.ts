import test from "node:test";
import assert from "node:assert/strict";
import {
  SDD_STRINGS,
  createTranslator,
  detectSystemLanguage,
  isSddLanguage,
  languageLabel,
  resolveLanguage,
} from "../../lib/ecc-sdd-i18n.ts";

test("Spanish and English dictionaries have the same keys", () => {
  const esKeys = Object.keys(SDD_STRINGS.es).sort();
  const enKeys = Object.keys(SDD_STRINGS.en).sort();
  assert.deepEqual(enKeys, esKeys);
});

test("translator interpolates placeholders and keeps unknown ones", () => {
  const es = createTranslator("es");
  assert.equal(es("profile.saved", { name: "rápido" }), 'Perfil "rápido" guardado y activo.');

  const en = createTranslator("en");
  assert.equal(en("profile.saved", { name: "fast" }), 'Profile "fast" saved and active.');
  assert.equal(en("language.es"), "Español");
  assert.match(en("editor.tableHints"), /Ctrl\+S save/);
  assert.match(es("editor.tableHints"), /Ctrl\+S guardar/);
});

test("isSddLanguage accepts only auto, es and en (case-insensitive)", () => {
  assert.equal(isSddLanguage("auto"), true);
  assert.equal(isSddLanguage("ES"), true);
  assert.equal(isSddLanguage("en"), true);
  assert.equal(isSddLanguage("fr"), false);
  assert.equal(isSddLanguage(undefined), false);
});

test("detectSystemLanguage maps Spanish locales to es and others to en", () => {
  assert.equal(detectSystemLanguage({ LANG: "es_AR.UTF-8" }, "en-US"), "es");
  assert.equal(detectSystemLanguage({ LC_ALL: "es_ES.UTF-8" }, "en-US"), "es");
  assert.equal(detectSystemLanguage({ LANGUAGE: "es:en" }, "en-US"), "es");
  assert.equal(detectSystemLanguage({ LANG: "en_US.UTF-8" }, "es-AR"), "en");
  assert.equal(detectSystemLanguage({}, "es-AR"), "es");
  assert.equal(detectSystemLanguage({}, "en-US"), "en");
  assert.equal(detectSystemLanguage({ LANG: "C" }, "fr-FR"), "en");
});

test("resolveLanguage precedence is env > config > system", () => {
  const env = { ECC_PI_SDD_LANG: "en", LANG: "es_AR.UTF-8" };
  assert.equal(resolveLanguage("es", env, "es-AR"), "en");

  assert.equal(resolveLanguage("es", { LANG: "en_US.UTF-8" }, "en-US"), "es");
  assert.equal(resolveLanguage("auto", { LANG: "es_AR.UTF-8" }, "es-AR"), "es");

  // An invalid env value falls through to the config.
  assert.equal(resolveLanguage("es", { ECC_PI_SDD_LANG: "fr" }, "en-US"), "es");

  // An explicit auto in env delegates to the config.
  assert.equal(resolveLanguage("en", { ECC_PI_SDD_LANG: "auto" }, "es-AR"), "en");
});

test("languageLabel describes the stored preference", () => {
  const es = createTranslator("es");
  const en = createTranslator("en");
  assert.equal(languageLabel(es, "auto"), "Automático (según el sistema)");
  assert.equal(languageLabel(es, "es"), "Español");
  assert.equal(languageLabel(en, "auto"), "Automatic (system)");
  assert.equal(languageLabel(en, "en"), "English");
});
