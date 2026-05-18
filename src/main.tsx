import React from "react";
import ReactDOM from "react-dom/client";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { create } from "zustand";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import {
  AlertTriangle,
  BookOpen,
  Braces,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileText,
  GripVertical,
  History,
  ListTree,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Save,
  Settings,
  Wrench,
} from "lucide-react";
import initialData from "../data/lp-data.json";
import {
  BUILDER_STORAGE_KEY,
  BuilderComponentType,
  BuilderField,
  EditorDefinition,
  componentRegistry,
  createEditorDefinition,
  createField,
  createSection,
  evaluateCondition,
  functionRegistry,
  getFieldOptions,
  isFieldRequired,
  loadEditorDefinitions,
  normalizeDefinition,
  validateFieldValue,
} from "./schema/editorSchema";
import { PackageDefinition, loadPackageDefinition, normalizePackageDefinition, savePackageDefinition } from "./schema/packageSchema";
import { collectValidationMessages, createEmptyRuntimeData, renderComputedValue } from "./runtime/runtimeEngine";
import "./styles.css";

type NodeType =
  | "document"
  | "chapter"
  | "lp"
  | "lpp"
  | "validity"
  | "activities"
  | "state"
  | "activity"
  | "pk_section"
  | "pk_item"
  | "additional_info"
  | "custom_object";

type DocumentNode<T = any> = {
  id: string;
  parent_id: string | null;
  type: NodeType;
  order: number;
  number: string;
  title: string;
  children: DocumentNode[];
  data: T;
};

type Lp = any;
type Reference = { id?: string; targetId?: string; valid?: boolean };
type AppMode = "document" | "preview" | "builder";
type WorkflowStatus = "draft" | "review" | "commenting" | "approved" | "waiting_effective" | "effective" | "rejected" | "cancelled" | "archived";
type ControlWork = {
  id: string;
  code: string;
  type: "revision" | "change";
  status: WorkflowStatus;
  title: string;
  owner: string;
  effectiveDate: string;
  note: string;
  baseHash: string;
  treeHash: string;
  baseRoot: DocumentNode;
  draftRoot: DocumentNode;
  createdAt: string;
  approvedAt?: string;
  conflict?: string;
  linkedReview: { confirmed: boolean; checkedNodeIds: string[] };
};
type CreatableNodeType = string;

type AppState = {
  root: DocumentNode;
  publishedRoot: DocumentNode;
  selectedId: string;
  collapsed: Record<string, boolean>;
  selectedForExport: Record<string, boolean>;
  works: ControlWork[];
  activeWorkId: string | null;
  references: Reference[];
  history: string[];
  select: (id: string) => void;
  toggle: (id: string) => void;
  toggleExportSelection: (id: string) => void;
  clearExportSelection: () => void;
  updateNodeData: (id: string, patch: Record<string, any>) => void;
  updateLp: (lpId: string, updater: (lp: Lp) => void, label: string) => void;
  addChapter: (mode: "before" | "after" | "child", anchorId: string) => void;
  addLp: (mode: "before" | "after" | "child", anchorId: string) => void;
  addChildObject: (parentId: string, type: CreatableNodeType) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  moveSibling: (id: string, direction: -1 | 1) => void;
  reorderSiblings: (activeId: string, overId: string) => void;
  addControlWork: (type: "revision" | "change") => void;
  selectControlWork: (id: string | null) => void;
  updateControlWork: (id: string, patch: Partial<ControlWork>) => void;
  approveActiveWork: () => void;
  cancelActiveWork: () => void;
  save: () => void;
  reset: () => void;
};

const STORAGE_KEY = "lp-tree-editor-structure-v2";
const CONTROL_STORAGE_KEY = "lp-document-control-v1";
const OPERATOR_INDENT_SPACES: Record<number, number> = { 1: 0, 2: 4, 3: 8 };
const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  draft: "rozpracováno",
  review: "předáno ke kontrole",
  commenting: "v připomínkování",
  approved: "schváleno",
  waiting_effective: "čeká na účinnost",
  effective: "účinné",
  rejected: "zamítnuto",
  cancelled: "zrušeno",
  archived: "archivováno",
};
const WORKFLOW_STATUSES = Object.keys(WORKFLOW_STATUS_LABELS) as WorkflowStatus[];
const FINAL_WORKFLOW_STATUSES: WorkflowStatus[] = ["approved", "waiting_effective", "effective", "archived"];
const BUILT_IN_OBJECT_TYPE_KEYS = ["chapter", "lp", "lpp", "state", "activity", "pk_item"];
const NODE_TYPE_LABELS: Record<string, string> = {
  chapter: "Kapitola",
  lp: "LP",
  lpp: "LPP",
  state: "Stav",
  activity: "Činnost",
  pk_item: "PK",
};
const DEFAULT_CHILD_RULES: Record<string, string[]> = {
  document: ["chapter"],
  chapter: ["chapter", "lp"],
  lp: ["lpp", "state", "pk_item"],
  lpp: [],
  validity: [],
  activities: [],
  state: ["activity"],
  activity: [],
  pk_section: ["pk_item"],
  pk_item: [],
  additional_info: [],
  custom_object: [],
};

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(value: T): T => structuredClone(value);
const initialRoot = buildInitialRoot(initialData);

function syncActiveWork(state: AppState, root: DocumentNode): Partial<AppState> {
  if (!state.activeWorkId) return { root };
  const syncedWorks = state.works.map((work) => work.id === state.activeWorkId ? { ...work, draftRoot: root, treeHash: simpleHash(JSON.stringify(root)) } : work);
  localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(syncedWorks));
  return { root, works: syncedWorks };
}

function requireActiveWork(state: AppState) {
  if (state.activeWorkId) return true;
  alert("Nejdřív založ nebo vyber revizi/změnu. Editace dokumentu probíhá pouze v rámci práce.");
  return false;
}

function baseNode(type: NodeType, title: string, data: any, parentId: string | null): DocumentNode {
  return { id: data?.id || uid(type), parent_id: parentId, type, order: 1, number: "", title, children: [], data };
}

function normalizeLp(lp: any): Lp {
  const id = lp.id || uid("lp");
  return {
    id,
    cislo_lp: lp.cislo_lp || "",
    nadpis: lp.nadpis || "",
    lpp: (Array.isArray(lp.lpp) ? lp.lpp : [lp.lpp].filter(Boolean)).map((lpp: any, index: number) => ({
      id: lpp.id || `${id}.lpp-${index + 1}`,
      nazev: lpp.nazev || `LPP ${index + 1}`,
      zneni: lpp.zneni || "",
      platnost: {
        id: lpp.platnost?.id || `${id}.lpp-${index + 1}.platnost`,
        rezimy: lpp.platnost?.rezimy || [],
        doplnujici_text: lpp.platnost?.doplnujici_text || "",
        exportovana_hodnota: lpp.platnost?.exportovana_hodnota || "",
      },
    })),
    cinnosti: (lp.cinnosti || lp.stavy || []).map((state: any, stateIndex: number) => ({
      id: state.id || `${id}.stav-${stateIndex + 1}`,
      nazev_stavu: state.nazev_stavu || "",
      zneni_stavu: state.zneni_stavu || "",
      cinnosti: (state.cinnosti || []).map((activity: any, activityIndex: number) => ({
        id: activity.id || `${id}.stav-${stateIndex + 1}.cinnost-${activityIndex + 1}`,
        zneni_cinnosti: activity.zneni_cinnosti || "",
        doba_provedeni: activity.doba_provedeni || "",
        operator: activity.operator || "",
        operator_indentation: Number(activity.operator_indentation || 1),
      })),
    })),
    pk: (lp.pk || []).map((pk: any, index: number) => ({
      id: pk.id || `${id}.pk-${index + 1}`,
      nazev: pk.nazev || "",
      zneni: pk.zneni || "",
      frekvence: pk.frekvence || "",
    })),
    doplnujici_informace: lp.doplnujici_informace || "",
    parserWarnings: lp.parserWarnings || [],
  };
}

function lpToNode(lpInput: any, parentId: string | null): DocumentNode {
  const lp = normalizeLp(lpInput);
  const node = baseNode("lp", lp.nadpis || "Bez nadpisu", lp, parentId);
  node.children = [];
  return node;
}

function chapterToNode(input: any, parentId: string | null): DocumentNode {
  const data = input?.obsah || input || {};
  const chapter = {
    id: data.id || uid("chapter"),
    cislo_kapitoly: data.cislo_kapitoly || "",
    nazev: data.nazev || "Nová kapitola",
    html_obsah: data.html_obsah || "",
  };
  const node = baseNode("chapter", chapter.nazev, chapter, parentId);
  const childBlocks = input?.children || data.children || [];
  node.children = childBlocks.map((child: any) => (child.type === "chapter" || child.typ === "kapitola" ? chapterToNode(child, node.id) : lpToNode(child.obsah || child, node.id)));
  return node;
}

function objectTypeKeyForNode(node: DocumentNode | null) {
  if (!node) return "document";
  return node.type === "custom_object" ? node.data.objectTypeKey || "custom_object" : node.type;
}

function objectTypeLabel(objectTypeKey: string) {
  const packageDefinition = loadPackageDefinition();
  return packageDefinition.assets.objectTypes.find((type) => type.key === objectTypeKey)?.name || NODE_TYPE_LABELS[objectTypeKey] || objectTypeKey;
}

function createNodeByType(type: CreatableNodeType, parentId: string | null): DocumentNode {
  if (type === "chapter") return chapterToNode({}, parentId);
  if (type === "lp") return lpToNode({}, parentId);
  const id = uid(type);
  const dataByType: Record<string, any> = {
    lpp: {
      id,
      nazev: "Nové LPP",
      zneni: "",
      platnost: { id: `${id}.platnost`, rezimy: [], doplnujici_text: "", exportovana_hodnota: "" },
      extra_attributes: [],
    },
    state: { id, nazev_stavu: "Nový stav", zneni_stavu: "", extra_attributes: [] },
    activity: { id, zneni_cinnosti: "", doba_provedeni: "", operator: "", operator_indentation: 1, extra_attributes: [] },
    pk_item: { id, nazev: "Nové PK", zneni: "", frekvence: "", extra_attributes: [] },
  };
  if (BUILT_IN_OBJECT_TYPE_KEYS.includes(type)) return baseNode(type as NodeType, objectTypeLabel(type), dataByType[type], parentId);
  return baseNode("custom_object", objectTypeLabel(type), { id, objectTypeKey: type, title: objectTypeLabel(type), extra_attributes: [] }, parentId);
}

function allowedChildTypes(node: DocumentNode | null) {
  const packageDefinition = loadPackageDefinition();
  const parentKey = objectTypeKeyForNode(node);
  const packageRule = packageDefinition.assets.hierarchyRules.find((rule) => rule.parentObjectTypeKey === parentKey);
  return packageRule?.allowedChildObjectTypeKeys || DEFAULT_CHILD_RULES[parentKey] || [];
}

function buildInitialRoot(source: any): DocumentNode {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return recomputeNumbers(JSON.parse(saved).root);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  const root = baseNode("document", "Dokument", { id: source.document?.id || "document-001" }, null);
  const blocks = source.document?.bloky || [];
  root.children = blocks.map((block: any) =>
    block.typ === "kapitola" ? chapterToNode(block, root.id) : lpToNode(block.obsah || block, root.id),
  );
  if (!root.children.length) root.children = [lpToNode({}, root.id)];
  return recomputeNumbers(root);
}

function recomputeNumbers(root: DocumentNode): DocumentNode {
  const walk = (node: DocumentNode, parentNumber = "") => {
    node.children.forEach((child, index) => {
      child.order = index + 1;
      child.parent_id = node.id;
      if (child.type === "chapter") child.number = parentNumber ? `${parentNumber}.${index + 1}` : `${index + 1}`;
      else if (child.type === "lp") child.number = parentNumber ? `${parentNumber}.${index + 1}` : `${index + 1}`;
      else if (child.type === "activity" || child.type === "pk_item") child.number = `${index + 1}`;
      else child.number = parentNumber;

      if (child.type === "chapter") child.data.cislo_kapitoly = child.number;
      if (child.type === "lp") child.data.cislo_lp = child.data.cislo_lp || child.number;
      child.title = nodeTitle(child);
      walk(child, child.number);
    });
  };
  root.number = "";
  walk(root);
  return root;
}

function nodeTitle(node: DocumentNode) {
  if (node.type === "chapter") return node.data.nazev || "Kapitola";
  if (node.type === "lp") return node.data.nadpis || "LP";
  if (node.type === "lpp") return node.data.nazev || "LPP";
  if (node.type === "state") return node.data.nazev_stavu || "Stav";
  if (node.type === "activity") return node.data.zneni_cinnosti || "Činnost";
  if (node.type === "pk_item") return node.data.nazev || "PK";
  if (node.type === "custom_object") return node.data.title || objectTypeLabel(node.data.objectTypeKey);
  return node.title;
}

