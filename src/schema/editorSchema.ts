export type BuilderComponentType =
  | "text"
  | "textarea"
  | "richText"
  | "number"
  | "integer"
  | "decimal"
  | "checkbox"
  | "toggle"
  | "select"
  | "multiSelect"
  | "radio"
  | "date"
  | "datetime"
  | "time"
  | "email"
  | "url"
  | "file"
  | "image"
  | "table"
  | "repeater"
  | "computed"
  | "reference"
  | "formula"
  | "json";

export type BuilderFunctionKey =
  | "stableIds"
  | "exportHtml"
  | "exportJson"
  | "numbering"
  | "references"
  | "validation"
  | "conditionalFields"
  | "dictionaries"
  | "auditTrail";

export type ConditionOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "in"
  | "notIn"
  | "greaterThan"
  | "lessThan"
  | "greaterOrEqual"
  | "lessOrEqual"
  | "isEmpty"
  | "isNotEmpty"
  | "startsWith"
  | "endsWith"
  | "matchesRegex";

export type Condition =
  | { field: string; operator: ConditionOperator; value?: unknown }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type FieldValidation = {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  regex?: string;
  integer?: boolean;
  message?: string;
};

export type BuilderField = {
  id: string;
  key: string;
  label: string;
  component: BuilderComponentType;
  required: boolean;
  options: string;
  defaultValue?: unknown;
  placeholder?: string;
  helpText?: string;
  readonly?: boolean;
  hidden?: boolean;
  dictionary?: string;
  allowCustomValue?: boolean;
  visibleWhen?: Condition | null;
  requiredWhen?: Condition | null;
  validation?: FieldValidation;
  fields?: BuilderField[];
  columns?: BuilderField[];
};

export type BuilderSection = {
  id: string;
  title: string;
  description: string;
  fields: BuilderField[];
  visibleWhen?: Condition | null;
};

export type EditorDefinition = {
  id: string;
  name: string;
  version: string;
  description: string;
  functions: BuilderFunctionKey[];
  dictionaries: Record<string, string[]>;
  sections: BuilderSection[];
};

export const BUILDER_STORAGE_KEY = "lp-editor-builder-definitions-v2";

export const componentRegistry: Array<{ type: BuilderComponentType; label: string; description: string }> = [
  { type: "text", label: "Text", description: "Jednoradkovy textovy vstup." },
  { type: "textarea", label: "Vice radku", description: "Delsi text se zachovanim odradkovani." },
  { type: "richText", label: "Rich text", description: "Formatovany obsah vcetne tabulek a obrazku." },
  { type: "number", label: "Cislo", description: "Ciselna hodnota." },
  { type: "integer", label: "Cele cislo", description: "Ciselna hodnota bez desetinne casti." },
  { type: "decimal", label: "Decimalni cislo", description: "Ciselna hodnota s desetinnou casti." },
  { type: "checkbox", label: "Checkbox", description: "Ano/ne hodnota." },
  { type: "toggle", label: "Prepinac", description: "Kompaktni ano/ne hodnota." },
  { type: "select", label: "Vyber + vlastni", description: "Ciselnik s moznosti zadat vlastni hodnotu." },
  { type: "multiSelect", label: "Vice hodnot", description: "Vyber vice hodnot z ciselniku." },
  { type: "radio", label: "Radio", description: "Jedna hodnota z maleho poctu voleb." },
  { type: "date", label: "Datum", description: "Datumovy vstup." },
  { type: "datetime", label: "Datum a cas", description: "Datumovy vstup vcetne casu." },
  { type: "time", label: "Cas", description: "Casovy vstup." },
  { type: "email", label: "E-mail", description: "E-mailova adresa." },
  { type: "url", label: "URL", description: "Webovy odkaz." },
  { type: "file", label: "Soubor", description: "Evidence souboru nebo odkazu na prilohu." },
  { type: "image", label: "Obrazek", description: "URL nebo data URL obrazku." },
  { type: "table", label: "Tabulka", description: "Strukturovana tabulka s definovanymi sloupci." },
  { type: "repeater", label: "Opakovatelny blok", description: "Seznam objektu se stejnymi poli." },
  { type: "computed", label: "Vypocet", description: "Hodnota odvozena ze sablony nebo dalsich poli." },
  { type: "reference", label: "Reference", description: "Odkaz na jiny atribut nebo blok." },
  { type: "formula", label: "Vzorec", description: "Matematicky nebo textovy vzorec." },
  { type: "json", label: "JSON", description: "Pokrocila strukturovana hodnota." },
];

