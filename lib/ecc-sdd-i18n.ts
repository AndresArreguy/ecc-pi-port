/**
 * Tiny i18n layer for the SDD model UI.
 *
 * Pi has no locale/language setting, so the extension resolves its own:
 * `ECC_PI_SDD_LANG` > `language` in config > system locale.
 */

export type SddLanguage = "auto" | "es" | "en";
export type ResolvedLanguage = "es" | "en";

export const SDD_LANGUAGES: readonly SddLanguage[] = ["auto", "es", "en"];

export function isSddLanguage(value: unknown): value is SddLanguage {
  return typeof value === "string" && (SDD_LANGUAGES as readonly string[]).includes(value.toLowerCase());
}

const es = {
  "menu.titleActive": "ECC Models — perfil activo: {name}",
  "menu.titleNoActive": "ECC Models — sin perfil activo",
  "menu.edit": "Editar modelos por fase (pantalla única)",
  "menu.load": "Cargar perfil guardado",
  "menu.loadCount": "Cargar perfil guardado ({count})",
  "menu.saveAs": "Guardar perfil actual como…",
  "menu.view": "Ver configuración actual",
  "menu.delete": "Eliminar perfil…",
  "menu.language": "Idioma / Language…",
  "menu.exit": "Salir",
  "menu.closed": "ECC models: selector cerrado.",

  "common.back": "Volver",
  "common.cancelled": "Cancelado",
  "common.none": "(ninguno)",

  "profile.noProfiles": "No hay perfiles guardados. Usá 'Guardar perfil actual como…'.",
  "profile.noProfilesCli": "No hay perfiles guardados. Guardá uno con /ecc-models save <nombre>.",
  "profile.listTitle": "Perfiles guardados (Enter carga y activa)",
  "profile.listHeader": "Perfiles guardados:",
  "profile.loaded": 'Perfil "{name}" cargado y activo.',
  "profile.saved": 'Perfil "{name}" guardado y activo.',
  "profile.deleted": 'Perfil "{name}" eliminado.',
  "profile.namePrompt": "Nombre del perfil:",
  "profile.namePlaceholder": "mi-perfil",
  "profile.deleteTitle": "Perfil a eliminar",
  "profile.deleteConfirmTitle": '¿Eliminar el perfil "{name}"?',
  "profile.deleteConfirmMessage": "Esta acción no se puede deshacer.",
  "profile.notFound": 'el perfil "{name}" no existe',
  "profile.saveFailed": "no se pudo guardar el perfil",
  "profile.summaryOnePhase": "1 fase",
  "profile.summaryPhases": "{count} fases",

  "validate.nameEmpty": "el nombre no puede estar vacío",
  "validate.nameTooLong": "el nombre supera {max} caracteres",
  "validate.nameInvalidChars": "el nombre no puede contener '/' ni caracteres de control",
  "validate.nameReserved": "ese nombre está reservado",

  "config.header": "ECC models config (config/sdd-models.json + config/agents-models.json):",
  "config.activeProfile": "Perfil activo: {name}",
  "config.none": "(ninguno)",
  "config.aliases": "aliases: {list}",
  "config.profiles": "Perfiles guardados: {list}",
  "config.profileLine": "  - {name}: {summary}",

  "editor.title": "ECC Models — fases y agentes",
  "editor.sectionPhases": "  · fases ({count})",
  "editor.sectionAgents": "  · agentes ({count})",
  "editor.headerAgent": "  Agente",
  "editor.statusNoAgents": "No hay agentes en el subset generado (corré npm run build:agents).",
  "editor.statusAgentsSection":
    "Sección agentes: {count} subagentes — A aplica un modelo a todos · T aplica el thinking a todos",
  "editor.statusPhasesSection": "Sección fases SDD",
  "editor.agentWindow": "Mostrando {from}-{to} de {total} agentes · PgUp/PgDn para moverte",
  "editor.filterTitle": "Filtrar agentes",
  "editor.filterDescription": "Escribí para filtrar: {count} de {total} agentes",
  "editor.filterHints": "Enter aplicar filtro · Esc limpiar y salir",
  "editor.filterActive": "Filtro: {query}",
  "editor.filterCleared": "Filtro limpiado.",
  "editor.tableHintsAgents":
    "↑↓ agente · ←→ columna · A modelo a todos · T thinking a todos · Tab/Ctrl+T fases · / filtrar · Enter editar · Ctrl+S guardar · Ctrl+P perfil · Esc cerrar",
  "editor.profile": "Perfil: {name}",
  "editor.profileCustom": "Perfil: (personalizado)",
  "editor.unsaved": "  · cambios sin guardar",
  "editor.headerPhase": "  Fase",
  "editor.headerModel": "Modelo",
  "editor.headerThinking": "Thinking",
  "editor.overrideNone": "(sin override)",
  "editor.tableHints": "↑↓ fase · ←→ columna · Tab/Ctrl+T agentes · Enter editar · Ctrl+S guardar · Ctrl+P guardar perfil · Esc cerrar",
  "editor.modelPickerHints": "↑↓ navegar · Enter elegir · Esc volver · Ctrl+S guardar",
  "editor.thinkingPickerHints": "↑↓ navegar · Enter elegir · Esc volver",
  "editor.profileInputHints": "Enter guardar perfil · Esc cancelar",
  "editor.manualModelHints": "Enter aplicar · Esc cancelar",
  "editor.statusProfileActive": "Perfil activo: {name}",
  "editor.statusNoProfile": "Sin perfil activo (configuración actual)",
  "editor.statusSavedConfig": "Guardado en config/sdd-models.json",
  "editor.statusSavedProfileActive": "Guardado · perfil activo: {name}",
  "editor.statusProfileNameHint": "Nombre del perfil (Enter guarda, Esc cancela)",
  "editor.statusManualHint": "Escribí provider/modelo (Enter aplica, Esc cancela)",
  "editor.statusManualInvalid": "Formato inválido; usá provider/modelo",
  "editor.statusModelSet": "Modelo de {phase}: {model}",
  "editor.statusModelCleared": "Modelo de {phase} limpiado (sin override)",
  "editor.statusThinkingSet": "Thinking de {phase}: {value}",
  "editor.statusModelSetAll": "Modelo de {count} agentes: {model}",
  "editor.statusModelClearedAll": "Modelo limpiado en {count} agentes (sin override)",
  "editor.statusThinkingSetAll": "Thinking de {count} agentes: {value}",
  "editor.statusNoPhases": "No hay fases configuradas.",
  "editor.discarded": "ECC models: cambios descartados (usá Ctrl+S para guardar).",
  "editor.pickerModelTitle": "Modelo para {phase}",
  "editor.pickerThinkingTitle": "Thinking para {phase}",
  "editor.pickerModelTitleAll": "Modelo para {count} agentes",
  "editor.pickerThinkingTitleAll": "Thinking para {count} agentes",
  "editor.currentMixed": "(distintos)",
  "editor.current": "Actual: {value}",
  "editor.search": "Buscar:",
  "editor.saveProfileTitle": "Guardar perfil de modelos",
  "editor.manualModelTitle": "Modelo manual para {phase}",
  "editor.manualModelTitleAll": "Modelo manual para {count} agentes",
  "editor.saveProfileDescription": "Se guardan las fases y los agentes con sus modelos y thinking.",
  "editor.manualModelDescription": "Formato: provider/modelo",
  "editor.nameLabel": "Nombre:",
  "editor.manualLabel": "Provider/modelo:",
  "editor.optionClear": "— sin override (usar el modelo de la sesión) —",
  "editor.optionClearDesc": "Quita provider/model de la fila seleccionada",
  "editor.optionManual": "Escribir provider/modelo…",
  "editor.optionManualDesc": "Para modelos que no aparecen en el registry",
  "editor.thinkingNull": "null (nivel por defecto)",

  "language.title": "Idioma / Language",
  "language.auto": "Automático (según el sistema)",
  "language.es": "Español",
  "language.en": "English",
  "language.current": "Idioma actual: {value}",
  "language.changed": "Idioma: {value}",
  "language.usage": "Usage: /ecc-models language auto|es|en",

  "cli.usage":
    "Usage: /ecc-models [profiles|save <nombre>|load <nombre>|delete <nombre>|language <auto|es|en>] | /ecc-models agents <provider> <model> [thinking] | /ecc-models agents clear | /ecc-models <phase> <provider> <model> [thinking] | /ecc-models <phase> clear | /ecc-models",
  "cli.unknownPhase": "Fase desconocida '{phase}'. Fases conocidas: {list}",
  "cli.cleared": "Configuración de modelo limpiada para la fase '{phase}'.",
  "cli.set": "Fase {phase}: provider={provider} model={model} thinking={thinking}",
  "cli.setAllAgents": "Agentes: {count} pineados a provider={provider} model={model} thinking={thinking}",
  "cli.clearedAllAgents": "Modelo limpiado en {count} agentes.",
  "cli.noAgents": "No hay agentes en el subset generado (corré npm run build:agents).",
} as const;