function findNode(node: DocumentNode, id: string): DocumentNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(node: DocumentNode, id: string): DocumentNode | null {
  if (node.children.some((child) => child.id === id)) return node;
  for (const child of node.children) {
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

function removeNode(root: DocumentNode, id: string) {
  const parent = findParent(root, id);
  if (!parent) return null;
  const index = parent.children.findIndex((child) => child.id === id);
  const [removed] = parent.children.splice(index, 1);
  return removed || null;
}

function flattenVisible(node: DocumentNode, collapsed: Record<string, boolean>, level = 0): Array<{ node: DocumentNode; level: number }> {
  const rows = node.type === "document" ? [] : [{ node, level }];
  if (!collapsed[node.id]) node.children.forEach((child) => rows.push(...flattenVisible(child, collapsed, level + 1)));
  return rows;
}

function canDrag(node: DocumentNode) {
  return ["chapter", "lp", "lpp", "state", "activity", "pk_item", "custom_object"].includes(node.type);
}

function collectLpData(root: DocumentNode): any[] {
  const result: any[] = [];
  const walk = (node: DocumentNode) => {
    if (node.type === "lp") result.push(node.data);
    node.children.forEach(walk);
  };
  walk(root);
  return result;
}

function exportNode(node: DocumentNode): string {
  if (node.type === "chapter") {
    const children = node.children.map(exportNode).join("\n");
    return `<section class="document-block chapter" data-node-id="${node.id}"><h1>${node.number} ${escapeHtml(node.data.nazev || "")}</h1>${node.data.html_obsah || ""}</section>${children}`;
  }
  if (node.type === "lp") return exportLp(node);
  return exportGenericNode(node);
}

function exportLp(node: DocumentNode): string {
  const lp = node.data;
  const lpp = lp.lpp.map((item: any) => `<h2>${escapeHtml(item.nazev)}</h2><p>${escapeHtml(item.zneni)}</p><p><strong>PLATNOST</strong> ${escapeHtml(formatPlatnost(item.platnost))}</p>`).join("");
  const states = lp.cinnosti.map((state: any) =>
    state.cinnosti.map((activity: any, index: number) =>
      `<tr>${index === 0 ? `<td rowspan="${state.cinnosti.length}">${escapeHtml(`${state.nazev_stavu} ${state.zneni_stavu}`)}</td>` : ""}<td>${escapeHtml(`${state.nazev_stavu || ""}${index + 1}. ${activity.zneni_cinnosti}`)}${activity.operator ? `<span class="operator">${escapeHtml(" ".repeat(OPERATOR_INDENT_SPACES[activity.operator_indentation || 1]) + activity.operator)}</span>` : ""}</td><td>${escapeHtml(activity.doba_provedeni)}</td></tr>`,
    ).join(""),
  ).join("");
  const pk = lp.pk.map((item: any) => `<tr><td>${escapeHtml(item.nazev)}</td><td>${escapeHtml(item.zneni)}</td><td>${escapeHtml(item.frekvence)}</td></tr>`).join("");
  const children = node.children.map(exportNode).join("\n");
  return `<section class="document-block lp" data-node-id="${node.id}"><h1>${node.number} ${escapeHtml(lp.nadpis || "")}</h1>${lpp}<h2>Činnosti</h2><table><thead><tr><th>STAV</th><th>POŽADOVANÁ ČINNOST</th><th>DOBA PROVEDENÍ</th></tr></thead><tbody>${states}</tbody></table><h2>PK</h2><table><thead><tr><th>Název</th><th>Znění PK</th><th>FREKVENCE</th></tr></thead><tbody>${pk}</tbody></table>${lp.doplnujici_informace || ""}</section>${children}`;
}

function exportGenericNode(node: DocumentNode): string {
  const title = `${node.number ? `${node.number} ` : ""}${node.title || NODE_TYPE_LABELS[node.type as CreatableNodeType] || node.type}`;
  const attributes = Object.entries(node.data || {})
    .filter(([key]) => !["id", "extra_attributes", "platnost"].includes(key))
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(typeof value === "string" ? value : JSON.stringify(value))}</td></tr>`)
    .join("");
  const extra = (node.data.extra_attributes || []).map((attr: any) => `<tr><th>${escapeHtml(attr.label || attr.key)}</th><td>${escapeHtml(attr.value || "")}</td></tr>`).join("");
  const children = node.children.map(exportNode).join("\n");
  return `<section class="document-block ${node.type}" data-node-id="${node.id}"><h2>${escapeHtml(title)}</h2><table><tbody>${attributes}${extra}</tbody></table></section>${children}`;
}

function buildExportHtml(root: DocumentNode, selectedIds?: Set<string>) {
  const body = selectedIds?.size ? exportSelectedNodes(root, selectedIds) : root.children.map(exportNode).join("\n");
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>LP export</title><style>body{font-family:Arial,sans-serif;margin:32px;line-height:1.35}.document-block{display:block;margin:0 0 30px;padding-top:1px}.document-block+.document-block{border-top:1px solid transparent;padding-top:18px}table{border-collapse:collapse;width:100%;margin:8px 0 18px}td,th{border:1px solid #777;padding:6px;vertical-align:top;white-space:pre-wrap}th{background:#eee}.operator{display:block;white-space:pre;font-weight:bold;margin-top:4px}img{max-width:100%;height:auto}</style></head><body>${body}<script type="application/json" id="document-tree">${escapeScriptJson(JSON.stringify(root))}</script></body></html>`;
}

function exportSelectedNodes(root: DocumentNode, selectedIds: Set<string>) {
  const walk = (node: DocumentNode): string => {
    if (selectedIds.has(node.id)) return exportNode(node);
    return node.children.map(walk).join("\n");
  };
  return root.children.map(walk).join("\n");
}

function collectSelectedNodes(root: DocumentNode, selectedIds: Set<string>) {
  const result: DocumentNode[] = [];
  const walk = (node: DocumentNode) => {
    if (selectedIds.has(node.id)) {
      result.push(node);
      return;
    }
    node.children.forEach(walk);
  };
  root.children.forEach(walk);
  return result;
}

const useDocStore = create<AppState>((set, get) => ({
  root: initialRoot,
  publishedRoot: initialRoot,
  selectedId: initialRoot.children[0]?.id || "document-001",
  collapsed: {},
  selectedForExport: {},
  works: loadControlWorks(initialRoot),
  activeWorkId: null,
  references: (initialData as any).references || [],
  history: [],
  select: (id) => set({ selectedId: id }),
  toggle: (id) => set((state) => ({ collapsed: { ...state.collapsed, [id]: !state.collapsed[id] } })),
  toggleExportSelection: (id) => set((state) => ({ selectedForExport: { ...state.selectedForExport, [id]: !state.selectedForExport[id] } })),
  clearExportSelection: () => set({ selectedForExport: {} }),
  updateNodeData: (id, patch) => set((state) => {
    if (!requireActiveWork(state)) return state;
    const root = clone(state.root);
    const node = findNode(root, id);
    if (node) {
      node.data = { ...node.data, ...patch };
      node.title = nodeTitle(node);
    }
    const nextRoot = recomputeNumbers(root);
    return { ...syncActiveWork(state, nextRoot), history: [`Upraven uzel ${id}`, ...state.history].slice(0, 20) };
  }),
  updateLp: (lpId, updater, label) => set((state) => {
    if (!requireActiveWork(state)) return state;
    const root = clone(state.root);
    const node = findNode(root, lpId);
    if (node?.type === "lp") {
      updater(node.data);
      node.title = nodeTitle(node);
    }
    const nextRoot = recomputeNumbers(root);
    return { ...syncActiveWork(state, nextRoot), history: [label, ...state.history].slice(0, 20) };
  }),
  addChapter: (mode, anchorId) => set((state) => {
    if (!requireActiveWork(state)) return state;
    const root = clone(state.root);
    const anchor = findNode(root, anchorId) || root.children[0];
    const parent = mode === "child" && anchor?.type === "chapter" ? anchor : findParent(root, anchor?.id || "") || root;
    const index = mode === "before" ? parent.children.findIndex((child) => child.id === anchor.id) : parent.children.findIndex((child) => child.id === anchor.id) + 1;
    const chapter = chapterToNode({}, parent.id);
    parent.children.splice(Math.max(0, index), 0, chapter);
    const nextRoot = recomputeNumbers(root);
    return { ...syncActiveWork(state, nextRoot), selectedId: chapter.id, history: ["Přidána kapitola", ...state.history].slice(0, 20) };
  }),
  addLp: (mode, anchorId) => set((state) => {
    if (!requireActiveWork(state)) return state;
    const root = clone(state.root);
    const anchor = findNode(root, anchorId) || root.children[0];
    const parent = mode === "child" && anchor?.type === "chapter" ? anchor : findParent(root, anchor?.id || "") || root;
    const index = mode === "before" ? parent.children.findIndex((child) => child.id === anchor.id) : parent.children.findIndex((child) => child.id === anchor.id) + 1;
    const lp = lpToNode({}, parent.id);
    parent.children.splice(Math.max(0, index), 0, lp);
    const nextRoot = recomputeNumbers(root);
    return { ...syncActiveWork(state, nextRoot), selectedId: lp.id, history: ["Přidána LP", ...state.history].slice(0, 20) };
  }),
  addChildObject: (parentId, type) => set((state) => {
    if (!requireActiveWork(state)) return state;
    const root = clone(state.root);
    const parent = findNode(root, parentId) || root;
    const allowed = allowedChildTypes(parent);
    if (!allowed.includes(type)) return state;
    const child = createNodeByType(type, parent.id);
    parent.children.push(child);
    const nextRoot = recomputeNumbers(root);
    return { ...syncActiveWork(state, nextRoot), selectedId: child.id, history: [`Přidán objekt ${objectTypeLabel(type)}`, ...state.history].slice(0, 20) };
  }),
  deleteNode: (id) => set((state) => {
    if (!requireActiveWork(state)) return state;
    const root = clone(state.root);
    const node = findNode(root, id);
    if (!node || node.type === "document") return state;
    if ((node.type === "lp" || node.type === "chapter") && !confirm(`Opravdu odstranit ${node.type === "lp" ? "LP" : "kapitolu"}?`)) return state;
    if (node.type === "lp") {
      const ids = new Set([node.id, node.data.id]);
      const hasRefs = state.references.some((ref) => ids.has(ref.id || "") || ids.has(ref.targetId || ""));
      if (hasRefs) {
        alert("Mazání je zablokováno: na LP existují reference v API/DB.");
        return state;
      }
    }
    removeNode(root, id);
    const nextRoot = recomputeNumbers(root);
    return { ...syncActiveWork(state, nextRoot), selectedId: root.children[0]?.id || root.id, history: [`Odstraněn uzel ${id}`, ...state.history].slice(0, 20) };
  }),
  duplicateNode: (id) => set((state) => {
    if (!requireActiveWork(state)) return state;
    const root = clone(state.root);
    const node = findNode(root, id);
    const parent = findParent(root, id);
    if (!node || !parent) return state;
    const copy = clone(node);
    const reid = (item: DocumentNode, parentId: string | null) => {
      item.id = uid(item.type);
      item.parent_id = parentId;
      if (item.data?.id) item.data.id = item.id.replace(/^lp-/, "lp-");
      item.children.forEach((child) => reid(child, item.id));
    };
    reid(copy, parent.id);
    parent.children.splice(parent.children.findIndex((child) => child.id === id) + 1, 0, copy);
    const nextRoot = recomputeNumbers(root);
    return { ...syncActiveWork(state, nextRoot), selectedId: copy.id, history: ["Duplikován blok", ...state.history].slice(0, 20) };
  }),
  moveSibling: (id, direction) => set((state) => {
    if (!requireActiveWork(state)) return state;
    const root = clone(state.root);
    const parent = findParent(root, id);
    if (!parent) return state;
    const index = parent.children.findIndex((child) => child.id === id);
    const next = index + direction;
    if (next < 0 || next >= parent.children.length) return state;
    parent.children = arrayMove(parent.children, index, next);
    const nextRoot = recomputeNumbers(root);
    return { ...syncActiveWork(state, nextRoot), history: ["Přesunut uzel", ...state.history].slice(0, 20) };
  }),
  reorderSiblings: (activeId, overId) => set((state) => {
    if (!requireActiveWork(state)) return state;
    const root = clone(state.root);
    const activeParent = findParent(root, activeId);
    const overParent = findParent(root, overId);
    if (!activeParent || !overParent || activeParent.id !== overParent.id) return state;
    const oldIndex = activeParent.children.findIndex((child) => child.id === activeId);
    const newIndex = activeParent.children.findIndex((child) => child.id === overId);
    activeParent.children = arrayMove(activeParent.children, oldIndex, newIndex);
    const nextRoot = recomputeNumbers(root);
    return { ...syncActiveWork(state, nextRoot), history: ["Přetažen uzel", ...state.history].slice(0, 20) };
  }),
  addControlWork: (type) => set((state) => {
    const nextNumber = state.works.filter((work) => work.type === type).length + 1;
    const baseRoot = clone(state.publishedRoot);
    const draftRoot = clone(state.publishedRoot);
    const work: ControlWork = {
      id: uid(type),
      code: `${type === "revision" ? "R" : "Z"}${String(nextNumber).padStart(3, "0")}`,
      type,
      status: "draft",
      title: type === "revision" ? `Revize ${nextNumber}` : `Změna ${nextNumber}`,
      owner: "Neurčeno",
      effectiveDate: new Date().toISOString().slice(0, 10),
      note: "",
      baseHash: simpleHash(JSON.stringify(baseRoot)),
      treeHash: simpleHash(JSON.stringify(draftRoot)),
      baseRoot,
      draftRoot,
      createdAt: new Date().toISOString(),
      linkedReview: { confirmed: false, checkedNodeIds: [] },
    };
    const works = [work, ...state.works];
    localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(works));
    return { works, activeWorkId: work.id, root: draftRoot, selectedId: draftRoot.children[0]?.id || draftRoot.id, history: [`Založena ${type === "revision" ? "revize" : "změna"} ${work.code}`, ...state.history].slice(0, 20) };
  }),
  selectControlWork: (id) => set((state) => {
    if (!id) return { activeWorkId: null, root: state.publishedRoot, selectedId: state.publishedRoot.children[0]?.id || state.publishedRoot.id };
    const work = state.works.find((item) => item.id === id);
    if (!work) return state;
    return { activeWorkId: work.id, root: clone(work.draftRoot), selectedId: work.draftRoot.children[0]?.id || work.draftRoot.id };
  }),
  updateControlWork: (id, patch) => set((state) => {
    const works = state.works.map((work) => work.id === id ? { ...work, ...patch } : work);
    localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(works));
    return { works };
  }),
  approveActiveWork: () => set((state) => {
    const work = state.works.find((item) => item.id === state.activeWorkId);
    if (!work) return state;
    const publishedHash = simpleHash(JSON.stringify(state.publishedRoot));
    if (publishedHash !== work.baseHash) {
      const works = state.works.map((item) => item.id === work.id ? { ...item, conflict: "Publikovaný dokument se změnil od založení práce. Zkontroluj dopady a založ novou práci nebo obnov základ.", status: "draft" as const } : item);
      localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(works));
      alert("Nelze schválit: publikovaný dokument se změnil od založení této práce.");
      return { works };
    }
    const approvedRoot = recomputeNumbers(clone(state.root));
    const today = new Date().toISOString().slice(0, 10);
    const status: WorkflowStatus = work.effectiveDate <= today ? "effective" : "waiting_effective";
    const approvedWork = { ...work, draftRoot: approvedRoot, treeHash: simpleHash(JSON.stringify(approvedRoot)), status, approvedAt: new Date().toISOString(), conflict: "" };
    const works = state.works.map((item) => item.id === work.id ? approvedWork : item);
    localStorage.setItem(CONTROL_STORAGE_KEY, JSON.stringify(works));
    const publishedRoot = work.effectiveDate <= today ? approvedRoot : state.publishedRoot;
    if (work.effectiveDate <= today) localStorage.setItem(STORAGE_KEY, JSON.stringify({ root: publishedRoot, references: state.references }));
    return { works, publishedRoot, root: publishedRoot, activeWorkId: null, selectedId: publishedRoot.children[0]?.id || publishedRoot.id, history: [`Schváleno ${work.code}`, ...state.history].slice(0, 20) };
  }),
  cancelActiveWork: () => set((state) => ({ activeWorkId: null, root: state.publishedRoot, selectedId: state.publishedRoot.children[0]?.id || state.publishedRoot.id })),
  save: () => {
    const state = get();
    if (state.activeWorkId) {
      const synced = syncActiveWork(state, state.root);
      if (synced.works) set({ works: synced.works });
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ root: state.publishedRoot, references: state.references }));
  },
  reset: () => {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CONTROL_STORAGE_KEY);
    const root = buildInitialRoot(initialData);
    set({ root, publishedRoot: root, works: [], activeWorkId: null, selectedId: root.children[0]?.id || root.id, collapsed: {}, selectedForExport: {}, history: ["Reset na importovaná data"] });
  },
}));