export const functionRegistry: Array<{ key: BuilderFunctionKey; label: string; description: string }> = [
  { key: "stableIds", label: "Stabilni ID", description: "Kazde pole i zaznam ma technicke ID pro API a odkazy." },
  { key: "numbering", label: "Cislovani", description: "Prezencni/exportni cisla se prepocitaji podle poradi." },
  { key: "references", label: "Odkazy", description: "Atributy lze adresovat pres API bez zahlceni UI." },
  { key: "conditionalFields", label: "Podminky", description: "Pole a sekce mohou reagovat na vyplnene hodnoty." },
  { key: "validation", label: "Validace", description: "Povinna pole a pravidla pred ulozenim/exportem." },
  { key: "dictionaries", label: "Ciselniky", description: "Sdilene seznamy hodnot pro selecty a tabulky." },
  { key: "auditTrail", label: "Audit", description: "Zaklad pro historii zmen a kontrolu zasahu." },
  { key: "exportHtml", label: "Export HTML", description: "Export struktury jako rekonstruovatelny HTML dokument." },
  { key: "exportJson", label: "Export JSON", description: "Export dat i definice editoru pro dalsi zpracovani." },
];

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const slugifyKey = (label: string) =>
  label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "pole";

export const createField = (label = "Nove pole", component: BuilderComponentType = "text"): BuilderField => ({
  id: uid("field"),
  key: slugifyKey(label),
  label,
  component,
  required: false,
  options: "",
  allowCustomValue: component === "select",
  visibleWhen: null,
  requiredWhen: null,
  validation: {},
});

export const createSection = (title = "Nova sekce"): BuilderSection => ({
  id: uid("section"),
  title,
  description: "",
  fields: [createField("Nazev")],
  visibleWhen: null,
});

export const createEditorDefinition = (name = "Novy editor"): EditorDefinition => ({
  id: uid("editor"),
  name,
  version: "1.0.0",
  description: "Konfigurovatelny editor slozeny z predpripravenych komponent a funkci.",
  functions: ["stableIds", "exportJson", "conditionalFields", "validation"],
  dictionaries: {},
  sections: [createSection("Zakladni udaje")],
});

export function normalizeField(field: Partial<BuilderField>, fallbackLabel = "Pole"): BuilderField {
  const label = field.label || fallbackLabel;
  const component = field.component || "text";
  return {
    id: field.id || uid("field"),
    key: field.key || slugifyKey(label),
    label,
    component,
    required: Boolean(field.required),
    options: field.options || "",
    defaultValue: field.defaultValue,
    placeholder: field.placeholder || "",
    helpText: field.helpText || "",
    readonly: Boolean(field.readonly),
    hidden: Boolean(field.hidden),
    dictionary: field.dictionary || "",
    allowCustomValue: field.allowCustomValue ?? component === "select",
    visibleWhen: field.visibleWhen || null,
    requiredWhen: field.requiredWhen || null,
    validation: field.validation || {},
    fields: field.fields?.map((child, index) => normalizeField(child, `Pole ${index + 1}`)),
    columns: field.columns?.map((child, index) => normalizeField(child, `Sloupec ${index + 1}`)),
  };
}

export function normalizeDefinition(input: Partial<EditorDefinition>): EditorDefinition {
  return {
    id: input.id || uid("editor"),
    name: input.name || "Editor",
    version: input.version || "1.0.0",
    description: input.description || "",
    functions: input.functions?.length ? input.functions : ["stableIds", "exportJson"],
    dictionaries: input.dictionaries || {},
    sections: (input.sections?.length ? input.sections : [createSection("Zakladni udaje")]).map((section, index) => ({
      id: section.id || uid("section"),
      title: section.title || `Sekce ${index + 1}`,
      description: section.description || "",
      visibleWhen: section.visibleWhen || null,
      fields: (section.fields?.length ? section.fields : [createField("Nazev")]).map((field, fieldIndex) => normalizeField(field, `Pole ${fieldIndex + 1}`)),
    })),
  };
}

