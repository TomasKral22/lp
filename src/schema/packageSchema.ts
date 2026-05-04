export type PackageAssetState = "active" | "inactive" | "hidden";

export type PackageDefinition = {
  key: string;
  name: string;
  version: string;
  description?: string;
  extends?: string;
  assets: {
    applications: PackageApplication[];
    objectTypes: PackageObjectType[];
    attributeTypes: PackageAttributeType[];
    hierarchyRules: PackageHierarchyRule[];
    workflows: PackageWorkflow[];
    pages: PackagePage[];
    exports: PackageExport[];
    translations: PackageTranslation[];
    automations: PackageAutomation[];
  };
};

export type PatchPackageDefinition = {
  key: string;
  name: string;
  version: string;
  extends: string;
  patches: PackagePatchOperation[];
};

export type PackagePatchOperation = {
  target: string;
  operation: "merge" | "replace" | "append" | "remove";
  value?: unknown;
};

export type PackageApplication = {
  key: string;
  name: string;
  iconKey?: string;
  rootObjectTypeKey: string;
  state?: PackageAssetState;
};

export type PackageObjectType = {
  key: string;
  name: string;
  description?: string;
  iconKey?: string;
  attributeTypeKeys: string[];
  state?: PackageAssetState;
};

export type PackageAttributeType = {
  key: string;
  name: string;
  type: string;
  mandatory?: boolean;
  dictionaryKey?: string;
  allowCustomValue?: boolean;
  validation?: Record<string, unknown>;
  conditions?: Record<string, unknown>[];
  state?: PackageAssetState;
};

export type PackageHierarchyRule = {
  parentObjectTypeKey: string;
  allowedChildObjectTypeKeys: string[];
};

export type PackageWorkflow = {
  key: string;
  name: string;
  initStateKey: string;
  transitions?: Array<{ name: string; fromStateKey: string; toStateKey: string }>;
};

export type PackagePage = {
  key: string;
  name: string;
  iconKey?: string;
  template: Record<string, unknown>;
};

export type PackageExport = {
  key: string;
  name: string;
  type: "html" | "json" | "docx" | "pdf";
  templateKey?: string;
};

export type PackageTranslation = {
  key: string;
  cs?: string;
  en?: string;
};

export type PackageAutomation = {
  key: string;
  name: string;
  trigger: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
};

export const PACKAGE_STORAGE_KEY = "lp-package-studio-v1";

export const examplePatchPackage: PatchPackageDefinition = {
  key: "lp_custom_patch",
  name: "LP Custom Patch",
  version: "1.0.0",
  extends: "lp_documentation",
  patches: [
    {
      target: "assets.attributeTypes.nadpis",
      operation: "merge",
      value: {
        mandatory: true,
        validation: { minLength: 3 },
      },
    },
  ],
};

export const defaultPackageDefinition: PackageDefinition = {
  key: "lp_documentation",
  name: "LP Documentation Package",
  version: "1.0.0",
  description: "DAWISO-like package konfigurace pro dokumentovy editor.",
  assets: {
    applications: [
      { key: "lp_app", name: "LP Editor", iconKey: "file-text", rootObjectTypeKey: "document" },
    ],
    objectTypes: [
      { key: "document", name: "Dokument", iconKey: "book-open", attributeTypeKeys: ["name"] },
      { key: "chapter", name: "Kapitola", iconKey: "book-open", attributeTypeKeys: ["name", "html_content"] },
      { key: "lp", name: "LP", iconKey: "file-text", attributeTypeKeys: ["cislo_lp", "nadpis"] },
      { key: "lpp", name: "LPP", iconKey: "list", attributeTypeKeys: ["nazev", "zneni", "platnost"] },
      { key: "state", name: "Stav", iconKey: "workflow", attributeTypeKeys: ["nazev_stavu", "zneni_stavu"] },
      { key: "activity", name: "Činnost", iconKey: "check-square", attributeTypeKeys: ["zneni_cinnosti", "doba_provedeni", "operator", "operator_indentation"] },
      { key: "pk_item", name: "PK", iconKey: "table", attributeTypeKeys: ["nazev", "zneni", "frekvence"] },
    ],
    attributeTypes: [
      { key: "name", name: "Název", type: "text", mandatory: true },
      { key: "html_content", name: "HTML obsah", type: "richText" },
      { key: "cislo_lp", name: "Číslo LP", type: "text", mandatory: true },
      { key: "nadpis", name: "Nadpis LP", type: "text", mandatory: true },
      { key: "nazev", name: "Název", type: "text" },
      { key: "zneni", name: "Znění", type: "textarea" },
      { key: "platnost", name: "Platnost", type: "object" },
      { key: "nazev_stavu", name: "Název stavu", type: "text" },
      { key: "zneni_stavu", name: "Znění stavu", type: "textarea" },
      { key: "zneni_cinnosti", name: "Znění činnosti", type: "textarea" },
      { key: "doba_provedeni", name: "Doba provedení", type: "select", allowCustomValue: true },
      { key: "operator", name: "Operátor", type: "select" },
      { key: "operator_indentation", name: "Úroveň odsazení", type: "integer" },
      { key: "frekvence", name: "Frekvence", type: "select", allowCustomValue: true },
    ],
    hierarchyRules: [
      { parentObjectTypeKey: "document", allowedChildObjectTypeKeys: ["chapter"] },
      { parentObjectTypeKey: "chapter", allowedChildObjectTypeKeys: ["chapter", "lp"] },
      { parentObjectTypeKey: "lp", allowedChildObjectTypeKeys: ["lpp", "state", "pk_item"] },
      { parentObjectTypeKey: "state", allowedChildObjectTypeKeys: ["activity"] },
    ],
    workflows: [
      {
        key: "basic_document_workflow",
        name: "Basic document workflow",
        initStateKey: "draft",
        transitions: [
          { name: "Předat ke kontrole", fromStateKey: "draft", toStateKey: "review" },
          { name: "Schválit", fromStateKey: "review", toStateKey: "approved" },
        ],
      },
    ],
    pages: [
      {
        key: "lp_dashboard",
        name: "LP Dashboard",
        iconKey: "layout-dashboard",
        template: {
          centerArea: [
            { componentId: "recent_objects", type: "object-list", objectTypeKey: "lp", layout: "table" },
          ],
        },
      },
    ],
    exports: [
      { key: "lp_html", name: "HTML export", type: "html" },
      { key: "lp_json", name: "JSON export", type: "json" },
    ],
    translations: [],
    automations: [],
  },
};

export function loadPackageDefinition(): PackageDefinition {
  const saved = localStorage.getItem(PACKAGE_STORAGE_KEY);
  if (!saved) return defaultPackageDefinition;
  try {
    return { ...defaultPackageDefinition, ...JSON.parse(saved) };
  } catch {
    localStorage.removeItem(PACKAGE_STORAGE_KEY);
    return defaultPackageDefinition;
  }
}

export function savePackageDefinition(definition: PackageDefinition) {
  localStorage.setItem(PACKAGE_STORAGE_KEY, JSON.stringify(definition));
}