function App() {
  const [mode, setMode] = React.useState<AppMode>("preview");
  const [metadataOpen, setMetadataOpen] = React.useState(true);
  const { root, selectedId, reorderSiblings, select } = useDocStore();
  const selected = findNode(root, selectedId) || root.children[0];
  const visible = flattenVisible(root, useDocStore.getState().collapsed);

  const onDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) reorderSiblings(String(event.active.id), String(event.over.id));
  };

  return (
    <div className="app-shell">
      <TopToolbar mode={mode} onModeChange={setMode} metadataOpen={metadataOpen} onToggleMetadata={() => setMetadataOpen((open) => !open)} />
      {mode === "builder" ? <BuilderWorkspace /> : mode === "preview" ? <PreviewWorkspace root={root} onEditNode={(id) => { select(id); setMode("document"); }} /> : <div className={metadataOpen ? "layout" : "layout metadata-collapsed"}>
        <aside className="sidebar">
          <DocumentControlPanel />
          <div className="panel-head">
            <div className="panel-title"><ListTree size={18} /> Strom dokumentu</div>
            <p>Stabilní ID zůstává, čísla se přepočítávají podle stromu.</p>
          </div>
          <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={visible.filter(({ node }) => canDrag(node)).map(({ node }) => node.id)} strategy={verticalListSortingStrategy}>
              <div className="tree-list">{visible.map((item) => <TreeRow key={item.node.id} node={item.node} level={item.level} />)}</div>
            </SortableContext>
          </DndContext>
        </aside>
        <main className="main-pane">{selected ? <NodeDetail node={selected} /> : null}</main>
        {metadataOpen ? <RightPanel node={selected} /> : null}
      </div>}
    </div>
  );
}

function TopToolbar({ mode, onModeChange, metadataOpen, onToggleMetadata }: { mode: AppMode; onModeChange: (mode: AppMode) => void; metadataOpen: boolean; onToggleMetadata: () => void }) {
  const { selectedId, selectedForExport, activeWorkId, works, clearExportSelection, save, root } = useDocStore();
  const selected = findNode(root, selectedId) || root;
  const activeWork = works.find((work) => work.id === activeWorkId);
  const selectedExportIds = Object.entries(selectedForExport).filter(([, checked]) => checked).map(([id]) => id);
  const exportHtml = () => download("lp-export.html", buildExportHtml(root), "text/html;charset=utf-8");
  const exportDoc = () => download("lp-export.doc", buildExportHtml(root), "application/msword;charset=utf-8");
  const exportJson = () => download("lp-tree-export.json", JSON.stringify(root, null, 2), "application/json;charset=utf-8");
  const exportSelectedHtml = () => {
    if (!selectedExportIds.length) return alert("Nejdřív označ objekty pro export ve stromu.");
    download("lp-export-selected.html", buildExportHtml(root, new Set(selectedExportIds)), "text/html;charset=utf-8");
  };
  const exportSelectedJson = () => {
    if (!selectedExportIds.length) return alert("Nejdřív označ objekty pro export ve stromu.");
    download("lp-export-selected.json", JSON.stringify(collectSelectedNodes(root, new Set(selectedExportIds)), null, 2), "application/json;charset=utf-8");
  };
  return (
    <header className="topbar">
      <div className="brand">
        <strong>{mode === "document" ? "Editor LP" : mode === "preview" ? "Náhled dokumentů" : "Builder editoru"}</strong>
        <span>{mode === "document" ? activeWork ? `Editace v rámci ${activeWork.code}` : "Publikovaný dokument je read-only. Založ nebo vyber revizi/změnu." : mode === "preview" ? "Revize, změny, bloky a platnosti" : "Skládání vlastních editorů z komponent a funkcí"}</span>
      </div>
      <div className="toolbar">
        <div className="mode-switch">
          <button className={mode === "document" ? "active" : ""} onClick={() => onModeChange("document")}><FileText size={16} /> Dokument</button>
          <button className={mode === "preview" ? "active" : ""} onClick={() => onModeChange("preview")}><BookOpen size={16} /> Náhled</button>
          <button className={mode === "builder" ? "active" : ""} onClick={() => onModeChange("builder")}><Settings size={16} /> Builder</button>
        </div>
        {mode === "document" ? <>
          <AddChildMenu parent={selected} />
          <button onClick={save}><Save size={16} /> Uložit</button>
          <button onClick={exportJson}><Download size={16} /> JSON</button>
          <button onClick={exportHtml}><Download size={16} /> HTML</button>
          <button onClick={exportSelectedHtml}><Download size={16} /> Vybrané HTML ({selectedExportIds.length})</button>
          <button onClick={exportSelectedJson}><Download size={16} /> Vybrané JSON</button>
          <button onClick={exportDoc}><Download size={16} /> DOC</button>
          {selectedExportIds.length ? <button onClick={clearExportSelection}>Zrušit výběr</button> : null}
          <button onClick={onToggleMetadata}>{metadataOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />} Metadata</button>
        </> : null}
      </div>
    </header>
  );
}

function AddChildMenu({ parent }: { parent: DocumentNode }) {
  const addChildObject = useDocStore((state) => state.addChildObject);
  const [value, setValue] = React.useState("");
  const options = allowedChildTypes(parent);
  if (!options.length) return null;
  const add = (type: string) => {
    if (!type) return;
    addChildObject(parent.id, type as CreatableNodeType);
    setValue("");
  };
  return (
    <label className="compact-select">
      <span>Přidat pod {parent.type === "document" ? "dokument" : parent.title}</span>
      <select value={value} onChange={(event) => { setValue(event.target.value); add(event.target.value); }}>
        <option value="">Vybrat objekt...</option>
        {options.map((type) => <option key={type} value={type}>{objectTypeLabel(type)}</option>)}
      </select>
    </label>
  );
}

function PreviewWorkspace({ root, onEditNode }: { root: DocumentNode; onEditNode: (id: string) => void }) {
  const { works, publishedRoot, activeWorkId } = useDocStore();
  const [selectedRegime, setSelectedRegime] = React.useState(1);
  const [selectedBlockId, setSelectedBlockId] = React.useState<string | null>(null);
  const [soloBlockId, setSoloBlockId] = React.useState<string | null>(null);
  const [selectedDetailId, setSelectedDetailId] = React.useState<string | null>(null);
  const [selectedWorkId, setSelectedWorkId] = React.useState<string | null>(null);
  const [workView, setWorkView] = React.useState<"document" | "changes" | "timeline" | "detail" | "compare">("document");
  const [workflowFilter, setWorkflowFilter] = React.useState<"all" | WorkflowStatus>("all");
  const [typeFilter, setTypeFilter] = React.useState<"all" | "change" | "revision">("all");
  const [temporalFilter, setTemporalFilter] = React.useState<"all" | "current" | "future" | "archive" | "draft">("all");
  const [ownerFilter, setOwnerFilter] = React.useState("all");
  const [asOfDate, setAsOfDate] = React.useState(new Date().toISOString().slice(0, 10));
  const effectiveRoot = getEffectiveRoot(publishedRoot, works, asOfDate);
  const selectedWork = selectedWorkId ? works.find((work) => work.id === selectedWorkId) || null : null;
  const displayRoot = selectedWork ? selectedWork.draftRoot : activeWorkId ? root : effectiveRoot;
  const blocks = getPreviewBlocks(displayRoot);
  const activeBlock = blocks.find((block) => block.id === (soloBlockId || selectedBlockId)) || blocks[0];
  const selectedDetail = selectedDetailId ? findNode(displayRoot, selectedDetailId) : null;
  const currentWork = getCurrentEffectiveWork(works, asOfDate);
  const filteredWorks = filterWorks(works, { workflowFilter, typeFilter, temporalFilter, ownerFilter, asOfDate });
  const owners = Array.from(new Set(works.map((work) => work.owner || "Neurčeno"))).sort((a, b) => a.localeCompare(b, "cs"));
  const previewLabel = selectedWork
    ? `Náhled po ${selectedWork.type === "revision" ? "revizi" : "změně"} ${selectedWork.code}`
    : activeWorkId
      ? "Rozpracovaná revize / změna"
      : asOfDate === new Date().toISOString().slice(0, 10)
        ? "Aktuálně účinná verze"
        : `Budoucí nebo historický stav k datu ${formatDate(asOfDate)}`;
  const editSelectedDetail = () => {
    if (!selectedDetail) return;
    if (!activeWorkId) {
      alert("Nejdřív založ nebo vyber revizi/změnu. Teprve potom lze objekt editovat.");
      return;
    }
    onEditNode(selectedDetail.id);
  };
  return (
    <div className="preview-shell">
      <aside className="preview-control">
        <DocumentControlPanel />
        <WorkFilters
          workflowFilter={workflowFilter}
          typeFilter={typeFilter}
          temporalFilter={temporalFilter}
          ownerFilter={ownerFilter}
          owners={owners}
          onWorkflowFilter={setWorkflowFilter}
          onTypeFilter={setTypeFilter}
          onTemporalFilter={setTemporalFilter}
          onOwnerFilter={setOwnerFilter}
        />
      </aside>
      <main className="preview-main">
        <div className="preview-header">
          <div>
            <h1>Limity a podmínky bezpečného provozu</h1>
            <p>{previewLabel} · {soloBlockId ? `samostatný dokument: ${activeBlock?.title}` : `přehled kapitol a LP pro režim ${selectedRegime}`}</p>
          </div>
          <label className="field compact-date"><span>Zobrazit k datu</span><input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} /></label>
          {soloBlockId ? <button onClick={() => setSoloBlockId(null)}>Zpět na přehled</button> : null}
        </div>
        <DocumentStatusSummary root={displayRoot} currentWork={currentWork} selectedWork={selectedWork} asOfDate={asOfDate} previewLabel={previewLabel} />
        <div className="view-switch">
          {[
            ["document", "Detail dokumentu"],
            ["changes", "Seznam změn"],
            ["timeline", "Časová osa"],
            ["detail", "Detail změny"],
            ["compare", "Porovnání verzí"],
          ].map(([value, label]) => <button key={value} className={workView === value ? "active" : ""} onClick={() => setWorkView(value as typeof workView)}>{label}</button>)}
        </div>
        <RevisionTimeline works={filteredWorks} asOfDate={asOfDate} selectedWorkId={selectedWorkId} onSelect={(id) => { setSelectedWorkId(id); setWorkView("detail"); }} />
        {workView === "changes" ? <WorkList works={filteredWorks} selectedWorkId={selectedWorkId} asOfDate={asOfDate} onSelect={(id) => { setSelectedWorkId(id); setWorkView("detail"); }} /> : null}
        {workView === "detail" ? <WorkDetail work={selectedWork} publishedRoot={publishedRoot} works={works} asOfDate={asOfDate} onBack={() => setWorkView("changes")} /> : null}
        {workView === "compare" ? <ComparePanel work={selectedWork} publishedRoot={publishedRoot} works={works} asOfDate={asOfDate} /> : null}
        <div className="block-tabs">
          {blocks.map((block, index) => (
            <button key={block.id} className={(activeBlock?.id === block.id ? "active " : "") + "block-tab"} onClick={() => { setSelectedBlockId(block.id); setSoloBlockId(block.id); }}>
              BLOK {index + 1}
            </button>
          ))}
        </div>
        {selectedDetail ? <PreviewDetailPanel node={selectedDetail} onEdit={editSelectedDetail} /> : null}
        {workView === "document" ? soloBlockId && activeBlock ? <SoloBlockDocument block={activeBlock} onSelectNode={setSelectedDetailId} /> : <RegimeOverview block={activeBlock} selectedRegime={selectedRegime} onSelectNode={setSelectedDetailId} /> : null}
      </main>
      <aside className="regime-rail">
        {[1, 2, 3, 4, 5, 6, 7].map((regime) => (
          <button key={regime} className={selectedRegime === regime ? "active" : ""} onClick={() => setSelectedRegime(regime)}>{regime}</button>
        ))}
      </aside>
    </div>
  );
}

