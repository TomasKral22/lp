import {
  BuilderField,
  EditorDefinition,
  evaluateCondition,
  validateFieldValue,
} from "../schema/editorSchema";

export function createEmptyRuntimeData(definition: EditorDefinition) {
  const data: Record<string, unknown> = {};
  for (const section of definition.sections) {
    for (const field of section.fields) data[field.key] = defaultValueForField(field);
  }
  return data;
}

export function collectValidationMessages(definition: EditorDefinition, values: Record<string, unknown>) {
  return definition.sections
    .filter((section) => evaluateCondition(section.visibleWhen, values))
    .flatMap((section) => section.fields.map((field) => validateFieldValue(field, values[field.key], values)))
    .filter(Boolean);
}

export function renderComputedValue(field: BuilderField, values: Record<string, unknown>) {
  return (field.options || "").replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, key) => String(values[key] ?? ""));
}

function defaultValueForField(field: BuilderField): unknown {
  if (field.defaultValue !== undefined) return field.defaultValue;
  switch (field.component) {
    case "checkbox":
    case "toggle":
      return false;
    case "multiSelect":
    case "table":
    case "repeater":
      return [];
    case "json":
      return {};
    default:
      return "";
  }
}