export function loadEditorDefinitions(): EditorDefinition[] {
  const saved = localStorage.getItem(BUILDER_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length) return parsed.map(normalizeDefinition);
    } catch {
      localStorage.removeItem(BUILDER_STORAGE_KEY);
    }
  }
  return [
    normalizeDefinition({
      id: "editor-general-documents",
      name: "Univerzalni dokumentovy editor",
      description: "Startovni konfigurace pro dalsi dokumenty: sekce, pole, rich-text, tabulky, podminky a exporty.",
      functions: ["stableIds", "references", "conditionalFields", "validation", "dictionaries", "exportHtml", "exportJson"],
      dictionaries: {
        frekvence: ["1x denne", "1x tydne", "1x mesicne", "pri zmene"],
        typ_dokumentu: ["Smernice", "LP", "Kontrolni protokol", "Checklist"],
      },
      sections: [
        {
          id: "section-basic",
          title: "Identifikace dokumentu",
          description: "Zakladni metadata spolecna pro dokument.",
          fields: [
            { ...createField("Typ dokumentu", "select"), id: "field-doc-type", key: "typ_dokumentu", required: true, dictionary: "typ_dokumentu" },
            { ...createField("Cislo dokumentu"), id: "field-doc-number", key: "cislo_dokumentu", required: true, validation: { minLength: 2 } },
            { ...createField("Nazev dokumentu"), id: "field-doc-title", key: "nazev_dokumentu", required: true, validation: { minLength: 3 } },
          ],
        },
        {
          id: "section-content",
          title: "Obsah",
          description: "Hlavni editovatelny obsah.",
          fields: [
            { ...createField("Text kapitoly", "richText"), id: "field-rich-content", key: "html_obsah" },
            { ...createField("Vyžaduje kontrolu", "checkbox"), id: "field-needs-review", key: "vyzaduje_kontrolu" },
            {
              ...createField("Popis kontroly", "textarea"),
              id: "field-review-description",
              key: "popis_kontroly",
              visibleWhen: { field: "vyzaduje_kontrolu", operator: "equals", value: true },
              requiredWhen: { field: "vyzaduje_kontrolu", operator: "equals", value: true },
            },
            { ...createField("Frekvence", "select"), id: "field-frequency", key: "frekvence", dictionary: "frekvence", allowCustomValue: true },
          ],
        },
        {
          id: "section-table",
          title: "Kontrolni body",
          description: "Ukazka strukturovane tabulky.",
          fields: [
            {
              ...createField("Kontrolni body", "table"),
              id: "field-control-points",
              key: "kontrolni_body",
              columns: [
                { ...createField("Popis", "textarea"), key: "popis", required: true },
                { ...createField("Vysledek", "select"), key: "vysledek", options: "OK\nNOK\nN/A" },
              ],
            },
          ],
        },
      ],
    }),
  ];
}

const isEmpty = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);

export function evaluateCondition(condition: Condition | null | undefined, values: Record<string, unknown>): boolean {
  if (!condition) return true;
  if ("all" in condition) return condition.all.every((item) => evaluateCondition(item, values));
  if ("any" in condition) return condition.any.some((item) => evaluateCondition(item, values));
  if ("not" in condition) return !evaluateCondition(condition.not, values);

  const actual = values[condition.field];
  const expected = condition.value;
  switch (condition.operator) {
    case "equals": return actual === expected;
    case "notEquals": return actual !== expected;
    case "contains": return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? "").includes(String(expected ?? ""));
    case "notContains": return Array.isArray(actual) ? !actual.includes(expected) : !String(actual ?? "").includes(String(expected ?? ""));
    case "in": return Array.isArray(expected) ? expected.includes(actual) : false;
    case "notIn": return Array.isArray(expected) ? !expected.includes(actual) : true;
    case "greaterThan": return Number(actual) > Number(expected);
    case "lessThan": return Number(actual) < Number(expected);
    case "greaterOrEqual": return Number(actual) >= Number(expected);
    case "lessOrEqual": return Number(actual) <= Number(expected);
    case "isEmpty": return isEmpty(actual);
    case "isNotEmpty": return !isEmpty(actual);
    case "startsWith": return String(actual ?? "").startsWith(String(expected ?? ""));
    case "endsWith": return String(actual ?? "").endsWith(String(expected ?? ""));
    case "matchesRegex":
      try {
        return new RegExp(String(expected ?? "")).test(String(actual ?? ""));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function isFieldRequired(field: BuilderField, values: Record<string, unknown>) {
  return Boolean(field.required || evaluateCondition(field.requiredWhen, values));
}

export function getFieldOptions(field: BuilderField, definition: EditorDefinition) {
  const dictionaryOptions = field.dictionary ? definition.dictionaries[field.dictionary] || [] : [];
  const localOptions = field.options.split(/\r?\n/).map((option) => option.trim()).filter(Boolean);
  return [...dictionaryOptions, ...localOptions];
}

export function validateFieldValue(field: BuilderField, value: unknown, values: Record<string, unknown>) {
  if (field.hidden || !evaluateCondition(field.visibleWhen, values)) return "";
  if (isFieldRequired(field, values) && isEmpty(value)) return `${field.label} je povinne pole.`;
  const validation = field.validation || {};
  if (validation.minLength && String(value || "").length < validation.minLength) return validation.message || `${field.label} musi mit alespon ${validation.minLength} znaku.`;
  if (validation.maxLength && String(value || "").length > validation.maxLength) return validation.message || `${field.label} muze mit nejvyse ${validation.maxLength} znaku.`;
  if (validation.min !== undefined && Number(value) < validation.min) return validation.message || `${field.label} musi byt alespon ${validation.min}.`;
  if (validation.max !== undefined && Number(value) > validation.max) return validation.message || `${field.label} muze byt nejvyse ${validation.max}.`;
  if (validation.integer && value !== "" && !Number.isInteger(Number(value))) return validation.message || `${field.label} musi byt cele cislo.`;
  if (validation.regex) {
    try {
      if (value && !new RegExp(validation.regex).test(String(value))) return validation.message || `${field.label} nema spravny format.`;
    } catch {
      return `${field.label} ma neplatny regularni vyraz ve schematu.`;
    }
  }
  return "";
}