function DocumentStatusSummary({ root, currentWork, selectedWork, asOfDate, previewLabel }: { root: DocumentNode; currentWork: ControlWork | null; selectedWork: ControlWork | null; asOfDate: string; previewLabel: string }) {
  const lps = collectLpNodes(root).length;
  const chapters = collectChapterNodes(root).length;
  const status = selectedWork ? getWorkTemporalState(selectedWork, asOfDate) : currentWork ? "current" : "current";
  return (
    <section className="document-status">
      <div>
        <span className={`state-dot ${status}`}></span>
        <strong>{previewLabel}</strong>
        <p>Dokument · {chapters} kapitol · {lps} LP · stav k {formatDate(asOfDate)}</p>
      </div>
      <div className="status-grid">
        <div><span>Aktuálně účinná změna</span><strong>{currentWork?.code || "základní verze"}</strong></div>
        <div><span>Účinnost</span><strong>{currentWork ? formatDate(currentWork.effectiveDate) : "bez data"}</strong></div>
        <div><span>Workflow</span><strong>{selectedWork ? workflowLabel(selectedWork.status) : "platný"}</strong></div>
        <div><span>Vybráno</span><strong>{selectedWork ? `${selectedWork.code} · ${selectedWork.title}` : "aktuální dokument"}</strong></div>
      </div>
    </section>
  );
}

function WorkFilters({ workflowFilter, typeFilter, temporalFilter, ownerFilter, owners, onWorkflowFilter, onTypeFilter, onTemporalFilter, onOwnerFilter }: {
  workflowFilter: "all" | WorkflowStatus;
  typeFilter: "all" | "change" | "revision";
  temporalFilter: "all" | "current" | "future" | "archive" | "draft";
  ownerFilter: string;
  owners: string[];
  onWorkflowFilter: (value: "all" | WorkflowStatus) => void;
  onTypeFilter: (value: "all" | "change" | "revision") => void;
  onTemporalFilter: (value: "all" | "current" | "future" | "archive" | "draft") => void;
  onOwnerFilter: (value: string) => void;
}) {
  return (
    <section className="control-panel filter-panel">
      <h3>Filtry změn</h3>
      <label className="field"><span>Workflow stav</span><select value={workflowFilter} onChange={(event) => onWorkflowFilter(event.target.value as "all" | WorkflowStatus)}>
        <option value="all">vše</option>
        {WORKFLOW_STATUSES.map((status) => <option key={status} value={status}>{workflowLabel(status)}</option>)}
      </select></label>
      <label className="field"><span>Typ</span><select value={typeFilter} onChange={(event) => onTypeFilter(event.target.value as "all" | "change" | "revision")}>
        <option value="all">změny i revize</option>
        <option value="change">změny</option>
        <option value="revision">revize</option>
      </select></label>
      <label className="field"><span>Časový stav</span><select value={temporalFilter} onChange={(event) => onTemporalFilter(event.target.value as "all" | "current" | "future" | "archive" | "draft")}>
        <option value="all">vše</option>
        <option value="current">aktuální / účinné</option>
        <option value="future">budoucí</option>
        <option value="archive">archivní</option>
        <option value="draft">rozpracované</option>
      </select></label>
      <label className="field"><span>Autor / odpovědná osoba</span><select value={ownerFilter} onChange={(event) => onOwnerFilter(event.target.value)}>
        <option value="all">všichni</option>
        {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
      </select></label>
    </section>
  );
}

function WorkList({ works, selectedWorkId, asOfDate, onSelect }: { works: ControlWork[]; selectedWorkId: string | null; asOfDate: string; onSelect: (id: string) => void }) {
  const byEffectiveDate = [...works].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.code.localeCompare(b.code));
  return (
    <section className="work-table-panel">
      <div className="panel-row-head">
        <h2>Seznam změn a revizí</h2>
        <span>Řazeno podle data účinnosti, ne podle čísla změny.</span>
      </div>
      <div className="work-table">
        <div className="work-table-row head"><span>Číslo</span><span>Název</span><span>Vytvořeno</span><span>Účinnost</span><span>Workflow</span><span>Odpovědný</span><span>Stav</span></div>
        {byEffectiveDate.map((work) => (
          <button key={work.id} className={`work-table-row ${selectedWorkId === work.id ? "active" : ""}`} onClick={() => onSelect(work.id)}>
            <span>{work.code}</span>
            <span>{work.title}</span>
            <span>{formatDate(work.createdAt.slice(0, 10))}</span>
            <span>{formatDate(work.effectiveDate)}</span>
            <span><WorkStatusBadge work={work} asOfDate={asOfDate} /></span>
            <span>{work.owner || "Neurčeno"}</span>
            <span>{temporalLabel(getWorkTemporalState(work, asOfDate))}</span>
          </button>
        ))}
        {!byEffectiveDate.length ? <div className="empty">Filtru neodpovídá žádná změna nebo revize.</div> : null}
      </div>
    </section>
  );
}

function WorkDetail({ work, publishedRoot, works, asOfDate, onBack }: { work: ControlWork | null; publishedRoot: DocumentNode; works: ControlWork[]; asOfDate: string; onBack: () => void }) {
  if (!work) return <div className="empty">Vyber změnu nebo revizi ze seznamu nebo časové osy.</div>;
  const touched = getChangedNodeSummaries(work.baseRoot, work.draftRoot);
  const conflicts = getWorkConflicts(work, works);
  const previewRoot = work.draftRoot;
  return (
    <section className="work-detail-panel">
      <div className="preview-detail-head">
        <div>
          <span className={`badge ${work.type}`}>{work.type === "revision" ? "REVIZE" : "ZMĚNA"}</span>
          <h2>{work.code} · {work.title}</h2>
          <p>{workflowLabel(work.status)} · účinnost {formatDate(work.effectiveDate)} · odpovědný: {work.owner || "Neurčeno"}</p>
        </div>
        <button onClick={onBack}>Zpět na seznam</button>
      </div>
      <div className="status-grid">
        <div><span>Datum vytvoření</span><strong>{formatDate(work.createdAt.slice(0, 10))}</strong></div>
        <div><span>Vychází z verze</span><code>{work.baseHash}</code></div>
        <div><span>Budoucí verze</span><code>{work.treeHash}</code></div>
        <div><span>Časový stav</span><strong>{temporalLabel(getWorkTemporalState(work, asOfDate))}</strong></div>
      </div>
      <p className="work-note">{work.note || "Bez popisu změny."}</p>
      {conflicts.length ? <div className="warning"><AlertTriangle size={16} /> Konflikt: {conflicts.join(" ")}</div> : null}
      <div className="changed-list">
        <strong>Dotčené části dokumentu</strong>
        {touched.length ? touched.map((item) => <span key={item.id} className="changed-pill">{item.number || "-"} {item.title} · {item.change}</span>) : <span className="muted">Bez detekované změny obsahu.</span>}
      </div>
      <div className="compare-grid">
        <section><h3>Aktuálně platná verze</h3><MiniDocumentPreview root={getEffectiveRoot(publishedRoot, works, asOfDate)} /></section>
        <section><h3>Náhled po {work.code}</h3><MiniDocumentPreview root={previewRoot} /></section>
      </div>
    </section>
  );
}

function ComparePanel({ work, publishedRoot, works, asOfDate }: { work: ControlWork | null; publishedRoot: DocumentNode; works: ControlWork[]; asOfDate: string }) {
  const current = getEffectiveRoot(publishedRoot, works, asOfDate);
  const target = work?.draftRoot || current;
  const diffs = getChangedNodeSummaries(current, target);
  return (
    <section className="work-detail-panel">
      <div className="panel-row-head">
        <h2>Porovnání verzí</h2>
        <span>{work ? `Aktuální stav k ${formatDate(asOfDate)} vs. ${work.code}` : "Vyber změnu pro porovnání vůči aktuálnímu dokumentu."}</span>
      </div>
      <div className="changed-list">
        {diffs.length ? diffs.map((item) => <span key={item.id} className={`changed-pill ${item.change}`}>{item.number || "-"} {item.title} · {diffLabel(item.change)}</span>) : <span className="muted">Žádné rozdíly vůči vybranému stavu.</span>}
      </div>
      <div className="compare-grid">
        <section><h3>Aktuální / k datu</h3><MiniDocumentPreview root={current} /></section>
        <section><h3>{work ? `${work.code} · ${work.title}` : "Vybraný stav"}</h3><MiniDocumentPreview root={target} /></section>
      </div>
    </section>
  );
}

function MiniDocumentPreview({ root }: { root: DocumentNode }) {
  const chapters = collectChapterNodes(root).slice(0, 8);
  const lps = collectLpNodes(root).slice(0, 8);
  return (
    <div className="mini-document">
      {chapters.map((chapter) => <div key={chapter.id}><strong>{chapter.number} {chapter.title}</strong><p>{stripHtml(chapter.data.html_obsah || "").slice(0, 140)}</p></div>)}
      {lps.map((lp) => <div key={lp.id}><strong>LP {lp.data.cislo_lp || lp.number} · {lp.data.nadpis || lp.title}</strong><p>{(lp.data.lpp || []).map((lpp: any) => `${lpp.nazev}: ${formatPlatnost(lpp.platnost)}`).join("; ")}</p></div>)}
    </div>
  );
}

function DocumentControlPanel() {
  const { works, activeWorkId, root, publishedRoot, addControlWork, selectControlWork, updateControlWork, approveActiveWork, cancelActiveWork } = useDocStore();
  const selected = works.find((work) => work.id === activeWorkId) || works[0];
  const stats = {
    approved: works.filter((work) => FINAL_WORKFLOW_STATUSES.includes(work.status)).length,
    draft: works.filter((work) => work.status === "draft").length,
    changed: selected ? selected.treeHash !== simpleHash(JSON.stringify(root)) : false,
    conflict: selected?.conflict,
  };
  return (
    <section className="control-panel">
      <div className="control-head">
        <div>
          <h2>Revize a změny</h2>
          <p>Evidence práce nad aktuálním stromem dokumentu.</p>
        </div>
        <div className="inline-actions">
          <button onClick={() => addControlWork("revision")}>+ R</button>
          <button className="primary" onClick={() => addControlWork("change")}>+ Z</button>
        </div>
      </div>
      <div className="control-stats">
        <span className="badge neutral">{stats.approved} schváleno</span>
        <span className="badge neutral">{stats.draft} draft</span>
        {stats.changed ? <span className="badge neutral">strom změněn</span> : null}
        {stats.conflict ? <span className="badge neutral">konflikt</span> : null}
      </div>
      <div className="work-list compact">
        {works.map((work) => (
          <button key={work.id} className={work.id === activeWorkId ? "work-card active" : "work-card"} onClick={() => selectControlWork(work.id)}>
            <span className="work-code">{work.code}</span>
            <span className={`badge ${work.status}`}>{workflowLabel(work.status)}</span>
            <span className="muted">{work.type === "revision" ? "revize" : "změna"} · {work.title} · {formatDate(work.effectiveDate)}</span>
          </button>
        ))}
      </div>
      {selected ? (
        <div className="control-editor">
          <div className="grid-2">
            <Field label="Číslo" value={selected.code} onChange={(value) => updateControlWork(selected.id, { code: value })} />
            <Field label="Název / stručný popis" value={selected.title} onChange={(value) => updateControlWork(selected.id, { title: value })} />
            <Field label="Účinnost" value={selected.effectiveDate} onChange={(value) => updateControlWork(selected.id, { effectiveDate: value })} />
            <Field label="Autor / odpovědný" value={selected.owner} onChange={(value) => updateControlWork(selected.id, { owner: value })} />
          </div>
          <label className="field">
            <span>Stav</span>
            <select value={selected.status} onChange={(event) => updateControlWork(selected.id, { status: event.target.value as ControlWork["status"] })}>
              {WORKFLOW_STATUSES.map((status) => <option key={status} value={status}>{workflowLabel(status)}</option>)}
            </select>
          </label>
          <Textarea label="Poznámka / popis změny" value={selected.note} onChange={(value) => updateControlWork(selected.id, { note: value })} />
          <div className="hash">hash dokumentu: {selected.treeHash}</div>
          <div className="hash">publikovaný hash: {simpleHash(JSON.stringify(publishedRoot))}</div>
          {selected.conflict ? <div className="warning">{selected.conflict}</div> : null}
          <div className="inline-actions">
            <button className="primary" disabled={selected.status === "approved" || selected.id !== activeWorkId} onClick={approveActiveWork}>Schválit</button>
            {activeWorkId ? <button onClick={cancelActiveWork}>Zpět na publikovaný dokument</button> : null}
          </div>
        </div>
      ) : <div className="empty">Zatím není založená revize ani změna.</div>}
    </section>
  );
}

function RegimeOverview({ block, selectedRegime, onSelectNode }: { block: DocumentNode | undefined; selectedRegime: number; onSelectNode: (id: string) => void }) {
  if (!block) return <div className="empty">Dokument zatím nemá bloky.</div>;
  const chapters = collectChapterNodes(block).filter((chapter) => chapter.id !== block.id);
  const lps = collectLpNodes(block).filter((node) => lpHasRegime(node.data, selectedRegime));
  const columns = chunk([...chapters, ...lps], 3);
  return (
    <div className="regime-overview">
      {columns.map((column, columnIndex) => (
        <div className="overview-column" key={columnIndex}>
          {column.map((node, index) => (
            <button type="button" className={`overview-section ${node.type}`} key={node.id} onClick={() => onSelectNode(node.id)}>
              {node.type === "chapter" ? <>
                <h3>{node.number || index + 1} · {node.title}</h3>
                <p>{stripHtml(node.data.html_obsah || "").slice(0, 180) || "Kapitola bez textu."}</p>
              </> : <>
                <h3>{block.title} – LP {node.data.cislo_lp || node.number || index + 1}</h3>
                <ul>
                  <li><strong>{node.data.nadpis || node.title}</strong></li>
                  {(node.data.lpp || []).filter((lpp: any) => lpp.platnost?.rezimy?.includes(selectedRegime)).map((lpp: any) => (
                    <li key={lpp.id}>{lpp.nazev}: {formatPlatnost(lpp.platnost)}</li>
                  ))}
                </ul>
              </>}
            </button>
          ))}
        </div>
      ))}
      {!lps.length ? <div className="empty">Pro režim {selectedRegime} nejsou v tomto bloku žádné LP.</div> : null}
    </div>
  );
}