export type SddStringKey = keyof typeof es;
export type Translator = (key: SddStringKey, vars?: Record<string, string | number>) => string;

const en: Record<SddStringKey, string> = {
  "menu.titleActive": "ECC Models — active profile: {name}",
  "menu.titleNoActive": "ECC Models — no active profile",
  "menu.edit": "Edit phase models (single screen)",
  "menu.load": "Load saved profile",
  "menu.loadCount": "Load saved profile ({count})",
  "menu.saveAs": "Save current profile as…",
  "menu.view": "View current configuration",
  "menu.delete": "Delete profile…",
  "menu.language": "Language / Idioma…",
  "menu.exit": "Exit",
  "menu.closed": "ECC models: selector closed.",

  "common.back": "Back",
  "common.cancelled": "Cancelled",
  "common.none": "(none)",

  "profile.noProfiles": "No saved profiles. Use 'Save current profile as…'.",
  "profile.noProfilesCli": "No saved profiles. Save one with /ecc-models save <name>.",
  "profile.listTitle": "Saved profiles (Enter loads and activates)",
  "profile.listHeader": "Saved profiles:",
  "profile.loaded": 'Profile "{name}" loaded and active.',
  "profile.saved": 'Profile "{name}" saved and active.',
  "profile.deleted": 'Profile "{name}" deleted.',
  "profile.namePrompt": "Profile name:",
  "profile.namePlaceholder": "my-profile",
  "profile.deleteTitle": "Profile to delete",
  "profile.deleteConfirmTitle": 'Delete profile "{name}"?',
  "profile.deleteConfirmMessage": "This action cannot be undone.",
  "profile.notFound": 'profile "{name}" does not exist',
  "profile.saveFailed": "could not save the profile",
  "profile.summaryOnePhase": "1 phase",
  "profile.summaryPhases": "{count} phases",

  "validate.nameEmpty": "name cannot be empty",
  "validate.nameTooLong": "name exceeds {max} characters",
  "validate.nameInvalidChars": "name cannot contain '/' or control characters",
  "validate.nameReserved": "that name is reserved",

  "config.header": "ECC models config (config/sdd-models.json + config/agents-models.json):",
  "config.activeProfile": "Active profile: {name}",
  "config.none": "(none)",
  "config.aliases": "aliases: {list}",
  "config.profiles": "Saved profiles: {list}",
  "config.profileLine": "  - {name}: {summary}",

  "editor.title": "ECC Models — phases and agents",
  "editor.sectionPhases": "  · phases ({count})",
  "editor.sectionAgents": "  · agents ({count})",
  "editor.headerAgent": "  Agent",
  "editor.statusNoAgents": "No agents in the generated subset (run npm run build:agents).",
  "editor.statusAgentsSection":
    "Agents section: {count} subagents — A applies one model to all · T applies the thinking level to all",
  "editor.statusPhasesSection": "SDD phases section",
  "editor.agentWindow": "Showing {from}-{to} of {total} agents · PgUp/PgDn to move",
  "editor.filterTitle": "Filter agents",
  "editor.filterDescription": "Type to filter: {count} of {total} agents",
  "editor.filterHints": "Enter apply filter · Esc clear and exit",
  "editor.filterActive": "Filter: {query}",
  "editor.filterCleared": "Filter cleared.",
  "editor.tableHintsAgents":
    "↑↓ agent · ←→ column · A model for all · T thinking for all · Tab/Ctrl+T phases · / filter · Enter edit · Ctrl+S save · Ctrl+P profile · Esc close",
  "editor.profile": "Profile: {name}",
  "editor.profileCustom": "Profile: (custom)",
  "editor.unsaved": "  · unsaved changes",
  "editor.headerPhase": "  Phase",
  "editor.headerModel": "Model",
  "editor.headerThinking": "Thinking",
  "editor.overrideNone": "(no override)",
  "editor.tableHints": "↑↓ phase · ←→ column · Tab/Ctrl+T agents · Enter edit · Ctrl+S save · Ctrl+P save profile · Esc close",
  "editor.modelPickerHints": "↑↓ navigate · Enter select · Esc back · Ctrl+S save",
  "editor.thinkingPickerHints": "↑↓ navigate · Enter select · Esc back",
  "editor.profileInputHints": "Enter save profile · Esc cancel",
  "editor.manualModelHints": "Enter apply · Esc cancel",
  "editor.statusProfileActive": "Active profile: {name}",
  "editor.statusNoProfile": "No active profile (current configuration)",
  "editor.statusSavedConfig": "Saved to config/sdd-models.json",
  "editor.statusSavedProfileActive": "Saved · active profile: {name}",
  "editor.statusProfileNameHint": "Profile name (Enter saves, Esc cancels)",
  "editor.statusManualHint": "Type provider/model (Enter applies, Esc cancels)",
  "editor.statusManualInvalid": "Invalid format; use provider/model",
  "editor.statusModelSet": "Model for {phase}: {model}",
  "editor.statusModelCleared": "Model for {phase} cleared (no override)",
  "editor.statusThinkingSet": "Thinking for {phase}: {value}",
  "editor.statusModelSetAll": "Model for {count} agents: {model}",
  "editor.statusModelClearedAll": "Model cleared on {count} agents (no override)",
  "editor.statusThinkingSetAll": "Thinking for {count} agents: {value}",
  "editor.statusNoPhases": "No phases configured.",
  "editor.discarded": "ECC models: changes discarded (use Ctrl+S to save).",
  "editor.pickerModelTitle": "Model for {phase}",
  "editor.pickerThinkingTitle": "Thinking for {phase}",
  "editor.pickerModelTitleAll": "Model for {count} agents",
  "editor.pickerThinkingTitleAll": "Thinking for {count} agents",
  "editor.currentMixed": "(mixed)",
  "editor.current": "Current: {value}",
  "editor.search": "Search:",
  "editor.saveProfileTitle": "Save model profile",
  "editor.manualModelTitle": "Manual model for {phase}",
  "editor.manualModelTitleAll": "Manual model for {count} agents",
  "editor.saveProfileDescription": "Phases and agents are saved with their models and thinking.",
  "editor.manualModelDescription": "Format: provider/model",
  "editor.nameLabel": "Name:",
  "editor.manualLabel": "Provider/model:",
  "editor.optionClear": "— no override (use the session model) —",
  "editor.optionClearDesc": "Removes provider/model from the selected row",
  "editor.optionManual": "Type provider/model…",
  "editor.optionManualDesc": "For models missing from the registry",
  "editor.thinkingNull": "null (default level)",

  "language.title": "Language / Idioma",
  "language.auto": "Automatic (system)",
  "language.es": "Español",
  "language.en": "English",
  "language.current": "Current language: {value}",
  "language.changed": "Language: {value}",
  "language.usage": "Usage: /ecc-models language auto|es|en",

  "cli.usage":
    "Usage: /ecc-models [profiles|save <name>|load <name>|delete <name>|language <auto|es|en>] | /ecc-models agents <provider> <model> [thinking] | /ecc-models agents clear | /ecc-models <phase> <provider> <model> [thinking] | /ecc-models <phase> clear | /ecc-models",
  "cli.unknownPhase": "Unknown phase '{phase}'. Known phases: {list}",
  "cli.cleared": "Cleared model config for phase '{phase}'.",
  "cli.set": "Phase {phase}: provider={provider} model={model} thinking={thinking}",
  "cli.setAllAgents": "Agents: {count} pinned to provider={provider} model={model} thinking={thinking}",
  "cli.clearedAllAgents": "Cleared model config for {count} agents.",
  "cli.noAgents": "No agents in the generated subset (run npm run build:agents).",
};