function PreviewDetailPanel({ node, onEdit }: { node: DocumentNode; onEdit: () => void }) {
  return (
    <section className="preview-detail">
      <div className="preview-detail-head">
        <div>
          <span className="badge neutral">{node.type === "chapter" ? "KAPITOLA" : node.type === "lp" ? "LP" : node.type.toUpperCase()}</span>
          <h2>{node.number ? `${node.number} ` : ""}{node.title}</h2>
        </div>
        <button className="primary" onClick={onEdit}>Editovat</button>
      </div>
      {node.type === "chapter" ? <div className="preview-rich" dangerouslySetInnerHTML={{ __html: node.data.html_obsah || "<p>Kapitola zatím nemá obsah.</p>" }} /> : null}
      {node.type === "lp" ? <ReadOnlyLp node={node} /> : null}
    </section>
  );
}

function ReadOnlyLp({ node }: { node: DocumentNode }) {
  const lp = node.data;
  return (
    <div className="readonly-lp">
      <section>
        <h3>LPP</h3>
        {(lp.lpp || []).map((lpp: any) => (
          <div key={lpp.id} className="readonly-block">
            <strong>{lpp.nazev}</strong>
            <p>{lpp.zneni}</p>
            <span className="badge neutral">{formatPlatnost(lpp.platnost) || "bez platnosti"}</span>
          </div>
        ))}
      </section>
      <section>
        <h3>Činnosti</h3>
        {(lp.cinnosti || []).map((state: any) => (
          <div key={state.id} className="readonly-block">
            <strong>{state.nazev_stavu || "Stav"}</strong>
            <p>{state.zneni_stavu}</p>
            <ol>
              {(state.cinnosti || []).map((activity: any, index: number) => (
                <li key={activity.id}>{index + 1}. {activity.zneni_cinnosti} <span className="muted">{activity.operator ? `(${activity.operator}, odsazení ${activity.operator_indentation || 1})` : ""}</span></li>
              ))}
            </ol>
          </div>
        ))}
      </section>
      <section>
        <h3>PK</h3>
        {(lp.pk || []).map((pk: any) => (
          <div key={pk.id} className="readonly-block"><strong>{pk.nazev}</strong><p>{pk.zneni}</p><span className="muted">{pk.frekvence}</span></div>
        ))}
      </section>
    </div>
  );
}

function SoloBlockDocument({ block, onSelectNode }: { block: DocumentNode; onSelectNode: (id: string) => void }) {
  const chapters = collectChapterNodes(block);
  const lps = collectLpNodes(block);
  return (
    <div className="solo-document">
      <h2>{block.title}</h2>
      <p className="muted">Samostatný dokument bloku se svými kapitolami a LP.</p>
      {chapters.map((chapter) => (
        <section className="doc-chapter clickable" key={chapter.id} onClick={() => onSelectNode(chapter.id)}>
          <h3>{chapter.number} {chapter.title}</h3>
          <div dangerouslySetInnerHTML={{ __html: chapter.data.html_obsah || "" }} />
        </section>
      ))}
      {lps.map((lp) => (
        <section className="doc-chapter clickable" key={lp.id} onClick={() => onSelectNode(lp.id)}>
          <h3>{lp.data.cislo_lp || lp.number} {lp.data.nadpis}</h3>
          <p>{(lp.data.lpp || []).map((lpp: any) => `${lpp.nazev}: ${formatPlatnost(lpp.platnost)}`).join("\n")}</p>
        </section>
      ))}
    </div>
  );
}

function RevisionTimeline({ works, asOfDate, selectedWorkId, onSelect }: { works: ControlWork[]; asOfDate: string; selectedWorkId: string | null; onSelect: (id: string) => void }) {
  const ordered = works
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.code.localeCompare(b.code));
  return (
    <div className="preview-timeline">
      {ordered.length ? ordered.map((work) => (
        <button key={work.id} className={`timeline-pill ${getWorkTemporalState(work, asOfDate)} ${work.type} ${selectedWorkId === work.id ? "selected" : ""}`} onClick={() => onSelect(work.id)}>
          <strong>{work.code}</strong>
          <span>{formatDate(work.effectiveDate)}</span>
          <small>{workflowLabel(work.status)}</small>
        </button>
      )) : <span className="muted">Zatím není založená žádná revize nebo změna.</span>}
    </div>
  );
}

function getEffectiveRoot(publishedRoot: DocumentNode, works: ControlWork[], asOfDate: string) {
  const effective = works
    .filter((work) => FINAL_WORKFLOW_STATUSES.includes(work.status) && work.effectiveDate <= asOfDate)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.code.localeCompare(b.code));
  const selected = effective[effective.length - 1];
  return selected?.draftRoot || publishedRoot;
}

function getCurrentEffectiveWork(works: ControlWork[], asOfDate: string) {
  const effective = works
    .filter((work) => FINAL_WORKFLOW_STATUSES.includes(work.status) && work.effectiveDate <= asOfDate)
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.code.localeCompare(b.code));
  return effective[effective.length - 1] || null;
}

function workflowLabel(status: WorkflowStatus) {
  return WORKFLOW_STATUS_LABELS[status] || status;
}

function getWorkTemporalState(work: ControlWork, asOfDate: string): "current" | "future" | "archive" | "draft" {
  if (["draft", "review", "commenting"].includes(work.status)) return "draft";
  if (["rejected", "cancelled", "archived"].includes(work.status)) return "archive";
  if (work.effectiveDate > asOfDate) return "future";
  return "current";
}

function temporalLabel(state: ReturnType<typeof getWorkTemporalState>) {
  return ({ current: "účinné / aktuální", future: "čeká na účinnost", archive: "archivní / zrušené", draft: "rozpracované" })[state];
}

function filterWorks(works: ControlWork[], filters: { workflowFilter: "all" | WorkflowStatus; typeFilter: "all" | "change" | "revision"; temporalFilter: "all" | "current" | "future" | "archive" | "draft"; ownerFilter: string; asOfDate: string }) {
  return works.filter((work) => {
    if (filters.workflowFilter !== "all" && work.status !== filters.workflowFilter) return false;
    if (filters.typeFilter !== "all" && work.type !== filters.typeFilter) return false;
    if (filters.ownerFilter !== "all" && (work.owner || "Neurčeno") !== filters.ownerFilter) return false;
    if (filters.temporalFilter !== "all" && getWorkTemporalState(work, filters.asOfDate) !== filters.temporalFilter) return false;
    return true;
  });
}

function WorkStatusBadge({ work, asOfDate }: { work: ControlWork; asOfDate: string }) {
  const state = getWorkTemporalState(work, asOfDate);
  return <span className={`badge status-${state}`}>{workflowLabel(work.status)}</span>;
}

function getChangedNodeSummaries(baseRoot: DocumentNode, draftRoot: DocumentNode) {
  const baseMap = new Map(flattenAllNodes(baseRoot).map((node) => [node.id, node]));
  const draftMap = new Map(flattenAllNodes(draftRoot).map((node) => [node.id, node]));
  const ids = new Set([...baseMap.keys(), ...draftMap.keys()]);
  const result: Array<{ id: string; number: string; title: string; change: "added" | "changed" | "removed" }> = [];
  ids.forEach((id) => {
    const base = baseMap.get(id);
    const draft = draftMap.get(id);
    if (!base && draft) result.push({ id, number: draft.number, title: draft.title, change: "added" });
    else if (base && !draft) result.push({ id, number: base.number, title: base.title, change: "removed" });
    else if (base && draft && simpleHash(JSON.stringify(summarizeNodeForDiff(base))) !== simpleHash(JSON.stringify(summarizeNodeForDiff(draft)))) {
      result.push({ id, number: draft.number || base.number, title: draft.title || base.title, change: "changed" });
    }
  });
  return result.sort((a, b) => a.number.localeCompare(b.number, "cs", { numeric: true }));
}

function flattenAllNodes(node: DocumentNode): DocumentNode[] {
  return [node, ...node.children.flatMap(flattenAllNodes)];
}

function summarizeNodeForDiff(node: DocumentNode) {
  return { type: node.type, number: node.number, title: node.title, data: node.data, childIds: node.children.map((child) => child.id) };
}

function diffLabel(change: "added" | "changed" | "removed") {
  return ({ added: "přidáno", changed: "změněno", removed: "odstraněno" })[change];
}

function getWorkConflicts(work: ControlWork, works: ControlWork[]) {
  const conflicts: string[] = [];
  const touched = new Set(getChangedNodeSummaries(work.baseRoot, work.draftRoot).map((item) => item.id));
  works.forEach((candidate) => {
    if (candidate.id === work.id) return;
    if (candidate.createdAt > work.createdAt && FINAL_WORKFLOW_STATUSES.includes(candidate.status) && candidate.effectiveDate <= work.effectiveDate) {
      conflicts.push(`${candidate.code} má účinnost ${formatDate(candidate.effectiveDate)} a byla schválena nad stejným publikačním tokem.`);
    }
    const otherTouched = getChangedNodeSummaries(candidate.baseRoot, candidate.draftRoot).map((item) => item.id);
    if (otherTouched.some((id) => touched.has(id))) conflicts.push(`${candidate.code} upravuje stejnou část dokumentu.`);
  });
  if (work.conflict) conflicts.push(work.conflict);
  return Array.from(new Set(conflicts));
}

function formatDate(value: string) {
  if (!value) return "-";
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("cs-CZ");
}

function getPreviewBlocks(root: DocumentNode) {
  const topChapters = root.children.filter((node) => node.type === "chapter");
  return topChapters.length ? topChapters : root.children.length ? root.children : [root];
}

function collectLpNodes(node: DocumentNode): DocumentNode[] {
  return [node.type === "lp" ? node : null, ...node.children.flatMap(collectLpNodes)].filter(Boolean) as DocumentNode[];
}

function collectChapterNodes(node: DocumentNode): DocumentNode[] {
  return [node.type === "chapter" ? node : null, ...node.children.flatMap(collectChapterNodes)].filter(Boolean) as DocumentNode[];
}

function stripHtml(html: string) {
  const template = document.createElement("template");
  template.innerHTML = html || "";
  return template.content.textContent?.replace(/\s+/g, " ").trim() || "";
}

function lpHasRegime(lp: any, regime: number) {
  return (lp.lpp || []).some((lpp: any) => (lpp.platnost?.rezimy || []).includes(regime));
}

function chunk<T>(items: T[], columnCount: number) {
  const columns = Array.from({ length: columnCount }, () => [] as T[]);
  items.forEach((item, index) => columns[index % columnCount].push(item));
  return columns;
}

function loadControlWorks(fallbackRoot: DocumentNode): ControlWork[] {
  const saved = localStorage.getItem(CONTROL_STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.map((work: Partial<ControlWork>) => ({
          id: work.id || uid("work"),
          code: work.code || "Z000",
          type: work.type || "change",
          status: normalizeWorkflowStatus(work.status),
          title: work.title || work.note?.split("\n")[0] || (work.type === "revision" ? "Revize dokumentu" : "Změna dokumentu"),
          owner: work.owner || "Neurčeno",
          effectiveDate: work.effectiveDate || new Date().toISOString().slice(0, 10),
          note: work.note || "",
          baseRoot: work.baseRoot || fallbackRoot,
          draftRoot: work.draftRoot || fallbackRoot,
          baseHash: work.baseHash || simpleHash(JSON.stringify(work.baseRoot || fallbackRoot)),
          treeHash: work.treeHash || simpleHash(JSON.stringify(work.draftRoot || fallbackRoot)),
          createdAt: work.createdAt || new Date().toISOString(),
          approvedAt: work.approvedAt,
          conflict: work.conflict || "",
          linkedReview: work.linkedReview || { confirmed: false, checkedNodeIds: [] },
        }));
      }
    } catch {
      localStorage.removeItem(CONTROL_STORAGE_KEY);
    }
  }
  return [];
}

function normalizeWorkflowStatus(status: unknown): WorkflowStatus {
  if (WORKFLOW_STATUSES.includes(status as WorkflowStatus)) return status as WorkflowStatus;
  if (status === "cancelled") return "cancelled";
  if (status === "approved") return "approved";
  return "draft";
}

function simpleHash(text: string) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (`00000000${(hash >>> 0).toString(16)}`).slice(-8);
}

function BuilderWorkspace() {
  const [definitions, setDefinitions] = React.useState<EditorDefinition[]>(loadEditorDefinitions);
  const [packageDefinition, setPackageDefinition] = React.useState<PackageDefinition>(loadPackageDefinition);
  const [selectedId, setSelectedId] = React.useState(definitions[0]?.id || "");
  const selected = definitions.find((definition) => definition.id === selectedId) || definitions[0];
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const persist = (next: EditorDefinition[]) => {
    const normalized = next.map(normalizeDefinition);
    setDefinitions(normalized);
    localStorage.setItem(BUILDER_STORAGE_KEY, JSON.stringify(normalized));
  };
  const updateSelected = (updater: (definition: EditorDefinition) => void) => {
    persist(definitions.map((definition) => {
      if (definition.id !== selected.id) return definition;
      const copy = clone(definition);
      updater(copy);
      return copy;
    }));
  };
  const addDefinition = () => {
    const definition = createEditorDefinition(`Editor ${definitions.length + 1}`);
    persist([...definitions, definition]);
    setSelectedId(definition.id);
  };
  const duplicateDefinition = () => {
    const copy = clone(selected);
    copy.id = uid("editor");
    copy.name = `${copy.name} - kopie`;
    copy.sections = copy.sections.map((section) => ({
      ...section,
      id: uid("section"),
      fields: section.fields.map((field) => ({ ...field, id: uid("field") })),
    }));
    persist([...definitions, copy]);
    setSelectedId(copy.id);
  };
  const deleteDefinition = () => {
    if (definitions.length <= 1) return alert("Musi zustat alespon jedna definice editoru.");
    if (!confirm("Opravdu smazat definici editoru?")) return;
    const next = definitions.filter((definition) => definition.id !== selected.id);
    persist(next);
    setSelectedId(next[0].id);
  };
  const exportDefinition = () => download(`${selected.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.editor.json`, JSON.stringify(selected, null, 2), "application/json;charset=utf-8");
  const updatePackage = (definition: PackageDefinition) => {
    const normalized = normalizePackageDefinition(definition);
    setPackageDefinition(normalized);
    savePackageDefinition(normalized);
  };
  const exportPackage = () => download(`${packageDefinition.key || "package"}.package.json`, JSON.stringify(packageDefinition, null, 2), "application/json;charset=utf-8");
  const importDefinition = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const imported = normalizeDefinition(parsed);
        persist([...definitions.filter((definition) => definition.id !== imported.id), imported]);
        setSelectedId(imported.id);
      } catch (error) {
        alert(`JSON definici se nepodarilo nacist: ${error instanceof Error ? error.message : "neznamy problem"}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="builder-layout">
      <aside className="builder-sidebar">
        <div className="panel-head">
          <div className="panel-title"><Wrench size={18} /> Definice editoru</div>
          <p>Vyber editor, uprav schema a pouzij ho pro dalsi dokumenty.</p>
        </div>
        <div className="builder-list">
          {definitions.map((definition) => (
            <button key={definition.id} className={definition.id === selected.id ? "builder-item active" : "builder-item"} onClick={() => setSelectedId(definition.id)}>
              <strong>{definition.name}</strong>
              <span>{definition.sections.length} sekci, {definition.sections.reduce((sum, section) => sum + section.fields.length, 0)} poli</span>
            </button>
          ))}
        </div>
        <div className="builder-actions">
          <button className="primary" onClick={addDefinition}><Plus size={16} /> Novy editor</button>
          <button onClick={duplicateDefinition}><Copy size={16} /> Duplikovat</button>
          <button onClick={() => fileInputRef.current?.click()}><Download size={16} /> Import JSON</button>
          <input ref={fileInputRef} className="hidden-input" type="file" accept="application/json,.json" onChange={(event) => importDefinition(event.target.files?.[0])} />
          <button className="danger-text" onClick={deleteDefinition}>Smazat</button>
        </div>
      </aside>

      <main className="builder-main">
        <PackageStudio definition={packageDefinition} onChange={updatePackage} onExport={exportPackage} />

        <Card title="Zaklad editoru" badge="SCHEMA">
          <div className="grid-2">
            <Field label="Nazev editoru" value={selected.name} onChange={(value) => updateSelected((definition) => { definition.name = value; })} />
            <Field label="Verze schema" value={selected.version} onChange={(value) => updateSelected((definition) => { definition.version = value; })} />
            <Textarea label="Popis" value={selected.description} onChange={(value) => updateSelected((definition) => { definition.description = value; })} />
          </div>
        </Card>

        <Card title="Ciselniky" badge="JSON">
          <JsonObjectEditor
            label="Ciselniky editoru"
            value={selected.dictionaries}
            emptyValue={{}}
            onChange={(value) => updateSelected((definition) => { definition.dictionaries = value as Record<string, string[]>; })}
          />
        </Card>

        <Card title="Predprogramovane funkce" badge="REGISTRY">
          <div className="function-grid">
            {functionRegistry.map((item) => {
              const active = selected.functions.includes(item.key);
              return (
                <button key={item.key} className={active ? "function-tile active" : "function-tile"} onClick={() => updateSelected((definition) => {
                  definition.functions = active ? definition.functions.filter((key) => key !== item.key) : [...definition.functions, item.key];
                })}>
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </button>
              );
            })}
          </div>
        </Card>

        <BuilderSections definition={selected} update={updateSelected} />
      </main>

      <aside className="builder-preview">
        <div className="panel-head">
          <div className="panel-title"><FileText size={18} /> Runtime nahled</div>
          <p>Takto se bude editor vykreslovat z ulozene definice.</p>
        </div>
        <div className="right-content">
          <RuntimePreview definition={selected} />
          <button onClick={exportDefinition}><Download size={16} /> Export definice JSON</button>
          <button onClick={() => download(`${selected.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.runtime-data.json`, JSON.stringify({ editorId: selected.id, schemaVersion: selected.version, data: createEmptyRuntimeData(selected) }, null, 2), "application/json;charset=utf-8")}><Download size={16} /> Prazdna data JSON</button>
        </div>
      </aside>
    </div>
  );
}

function PackageStudio({ definition, onChange, onExport }: { definition: PackageDefinition; onChange: (definition: PackageDefinition) => void; onExport: () => void }) {
  const templateInputRef = React.useRef<HTMLInputElement | null>(null);
  const hierarchySummary = definition.assets.hierarchyRules.map((rule) => {
    const parent = definition.assets.objectTypes.find((type) => type.key === rule.parentObjectTypeKey)?.name || rule.parentObjectTypeKey;
    const children = rule.allowedChildObjectTypeKeys.map((key) => definition.assets.objectTypes.find((type) => type.key === key)?.name || key).join(", ");
    return `${parent} → ${children || "žádný potomek"}`;
  });
  const uploadTemplate = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const next = clone(definition);
      next.assets.exportTemplates = [
        ...(next.assets.exportTemplates || []),
        {
          key: `template_${Date.now().toString(36)}`,
          name: file.name,
          objectTypeKey: "lp",
          type: file.name.toLowerCase().endsWith(".json") ? "json" : "html",
          content: String(reader.result || ""),
          typography: { fontFamily: "Arial", baseFontSize: 11, headingFontSize: 16, lineHeight: 1.35 },
          attributeLayout: [],
        },
      ];
      onChange(next);
    };
    reader.readAsText(file);
  };
  return (
    <Card title="Package Studio" badge="DAWISO-LIKE">
      <div className="package-studio">
        <div className="package-summary">
          <div><span>Package</span><strong>{definition.name}</strong></div>
          <div><span>Key</span><code>{definition.key}</code></div>
          <div><span>Verze</span><strong>{definition.version}</strong></div>
          <div><span>Assety</span><strong>{definition.assets.objectTypes.length} objektů / {definition.assets.attributeTypes.length} atributů</strong></div>
        </div>
        <div className="hierarchy-preview">
          <strong>Hierarchická pravidla</strong>
          {hierarchySummary.map((item) => <p key={item}>{item}</p>)}
        </div>
        <JsonObjectEditor label="Package JSON" value={definition} emptyValue={definition} onChange={(value) => onChange(value as PackageDefinition)} />
        <div className="inline-actions">
          <button onClick={() => templateInputRef.current?.click()}><Plus size={16} /> Nahrát exportní šablonu</button>
          <input ref={templateInputRef} className="hidden-input" type="file" accept=".html,.htm,.txt,.json,.doc" onChange={(event) => uploadTemplate(event.target.files?.[0])} />
          <span className="muted">{(definition.assets.exportTemplates || []).length} šablon v package</span>
        </div>
        <div className="inline-actions">
          <button onClick={onExport}><Download size={16} /> Export package JSON</button>
        </div>
      </div>
    </Card>
  );
}

function BuilderSections({ definition, update }: { definition: EditorDefinition; update: (updater: (definition: EditorDefinition) => void) => void }) {
  const setComponent = (sectionIndex: number, fieldIndex: number, component: BuilderComponentType) => update((definition) => {
    const field = definition.sections[sectionIndex].fields[fieldIndex];
    field.component = component;
    if (component === "table" && !field.columns?.length) {
      field.columns = [createField("Sloupec 1"), createField("Sloupec 2")];
    }
    if (component === "repeater" && !field.fields?.length) {
      field.fields = [createField("Položka")];
    }
    if (component === "select" || component === "multiSelect" || component === "radio") field.allowCustomValue ??= component === "select";
  });
  return (
    <section className="detail-stack">
      {definition.sections.map((section, sectionIndex) => (
        <Card key={section.id} title={section.title || `Sekce ${sectionIndex + 1}`} badge="SEKCE">
          <div className="grid-2">
            <Field label="Nazev sekce" value={section.title} onChange={(value) => update((definition) => { definition.sections[sectionIndex].title = value; })} />
            <Textarea label="Popis sekce" value={section.description} onChange={(value) => update((definition) => { definition.sections[sectionIndex].description = value; })} />
            <JsonObjectEditor label="Viditelnost sekce visibleWhen" value={section.visibleWhen || null} emptyValue={null} onChange={(value) => update((definition) => { definition.sections[sectionIndex].visibleWhen = value as any; })} />
          </div>
          <div className="builder-fields">
            {section.fields.map((field, fieldIndex) => (
              <div className="builder-field-row" key={field.id}>
                <Field label="Popisek" value={field.label} onChange={(value) => update((definition) => { definition.sections[sectionIndex].fields[fieldIndex].label = value; })} />
                <Field label="Technicky klic" value={field.key} onChange={(value) => update((definition) => { definition.sections[sectionIndex].fields[fieldIndex].key = value; })} />
                <label className="field">
                  <span>Komponenta</span>
                  <select value={field.component} onChange={(event) => setComponent(sectionIndex, fieldIndex, event.target.value as BuilderComponentType)}>
                    {componentRegistry.map((component) => <option key={component.type} value={component.type}>{component.label}</option>)}
                  </select>
                </label>
                <Textarea label="Ciselnik / volby" value={field.options} onChange={(value) => update((definition) => { definition.sections[sectionIndex].fields[fieldIndex].options = value; })} />
                <Field label="Slovnik" value={field.dictionary || ""} onChange={(value) => update((definition) => { definition.sections[sectionIndex].fields[fieldIndex].dictionary = value; })} />
                <label className="checkline">
                  <input type="checkbox" checked={field.required} onChange={(event) => update((definition) => { definition.sections[sectionIndex].fields[fieldIndex].required = event.target.checked; })} />
                  Povinne
                </label>
                <label className="checkline">
                  <input type="checkbox" checked={Boolean(field.allowCustomValue)} onChange={(event) => update((definition) => { definition.sections[sectionIndex].fields[fieldIndex].allowCustomValue = event.target.checked; })} />
                  Vlastni hodnota
                </label>
                <JsonObjectEditor label="visibleWhen" value={field.visibleWhen || null} emptyValue={null} onChange={(value) => update((definition) => { definition.sections[sectionIndex].fields[fieldIndex].visibleWhen = value as any; })} />
                <JsonObjectEditor label="requiredWhen" value={field.requiredWhen || null} emptyValue={null} onChange={(value) => update((definition) => { definition.sections[sectionIndex].fields[fieldIndex].requiredWhen = value as any; })} />
                <JsonObjectEditor label="validation" value={field.validation || {}} emptyValue={{}} onChange={(value) => update((definition) => { definition.sections[sectionIndex].fields[fieldIndex].validation = value as any; })} />
                {(field.component === "table" || field.component === "repeater") ? (
                  <NestedFieldDesigner
                    title={field.component === "table" ? "Sloupce tabulky" : "Pole opakovatelné položky"}
                    fields={field.component === "table" ? field.columns || [] : field.fields || []}
                    onChange={(fields) => update((definition) => {
                      const target = definition.sections[sectionIndex].fields[fieldIndex];
                      if (target.component === "table") target.columns = fields;
                      else target.fields = fields;
                    })}
                  />
                ) : null}
                <button className="danger-text" onClick={() => update((definition) => { definition.sections[sectionIndex].fields.splice(fieldIndex, 1); })}>Smazat pole</button>
              </div>
            ))}
          </div>
          <div className="inline-actions">
            <button onClick={() => update((definition) => { definition.sections[sectionIndex].fields.push(createField(`Pole ${section.fields.length + 1}`)); })}><Plus size={16} /> Pridat pole</button>
            <button className="danger-text" onClick={() => update((definition) => { definition.sections.splice(sectionIndex, 1); })}>Smazat sekci</button>
          </div>
        </Card>
      ))}
      <button className="primary wide-action" onClick={() => update((definition) => { definition.sections.push(createSection(`Sekce ${definition.sections.length + 1}`)); })}><Plus size={16} /> Pridat sekci</button>
    </section>
  );
}

function NestedFieldDesigner({ title, fields, onChange }: { title: string; fields: BuilderField[]; onChange: (fields: BuilderField[]) => void }) {
  const updateField = (index: number, patch: Partial<BuilderField>) => onChange(fields.map((field, fieldIndex) => fieldIndex === index ? { ...field, ...patch } : field));
  return (
    <div className="nested-designer">
      <strong>{title}</strong>
      {fields.map((field, index) => (
        <div className="nested-field-row" key={field.id}>
          <Field label="Popisek" value={field.label} onChange={(value) => updateField(index, { label: value })} />
          <Field label="Klic" value={field.key} onChange={(value) => updateField(index, { key: value })} />
          <label className="field">
            <span>Typ</span>
            <select value={field.component} onChange={(event) => updateField(index, { component: event.target.value as BuilderComponentType })}>
              {componentRegistry.filter((component) => !["table", "repeater"].includes(component.type)).map((component) => <option key={component.type} value={component.type}>{component.label}</option>)}
            </select>
          </label>
          <button className="danger-text" onClick={() => onChange(fields.filter((_, fieldIndex) => fieldIndex !== index))}>Smazat</button>
        </div>
      ))}
      <button onClick={() => onChange([...fields, createField(`Pole ${fields.length + 1}`)])}><Plus size={16} /> Pridat</button>
    </div>
  );
}

function JsonObjectEditor({ label, value, emptyValue, onChange }: { label: string; value: unknown; emptyValue: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = React.useState(JSON.stringify(value ?? emptyValue, null, 2));
  const [error, setError] = React.useState("");
  React.useEffect(() => setText(JSON.stringify(value ?? emptyValue, null, 2)), [JSON.stringify(value ?? emptyValue)]);
  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError("");
      onChange(emptyValue);
      return;
    }
    try {
      onChange(JSON.parse(trimmed));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Neplatný JSON");
    }
  };
  return (
    <label className="field json-field">
      <span>{label}</span>
      <textarea value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />
      {error ? <small className="field-error">{error}</small> : null}
    </label>
  );
}

function RuntimePreview({ definition }: { definition: EditorDefinition }) {
  const [values, setValues] = React.useState<Record<string, any>>({});
  const setValue = (key: string, value: any) => setValues((current) => ({ ...current, [key]: value }));
  const validationMessages = collectValidationMessages(definition, values);
  return (
    <div className="runtime-preview">
      <h2>{definition.name}</h2>
      <p>{definition.description}</p>
      <div className="preview-functions">{definition.functions.map((key) => <span className="badge neutral" key={key}>{functionRegistry.find((item) => item.key === key)?.label || key}</span>)}</div>
      {validationMessages.length ? <div className="validation-box">{validationMessages.map((message) => <p key={message}>{message}</p>)}</div> : null}
      {definition.sections.filter((section) => evaluateCondition(section.visibleWhen, values)).map((section) => (
        <section className="preview-section" key={section.id}>
          <h3>{section.title}</h3>
          {section.description ? <p>{section.description}</p> : null}
          {section.fields.map((field) => <RuntimeField key={field.id} definition={definition} field={field} values={values} value={values[field.key]} onChange={(value) => setValue(field.key, value)} />)}
        </section>
      ))}
      <details className="schema-preview">
        <summary>Data nahledu</summary>
        <pre>{JSON.stringify(values, null, 2)}</pre>
      </details>
    </div>
  );
}

function RuntimeField({ definition, field, values, value, onChange }: { definition: EditorDefinition; field: BuilderField; values: Record<string, any>; value: any; onChange: (value: any) => void }) {
  if (field.hidden || !evaluateCondition(field.visibleWhen, values)) return null;
  const required = isFieldRequired(field, values);
  const error = validateFieldValue(field, value, values);
  const datalistId = `${field.id}-options`;
  const label = `${field.label}${required ? " *" : ""}`;
  const wrapError = (node: React.ReactNode) => <div className={error ? "runtime-field has-error" : "runtime-field"}>{node}{field.helpText ? <small>{field.helpText}</small> : null}{error ? <small className="field-error">{error}</small> : null}</div>;
  if (field.component === "textarea") return wrapError(<Textarea label={label} value={value || ""} onChange={onChange} />);
  if (field.component === "richText") return wrapError(<label className="field"><span>{label}</span><RichText value={value || ""} onChange={onChange} /></label>);
  if (field.component === "checkbox" || field.component === "toggle") return wrapError(<label className="checkline"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} /> {label}</label>);
  if (field.component === "select") return wrapError(
    <>
      {field.allowCustomValue ? <Field label={label} value={value || ""} list={datalistId} onChange={onChange} /> : (
        <label className="field"><span>{label}</span><select value={value || ""} onChange={(event) => onChange(event.target.value)}><option value="" />{getFieldOptions(field, definition).map((option) => <option value={option} key={option}>{option}</option>)}</select></label>
      )}
      <datalist id={datalistId}>{getFieldOptions(field, definition).map((option) => <option value={option} key={option} />)}</datalist>
    </>,
  );
  if (field.component === "multiSelect") {
    const selected = Array.isArray(value) ? value : [];
    return wrapError(<div className="field"><span>{label}</span><div className="multi-options">{getFieldOptions(field, definition).map((option) => <label className="checkline" key={option}><input type="checkbox" checked={selected.includes(option)} onChange={(event) => onChange(event.target.checked ? [...selected, option] : selected.filter((item: string) => item !== option))} /> {option}</label>)}</div></div>);
  }
  if (field.component === "radio") {
    return wrapError(<div className="field"><span>{label}</span><div className="multi-options">{getFieldOptions(field, definition).map((option) => <label className="checkline" key={option}><input type="radio" name={field.id} checked={value === option} onChange={() => onChange(option)} /> {option}</label>)}</div></div>);
  }
  if (field.component === "table") return wrapError(<RuntimeTable definition={definition} field={field} values={values} value={value || []} onChange={onChange} />);
  if (field.component === "repeater") return wrapError(<RuntimeRepeater definition={definition} field={field} values={values} value={value || []} onChange={onChange} />);
  if (field.component === "computed") return wrapError(<label className="field"><span>{label}</span><input readOnly value={renderComputedValue(field, values)} /></label>);
  if (field.component === "json") return wrapError(<JsonRuntimeField label={label} value={value} onChange={onChange} />);
  if (field.component === "image") return wrapError(<label className="field"><span>{label}</span><input value={value || ""} placeholder={field.placeholder || "URL obrazku"} onChange={(event) => onChange(event.target.value)} />{value ? <img className="runtime-image" src={value} alt="" /> : null}</label>);
  const inputType = field.component === "number" || field.component === "integer" || field.component === "decimal" ? "number" : field.component === "date" ? "date" : field.component === "datetime" ? "datetime-local" : field.component === "time" ? "time" : field.component === "email" ? "email" : field.component === "url" ? "url" : "text";
  return wrapError(<label className="field"><span>{label}</span><input type={inputType} value={value || ""} placeholder={field.placeholder || ""} readOnly={field.readonly} onChange={(event) => onChange(event.target.value)} /></label>);
}

function RuntimeTable({ definition, field, values, value, onChange }: { definition: EditorDefinition; field: BuilderField; values: Record<string, any>; value: Array<Record<string, any>>; onChange: (value: any) => void }) {
  const columns = field.columns || [];
  const addRow = () => onChange([...value, Object.fromEntries(columns.map((column) => [column.key, column.defaultValue ?? ""]))]);
  return (
    <div className="runtime-table-wrap">
      <div className="table-scroll">
        <table className="runtime-table">
          <thead><tr>{columns.map((column) => <th key={column.id}>{column.label}</th>)}<th /></tr></thead>
          <tbody>
            {value.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column.id}>
                    <RuntimeField definition={definition} field={{ ...column, visibleWhen: null }} values={{ ...values, ...row }} value={row[column.key]} onChange={(next) => onChange(value.map((item, index) => index === rowIndex ? { ...item, [column.key]: next } : item))} />
                  </td>
                ))}
                <td><button className="danger-text" onClick={() => onChange(value.filter((_, index) => index !== rowIndex))}>Smazat</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={addRow}><Plus size={16} /> Přidat řádek</button>
    </div>
  );
}

function RuntimeRepeater({ definition, field, values, value, onChange }: { definition: EditorDefinition; field: BuilderField; values: Record<string, any>; value: Array<Record<string, any>>; onChange: (value: any) => void }) {
  const fields = field.fields || [];
  const addItem = () => onChange([...value, Object.fromEntries(fields.map((item) => [item.key, item.defaultValue ?? ""]))]);
  return (
    <div className="runtime-repeater">
      <strong>{field.label}</strong>
      {value.map((item, itemIndex) => (
        <div className="repeater-item" key={itemIndex}>
          {fields.map((child) => (
            <RuntimeField key={child.id} definition={definition} field={child} values={{ ...values, ...item }} value={item[child.key]} onChange={(next) => onChange(value.map((entry, index) => index === itemIndex ? { ...entry, [child.key]: next } : entry))} />
          ))}
          <button className="danger-text" onClick={() => onChange(value.filter((_, index) => index !== itemIndex))}>Smazat položku</button>
        </div>
      ))}
      <button onClick={addItem}><Plus size={16} /> Přidat položku</button>
    </div>
  );
}

function JsonRuntimeField({ label, value, onChange }: { label: string; value: unknown; onChange: (value: unknown) => void }) {
  const [text, setText] = React.useState(value ? JSON.stringify(value, null, 2) : "{}");
  const [error, setError] = React.useState("");
  const commit = () => {
    try {
      onChange(JSON.parse(text || "{}"));
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Neplatný JSON");
    }
  };
  return <label className="field json-field"><span>{label}</span><textarea value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />{error ? <small className="field-error">{error}</small> : null}</label>;
}

function TreeRow({ node, level }: { node: DocumentNode; level: number }) {
  const { selectedId, collapsed, selectedForExport, select, toggle, toggleExportSelection, deleteNode, duplicateNode, moveSibling } = useDocStore();
  const sortable = useSortable({ id: node.id, disabled: !canDrag(node) });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const hasChildren = node.children.length > 0;
  return (
    <div ref={sortable.setNodeRef} style={style} className={`tree-row ${selectedId === node.id ? "selected" : ""}`} onClick={() => select(node.id)}>
      <div className="tree-main" style={{ paddingLeft: 8 + level * 16 }}>
        <input className="export-check" type="checkbox" checked={Boolean(selectedForExport[node.id])} onChange={(event) => { event.stopPropagation(); toggleExportSelection(node.id); }} onClick={(event) => event.stopPropagation()} title="Zahrnout do výběrového exportu" />
        <button className="icon tiny" onClick={(e) => { e.stopPropagation(); toggle(node.id); }}>
          {hasChildren ? (collapsed[node.id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />) : <span />}
        </button>
        <button className="drag" {...sortable.attributes} {...sortable.listeners}><GripVertical size={14} /></button>
        {node.type === "chapter" ? <BookOpen size={16} /> : node.type === "lp" ? <FileText size={16} /> : <Braces size={15} />}
        <span className="node-number">{node.number || "-"}</span>
        <span className="node-title">{node.title}</span>
        <Badge type={node.type} />
      </div>
      <div className="row-menu" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => moveSibling(node.id, -1)}>↑</button>
        <button onClick={() => moveSibling(node.id, 1)}>↓</button>
        {(node.type === "chapter" || node.type === "lp") && <button onClick={() => duplicateNode(node.id)}>Duplikovat</button>}
        <AddChildMenu parent={node} />
        <button className="danger-text" onClick={() => deleteNode(node.id)}>Smazat</button>
      </div>
    </div>
  );
}

function Badge({ type }: { type: NodeType }) {
  const label = type === "chapter" ? "KAPITOLA" : type === "lp" ? "LP" : type === "custom_object" ? "OBJECT" : type.toUpperCase();
  return <span className={`badge ${type}`}>{label}</span>;
}

function NodeDetail({ node }: { node: DocumentNode }) {
  if (node.type === "chapter") return <ChapterEditor node={node} />;
  if (node.type === "lp") return <LpEditor node={node} />;
  if (["lpp", "state", "activity", "pk_item", "custom_object"].includes(node.type)) return <GenericObjectEditor node={node} />;
  return <ReadOnlyNode node={node} />;
}

function GenericObjectEditor({ node }: { node: DocumentNode }) {
  const update = useDocStore((state) => state.updateNodeData);
  const patch = (patch: Record<string, any>) => update(node.id, { ...node.data, ...patch });
  return (
    <section className="detail-stack">
      <HeaderCard node={node} />
      <Card title={NODE_TYPE_LABELS[node.type as CreatableNodeType] || node.title} badge={node.type.toUpperCase()}>
        {node.type === "lpp" ? <>
          <div className="grid-2">
            <Field label="Název LPP" value={node.data.nazev || ""} onChange={(value) => patch({ nazev: value })} />
            <Textarea label="Znění LPP" value={node.data.zneni || ""} onChange={(value) => patch({ zneni: value })} />
          </div>
          <ValidityRow lpp={node.data} onChange={(platnost) => patch({ platnost })} />
        </> : null}
        {node.type === "state" ? <div className="grid-2">
          <Field label="Název stavu" value={node.data.nazev_stavu || ""} onChange={(value) => patch({ nazev_stavu: value })} />
          <Textarea label="Znění stavu" value={node.data.zneni_stavu || ""} onChange={(value) => patch({ zneni_stavu: value })} />
        </div> : null}
        {node.type === "activity" ? <div className="activity-row generic-activity">
          <Textarea label="Znění činnosti" value={node.data.zneni_cinnosti || ""} onChange={(value) => patch({ zneni_cinnosti: value })} />
          <Field label="Doba" value={node.data.doba_provedeni || ""} list="doba-list" onChange={(value) => patch({ doba_provedeni: value })} />
          <label className="field"><span>Operátor</span><select value={node.data.operator || ""} onChange={(e) => patch({ operator: e.target.value })}><option value="" /><option>A</option><option>NEBO</option></select></label>
          <Segmented label="Odsazení" value={node.data.operator_indentation || 1} onChange={(value) => patch({ operator_indentation: value })} />
        </div> : null}
        {node.type === "pk_item" ? <div className="pk-row">
          <Field label="Název" value={node.data.nazev || ""} onChange={(value) => patch({ nazev: value })} />
          <Textarea label="Znění" value={node.data.zneni || ""} onChange={(value) => patch({ zneni: value })} />
          <Field label="Frekvence" value={node.data.frekvence || ""} list="frekvence-list" onChange={(value) => patch({ frekvence: value })} />
        </div> : null}
        {node.type === "custom_object" ? <div className="grid-2">
          <Field label="Typ objektu" value={node.data.objectTypeKey || ""} onChange={(value) => patch({ objectTypeKey: value })} />
          <Field label="Název objektu" value={node.data.title || ""} onChange={(value) => patch({ title: value })} />
        </div> : null}
        <CustomAttributesEditor value={node.data.extra_attributes || []} onChange={(extra) => patch({ extra_attributes: extra })} />
      </Card>
    </section>
  );
}

function ChapterEditor({ node }: { node: DocumentNode }) {
  const update = useDocStore((state) => state.updateNodeData);
  return (
    <section className="detail-stack">
      <HeaderCard node={node} />
      <Card title="Kapitola" badge="KAPITOLA">
        <div className="grid-2">
          <Field label="Číslo kapitoly" value={node.data.cislo_kapitoly || node.number} onChange={(value) => update(node.id, { cislo_kapitoly: value })} />
          <Field label="Název kapitoly" value={node.data.nazev} onChange={(value) => update(node.id, { nazev: value })} />
        </div>
        <RichText value={node.data.html_obsah} onChange={(html) => update(node.id, { html_obsah: html })} />
      </Card>
    </section>
  );
}

function LpEditor({ node }: { node: DocumentNode }) {
  const updateLp = useDocStore((state) => state.updateLp);
  const lp = node.data;
  const update = (fn: (lp: Lp) => void, label = "Upravená LP") => updateLp(node.id, fn, label);
  return (
    <section className="detail-stack">
      <HeaderCard node={node} />
      {lp.parserWarnings?.length ? <ParserWarnings warnings={lp.parserWarnings} /> : null}
      <Card title="Základ LP" badge="LP">
        <div className="grid-2">
          <Field label="Číslo LP" value={lp.cislo_lp || node.number} onChange={(value) => update((draft) => { draft.cislo_lp = value; })} />
          <Field label="Nadpis LP" value={lp.nadpis} onChange={(value) => update((draft) => { draft.nadpis = value; })} />
        </div>
      </Card>
      <Accordion title="LPP" defaultOpen>
        {lp.lpp.map((lpp: any, index: number) => (
          <Card key={lpp.id} title={lpp.nazev || `LPP ${index + 1}`} badge="LPP">
            <div className="grid-2">
              <Field label="Název LPP" value={lpp.nazev} onChange={(value) => update((draft) => { draft.lpp[index].nazev = value; })} />
              <Textarea label="Znění LPP" value={lpp.zneni} onChange={(value) => update((draft) => { draft.lpp[index].zneni = value; })} />
            </div>
            <ValidityRow lpp={lpp} onChange={(next) => update((draft) => { draft.lpp[index].platnost = next; })} />
            <CustomAttributesEditor value={lpp.extra_attributes || []} onChange={(extra) => update((draft) => { draft.lpp[index].extra_attributes = extra; })} />
            <div className="inline-actions">
              <button className="danger-text" onClick={() => update((draft) => { draft.lpp.splice(index, 1); })}>Smazat LPP</button>
            </div>
          </Card>
        ))}
        <button className="primary wide-action" onClick={() => update((draft) => {
          draft.lpp.push({
            id: uid("lpp"),
            nazev: `LPP ${draft.lpp.length + 1}`,
            zneni: "",
            platnost: { id: uid("validity"), rezimy: [], doplnujici_text: "", exportovana_hodnota: "" },
            extra_attributes: [],
          });
        })}><Plus size={16} /> Přidat LPP</button>
      </Accordion>
      <Accordion title="Činnosti" defaultOpen>
        {lp.cinnosti.map((state: any, stateIndex: number) => (
          <Card key={state.id} title={`${state.nazev_stavu || "Stav"} ${stateIndex + 1}`} badge="STAV">
            <div className="grid-2">
              <Field label="Název stavu" value={state.nazev_stavu} onChange={(value) => update((draft) => { draft.cinnosti[stateIndex].nazev_stavu = value; })} />
              <Textarea label="Znění stavu" value={state.zneni_stavu} onChange={(value) => update((draft) => { draft.cinnosti[stateIndex].zneni_stavu = value; })} />
            </div>
            <div className="activity-list">
              {state.cinnosti.map((activity: any, activityIndex: number) => (
                <div className="activity-row" key={activity.id}>
                  <div className="order-badge">{activityIndex + 1}</div>
                  <Textarea label="Znění činnosti" value={activity.zneni_cinnosti} onChange={(value) => update((draft) => { draft.cinnosti[stateIndex].cinnosti[activityIndex].zneni_cinnosti = value; })} />
                  <Field label="Doba" value={activity.doba_provedeni} list="doba-list" onChange={(value) => update((draft) => { draft.cinnosti[stateIndex].cinnosti[activityIndex].doba_provedeni = value; })} />
                  <label className="field"><span>Operátor</span><select value={activity.operator} onChange={(e) => update((draft) => { draft.cinnosti[stateIndex].cinnosti[activityIndex].operator = e.target.value; })}><option value="" /><option>A</option><option>NEBO</option></select></label>
                  <Segmented label="Odsazení" value={activity.operator_indentation || 1} onChange={(value) => update((draft) => { draft.cinnosti[stateIndex].cinnosti[activityIndex].operator_indentation = value; })} />
                </div>
              ))}
            </div>
            <CustomAttributesEditor value={state.extra_attributes || []} onChange={(extra) => update((draft) => { draft.cinnosti[stateIndex].extra_attributes = extra; })} />
            <div className="inline-actions">
              <button onClick={() => update((draft) => { draft.cinnosti[stateIndex].cinnosti.push({ id: uid("activity"), zneni_cinnosti: "", doba_provedeni: "", operator: "", operator_indentation: 1 }); })}>Přidat činnost</button>
              <button onClick={() => update((draft) => { draft.cinnosti.splice(stateIndex + 1, 0, { id: uid("state"), nazev_stavu: "", zneni_stavu: "", extra_attributes: [], cinnosti: [{ id: uid("activity"), zneni_cinnosti: "", doba_provedeni: "", operator: "", operator_indentation: 1, extra_attributes: [] }] }); })}>Přidat stav</button>
              <button className="danger-text" onClick={() => update((draft) => { draft.cinnosti.splice(stateIndex, 1); })}>Smazat stav</button>
            </div>
          </Card>
        ))}
        <button className="primary wide-action" onClick={() => update((draft) => {
          draft.cinnosti.push({
            id: uid("state"),
            nazev_stavu: "",
            zneni_stavu: "",
            extra_attributes: [],
            cinnosti: [{ id: uid("activity"), zneni_cinnosti: "", doba_provedeni: "", operator: "", operator_indentation: 1, extra_attributes: [] }],
          });
        })}><Plus size={16} /> Přidat stav / blok činností</button>
      </Accordion>
      <Accordion title="PK" defaultOpen>
        <Card title="Položky PK" badge="PK">
          {lp.pk.map((pk: any, index: number) => (
            <div className="pk-row" key={pk.id}>
              <Field label="Název" value={pk.nazev} onChange={(value) => update((draft) => { draft.pk[index].nazev = value; })} />
              <Textarea label="Znění" value={pk.zneni} onChange={(value) => update((draft) => { draft.pk[index].zneni = value; })} />
              <Field label="Frekvence" value={pk.frekvence} list="frekvence-list" onChange={(value) => update((draft) => { draft.pk[index].frekvence = value; })} />
            </div>
          ))}
          <button onClick={() => update((draft) => { draft.pk.push({ id: uid("pk"), nazev: "", zneni: "", frekvence: "" }); })}>Přidat PK</button>
        </Card>
      </Accordion>
      <Accordion title="Doplňující informace">
        <Card title="Rich-text obsah" badge="HTML">
          <RichText value={lp.doplnujici_informace} onChange={(html) => update((draft) => { draft.doplnujici_informace = html; })} />
        </Card>
      </Accordion>
    </section>
  );
}

function HeaderCard({ node }: { node: DocumentNode }) {
  return (
    <Card title={node.title} badge={node.type === "chapter" ? "KAPITOLA" : node.type.toUpperCase()}>
      <div className="metadata-grid">
        <div><span>Číslo</span><strong>{node.number || "-"}</strong></div>
        <div><span>Interní ID</span><code>{node.id}</code></div>
        <div><span>Parent</span><code>{node.parent_id || "-"}</code></div>
        <div><span>Pořadí</span><strong>{node.order}</strong></div>
      </div>
    </Card>
  );
}

function RightPanel({ node }: { node: DocumentNode | null }) {
  const history = useDocStore((state) => state.history);
  if (!node) return null;
  return (
    <aside className="right-panel">
      <div className="panel-head">
        <div className="panel-title"><Braces size={18} /> Metadata</div>
      </div>
      <div className="right-content">
        <div className="meta-card"><span>ID</span><code>{node.id}</code><button onClick={() => navigator.clipboard?.writeText(node.id)}><Copy size={14} /> Kopírovat</button></div>
        <div className="meta-card"><span>Typ</span><Badge type={node.type} /></div>
        <div className="meta-card"><span>Číslo</span><strong>{node.number || "-"}</strong></div>
        <div className="meta-card"><span>Reference API</span><code>{`LP_ATTRIBUTE_API.makeReference("${node.id}")`}</code></div>
        <div className="meta-card">
          <span><History size={14} /> Historie</span>
          {history.length ? history.map((item, index) => <p key={index}>{item}</p>) : <p>Zatím bez změn.</p>}
        </div>
      </div>
    </aside>
  );
}

function ReadOnlyNode({ node }: { node: DocumentNode }) {
  return <HeaderCard node={node} />;
}

function Card({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return <section className="card"><div className="card-head"><h2>{title}</h2>{badge && <span className="badge neutral">{badge}</span>}</div><div className="card-body">{children}</div></section>;
}

function Accordion({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(defaultOpen);
  return <section className="accordion"><button className="accordion-trigger" onClick={() => setOpen(!open)}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} {title}</button>{open && <div className="accordion-content">{children}</div>}</section>;
}

function Field({ label, value, onChange, list }: { label: string; value: string; onChange: (value: string) => void; list?: string }) {
  return <label className="field"><span>{label}</span><input value={value || ""} list={list} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Textarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><textarea value={value || ""} onChange={(event) => onChange(event.target.value)} /></label>;
}

function CustomAttributesEditor({ value, onChange }: { value: Array<{ id: string; key: string; label: string; value: string }>; onChange: (value: Array<{ id: string; key: string; label: string; value: string }>) => void }) {
  return (
    <div className="custom-attributes">
      <div className="subhead">
        <strong>Doplňkové atributy</strong>
        <button onClick={() => onChange([...(value || []), { id: uid("attr"), key: "", label: "", value: "" }])}><Plus size={16} /> Přidat atribut</button>
      </div>
      {(value || []).map((attr, index) => (
        <div className="custom-attribute-row" key={attr.id}>
          <Field label="Klíč" value={attr.key} onChange={(next) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, key: next } : item))} />
          <Field label="Název" value={attr.label} onChange={(next) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, label: next } : item))} />
          <Textarea label="Hodnota" value={attr.value} onChange={(next) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, value: next } : item))} />
          <button className="danger-text" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>Smazat</button>
        </div>
      ))}
    </div>
  );
}

function Segmented({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><div className="segmented">{[1, 2, 3].map((item) => <button type="button" className={value === item ? "active" : ""} key={item} onClick={() => onChange(item)}>{item}</button>)}</div></label>;
}

function ValidityRow({ lpp, onChange }: { lpp: any; onChange: (value: any) => void }) {
  const validity = lpp.platnost;
  const toggle = (mode: number) => {
    const set = new Set<number>(validity.rezimy || []);
    if (set.has(mode)) set.delete(mode);
    else set.add(mode);
    onChange({ ...validity, rezimy: Array.from(set).sort((a: number, b: number) => a - b) });
  };
  const preview = formatPlatnost(validity);
  return (
    <div className="validity-row">
      <strong>REŽIM:</strong>
      <div className="mode-group">{[1, 2, 3, 4, 5, 6].map((mode) => <button key={mode} type="button" className={validity.rezimy?.includes(mode) ? "active" : ""} onClick={() => toggle(mode)}>{mode}</button>)}</div>
      <Field label="Doplňující text" value={validity.doplnujici_text || ""} onChange={(value) => onChange({ ...validity, doplnujici_text: value })} />
      <div className="validity-preview">{preview}</div>
    </div>
  );
}

function ParserWarnings({ warnings }: { warnings: string[] }) {
  return <Card title="Vyžaduje kontrolu" badge="PARSER">{warnings.map((warning) => <div className="warning" key={warning}><AlertTriangle size={16} /> {warning}</div>)}</Card>;
}

function RichText({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [StarterKit, Image, Table.configure({ resizable: true }), TableRow, TableHeader, TableCell],
    content: value || "",
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });
  React.useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value || "", { emitUpdate: false });
  }, [editor, value]);
  if (!editor) return null;
  const addImage = () => {
    const url = prompt("URL obrázku nebo data URL:");
    if (url) editor.chain().focus().setImage({ src: url }).run();
  };
  const addFormula = () => {
    const formula = prompt("Vzorec:", "E = mc²");
    if (formula) editor.chain().focus().insertContent(`<span class="formula">\\(${escapeHtml(formula)}\\)</span>`).run();
  };
  return (
    <div className="rte">
      <div className="rich-toolbar">
        <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></button>
        <button onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></button>
        <button onClick={() => editor.chain().focus().toggleBulletList().run()}>•</button>
        <button onClick={() => editor.chain().focus().toggleOrderedList().run()}>1.</button>
        <button onClick={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()}>Tabulka</button>
        <button onClick={addFormula}>Vzorec</button>
        <button onClick={addImage}>Obrázek</button>
      </div>
      <EditorContent editor={editor} className="rich-editor" />
    </div>
  );
}

function formatPlatnost(platnost: any) {
  const regimes = [...(platnost.rezimy || [])].sort((a: number, b: number) => a - b);
  const prefix = regimes.length ? `Režim ${regimes.join(", ")}` : "";
  return prefix && platnost.doplnujici_text ? `${prefix} – ${platnost.doplnujici_text}` : prefix || platnost.doplnujici_text || "";
}

function download(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function escapeScriptJson(value: string) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

(window as any).LP_ATTRIBUTE_API = {
  getData: () => useDocStore.getState().root,
  listAttributes: () => flattenVisible(useDocStore.getState().root, {}).map(({ node }) => ({ id: node.id, type: node.type, number: node.number, title: node.title })),
  makeReference: (id: string) => ({ type: "document-node-reference", id, valid: true }),
};

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);