export const SDD_STRINGS: Record<ResolvedLanguage, Record<SddStringKey, string>> = { es, en };

/** Detect the system language, defaulting to English for non-Spanish locales. */
export function detectSystemLanguage(
  env: NodeJS.ProcessEnv = process.env,
  locale?: string,
): ResolvedLanguage {
  let intlLocale = locale;
  if (!intlLocale) {
    try {
      intlLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      intlLocale = undefined;
    }
  }

  const candidates = [
    env.LC_ALL,
    env.LC_MESSAGES,
    env.LANG,
    env.LANGUAGE,
    intlLocale,
  ];

  for (const candidate of candidates) {
    const value = String(candidate ?? "").trim().toLowerCase();
    if (!value || value === "c" || value === "posix") continue;
    if (value.startsWith("es")) return "es";
    if (/^[a-z]{2}/.test(value)) return "en";
  }
  return "en";
}

function normalizePreference(value: unknown): SddLanguage | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return isSddLanguage(normalized) ? normalized : null;
}

/**
 * Resolve the language with precedence: env override > config > system.
 * `auto` (or an invalid value) delegates to the next source.
 */
export function resolveLanguage(
  preference?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  locale?: string,
): ResolvedLanguage {
  const envPreference = normalizePreference(env.ECC_PI_SDD_LANG);
  if (envPreference === "es" || envPreference === "en") return envPreference;

  const configPreference = normalizePreference(preference);
  if (configPreference === "es" || configPreference === "en") return configPreference;

  return detectSystemLanguage(env, locale);
}

/** Build a translator for a resolved language with `{placeholder}` interpolation. */
export function createTranslator(lang: ResolvedLanguage): Translator {
  const dictionary = SDD_STRINGS[lang] ?? SDD_STRINGS.en;
  return (key, vars) => {
    const template = dictionary[key] ?? SDD_STRINGS.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (match, name) => {
      if (!vars || !(name in vars)) return match;
      return String(vars[name]);
    });
  };
}

/** Human label for a stored preference (`auto`, `es`, `en`). */
export function languageLabel(t: Translator, value: SddLanguage | undefined | null): string {
  if (value === "es") return t("language.es");
  if (value === "en") return t("language.en");
  return t("language.auto");
}
