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
import { PackageDefinition, loadPackageDefinition, savePackageDefinition } from "./schema/packageSchema";
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
  | "additional_info";

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
type AppMode = "document" | "builder";
type CreatableNodeType = Extract<NodeType, "chapter" | "lp" | "lpp" | "state" | "activity" | "pk_item">;

type AppState = {
  root: DocumentNode;
  selectedId: string;
  collapsed: Record<string, boolean>;
  references: Reference[];
  history: string[];
  select: (id: string) => void;
  toggle: (id: string) => void;
  updateNodeData: (id: string, patch: Record<string, any>) => void;
  updateLp: (lpId: string, updater: (lp: Lp) => void, label: string) => void;
  addChapter: (mode: "before" | "after" | "child", anchorId: string) => void;
  addLp: (mode: "before" | "after" | "child", anchorId: string) => void;
  addChildObject: (parentId: string, type: CreatableNodeType) => void;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  moveSibling: (id: string, direction: -1 | 1) => void;
  reorderSiblings: (activeId: string, overId: string) => void;
  save: () => void;
  reset: () => void;
};

const STORAGE_KEY = "lp-tree-editor-structure-v2";
const OPERATOR_INDENT_SPACES: Record<number, number> = { 1: 0, 2: 4, 3: 8 };
const NODE_TYPE_LABELS: Record<CreatableNodeType, string> = {
  chapter: "Kapitola",
  lp: "LP",
  lpp: "LPP",
  state: "Stav",
  activity: "Činnost",
  pk_item: "PK",
};
const DEFAULT_CHILD_RULES: Record<NodeType, CreatableNodeType[]> = {
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
};

const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const clone = <T,>(value: T): T => structuredClone(value);

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

function createNodeByType(type: CreatableNodeType, parentId: string | null): DocumentNode {
  if (type === "chapter") return chapterToNode({}, parentId);
  if (type === "lp") return lpToNode({}, parentId);
  const id = uid(type);
  const dataByType: Record<CreatableNodeType, any> = {
    chapter: {},
    lp: {},
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
  return baseNode(type, NODE_TYPE_LABELS[type], dataByType[type], parentId);
}

function allowedChildTypes(node: DocumentNode | null) {
  return node ? DEFAULT_CHILD_RULES[node.type] || [] : DEFAULT_CHILD_RULES.document;
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
  return ["chapter", "lp", "lpp", "state", "activity", "pk_item"].includes(node.type);
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

function buildExportHtml(root: DocumentNode) {
  const body = root.children.map(exportNode).join("\n");
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>LP export</title><style>body{font-family:Arial,sans-serif;margin:32px;line-height:1.35}.document-block{display:block;margin:0 0 30px;padding-top:1px}.document-block+.document-block{border-top:1px solid transparent;padding-top:18px}table{border-collapse:collapse;width:100%;margin:8px 0 18px}td,th{border:1px solid #777;padding:6px;vertical-align:top;white-space:pre-wrap}th{background:#eee}.operator{display:block;white-space:pre;font-weight:bold;margin-top:4px}img{max-width:100%;height:auto}</style></head><body>${body}<script type="application/json" id="document-tree">${escapeScriptJson(JSON.stringify(root))}</script></body></html>`;
}

const useDocStore = create<AppState>((set, get) => ({
  root: buildInitialRoot(initialData),
  selectedId: buildInitialRoot(initialData).children[0]?.id || "document-001",
  collapsed: {},
  references: (initialData as any).references || [],
  history: [],
  select: (id) => set({ selectedId: id }),
  toggle: (id) => set((state) => ({ collapsed: { ...state.collapsed, [id]: !state.collapsed[id] } })),
  updateNodeData: (id, patch) => set((state) => {
    const root = clone(state.root);
    const node = findNode(root, id);
    if (node) {
      node.data = { ...node.data, ...patch };
      node.title = nodeTitle(node);
    }
    return { root: recomputeNumbers(root), history: [`Upraven uzel ${id}`, ...state.history].slice(0, 20) };
  }),
  updateLp: (lpId, updater, label) => set((state) => {
    const root = clone(state.root);
    const node = findNode(root, lpId);
    if (node?.type === "lp") {
      updater(node.data);
      node.title = nodeTitle(node);
    }
    return { root: recomputeNumbers(root), history: [label, ...state.history].slice(0, 20) };
  }),
  addChapter: (mode, anchorId) => set((state) => {
    const root = clone(state.root);
    const anchor = findNode(root, anchorId) || root.children[0];
    const parent = mode === "child" && anchor?.type === "chapter" ? anchor : findParent(root, anchor?.id || "") || root;
    const index = mode === "before" ? parent.children.findIndex((child) => child.id === anchor.id) : parent.children.findIndex((child) => child.id === anchor.id) + 1;
    const chapter = chapterToNode({}, parent.id);
    parent.children.splice(Math.max(0, index), 0, chapter);
    return { root: recomputeNumbers(root), selectedId: chapter.id, history: ["Přidána kapitola", ...state.history].slice(0, 20) };
  }),
  addLp: (mode, anchorId) => set((state) => {
    const root = clone(state.root);
    const anchor = findNode(root, anchorId) || root.children[0];
    const parent = mode === "child" && anchor?.type === "chapter" ? anchor : findParent(root, anchor?.id || "") || root;
    const index = mode === "before" ? parent.children.findIndex((child) => child.id === anchor.id) : parent.children.findIndex((child) => child.id === anchor.id) + 1;
    const lp = lpToNode({}, parent.id);
    parent.children.splice(Math.max(0, index), 0, lp);
    return { root: recomputeNumbers(root), selectedId: lp.id, history: ["Přidána LP", ...state.history].slice(0, 20) };
  }),
  addChildObject: (parentId, type) => set((state) => {
    const root = clone(state.root);
    const parent = findNode(root, parentId) || root;
    const allowed = allowedChildTypes(parent);
    if (!allowed.includes(type)) return state;
    const child = createNodeByType(type, parent.id);
    parent.children.push(child);
    return { root: recomputeNumbers(root), selectedId: child.id, history: [`Přidán objekt ${NODE_TYPE_LABELS[type]}`, ...state.history].slice(0, 20) };
  }),
  deleteNode: (id) => set((state) => {
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
    return { root: recomputeNumbers(root), selectedId: root.children[0]?.id || root.id, history: [`Odstraněn uzel ${id}`, ...state.history].slice(0, 20) };
  }),
  duplicateNode: (id) => set((state) => {
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
    return { root: recomputeNumbers(root), selectedId: copy.id, history: ["Duplikován blok", ...state.history].slice(0, 20) };
  }),
  moveSibling: (id, direction) => set((state) => {
    const root = clone(state.root);
    const parent = findParent(root, id);
    if (!parent) return state;
    const index = parent.children.findIndex((child) => child.id === id);
    const next = index + direction;
    if (next < 0 || next >= parent.children.length) return state;
    parent.children = arrayMove(parent.children, index, next);
    return { root: recomputeNumbers(root), history: ["Přesunut uzel", ...state.history].slice(0, 20) };
  }),
  reorderSiblings: (activeId, overId) => set((state) => {
    const root = clone(state.root);
    const activeParent = findParent(root, activeId);
    const overParent = findParent(root, overId);
    if (!activeParent || !overParent || activeParent.id !== overParent.id) return state;
    const oldIndex = activeParent.children.findIndex((child) => child.id === activeId);
    const newIndex = activeParent.children.findIndex((child) => child.id === overId);
    activeParent.children = arrayMove(activeParent.children, oldIndex, newIndex);
    return { root: recomputeNumbers(root), history: ["Přetažen uzel", ...state.history].slice(0, 20) };
  }),
  save: () => {
    const state = get();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ root: state.root, references: state.references }));
  },
  reset: () => {
    localStorage.removeItem(STORAGE_KEY);
    const root = buildInitialRoot(initialData);
    set({ root, selectedId: root.children[0]?.id || root.id, collapsed: {}, history: ["Reset na importovaná data"] });
  },
}));

function App() {
  const [mode, setMode] = React.useState<AppMode>("document");
  const [metadataOpen, setMetadataOpen] = React.useState(true);
  const { root, selectedId, reorderSiblings } = useDocStore();
  const selected = findNode(root, selectedId) || root.children[0];
  const visible = flattenVisible(root, useDocStore.getState().collapsed);

  const onDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) reorderSiblings(String(event.active.id), String(event.over.id));
  };

  return (
    <div className="app-shell">
      <TopToolbar mode={mode} onModeChange={setMode} metadataOpen={metadataOpen} onToggleMetadata={() => setMetadataOpen((open) => !open)} />
      {mode === "builder" ? <BuilderWorkspace /> : <div className={metadataOpen ? "layout" : "layout metadata-collapsed"}>
        <aside className="sidebar">
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
  const { selectedId, save, root } = useDocStore();
  const selected = findNode(root, selectedId) || root;
  const exportHtml = () => download("lp-export.html", buildExportHtml(root), "text/html;charset=utf-8");
  const exportDoc = () => download("lp-export.doc", buildExportHtml(root), "application/msword;charset=utf-8");
  const exportJson = () => download("lp-tree-export.json", JSON.stringify(root, null, 2), "application/json;charset=utf-8");
  return (
    <header className="topbar">
      <div className="brand">
        <strong>{mode === "document" ? "Editor LP" : "Builder editoru"}</strong>
        <span>{mode === "document" ? "Stromovy dokumentovy editor" : "Skladani vlastnich editoru z komponent a funkci"}</span>
      </div>
      <div className="toolbar">
        <div className="mode-switch">
          <button className={mode === "document" ? "active" : ""} onClick={() => onModeChange("document")}><FileText size={16} /> Dokument</button>
          <button className={mode === "builder" ? "active" : ""} onClick={() => onModeChange("builder")}><Settings size={16} /> Builder</button>
        </div>
        {mode === "document" ? <>
          <AddChildMenu parent={selected} />
          <button onClick={save}><Save size={16} /> Uložit</button>
          <button onClick={exportJson}><Download size={16} /> JSON</button>
          <button onClick={exportHtml}><Download size={16} /> HTML</button>
          <button onClick={exportDoc}><Download size={16} /> DOC</button>
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
        {options.map((type) => <option key={type} value={type}>{NODE_TYPE_LABELS[type]}</option>)}
      </select>
    </label>
  );
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
    setPackageDefinition(definition);
    savePackageDefinition(definition);
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
  const hierarchySummary = definition.assets.hierarchyRules.map((rule) => {
    const parent = definition.assets.objectTypes.find((type) => type.key === rule.parentObjectTypeKey)?.name || rule.parentObjectTypeKey;
    const children = rule.allowedChildObjectTypeKeys.map((key) => definition.assets.objectTypes.find((type) => type.key === key)?.name || key).join(", ");
    return `${parent} → ${children || "žádný potomek"}`;
  });
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
      field.fields = [createField("Polozka")];
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
                    title={field.component === "table" ? "Sloupce tabulky" : "Pole opakovatelne polozky"}
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
      setError(error instanceof Error ? error.message : "Neplatny JSON");
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
      <button onClick={addRow}><Plus size={16} /> Pridat radek</button>
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
          <button className="danger-text" onClick={() => onChange(value.filter((_, index) => index !== itemIndex))}>Smazat polozku</button>
        </div>
      ))}
      <button onClick={addItem}><Plus size={16} /> Pridat polozku</button>
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
      setError(error instanceof Error ? error.message : "Neplatny JSON");
    }
  };
  return <label className="field json-field"><span>{label}</span><textarea value={text} onChange={(event) => setText(event.target.value)} onBlur={commit} />{error ? <small className="field-error">{error}</small> : null}</label>;
}

function TreeRow({ node, level }: { node: DocumentNode; level: number }) {
  const { selectedId, collapsed, select, toggle, deleteNode, duplicateNode, moveSibling } = useDocStore();
  const sortable = useSortable({ id: node.id, disabled: !canDrag(node) });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };
  const hasChildren = node.children.length > 0;
  return (
    <div ref={sortable.setNodeRef} style={style} className={`tree-row ${selectedId === node.id ? "selected" : ""}`} onClick={() => select(node.id)}>
      <div className="tree-main" style={{ paddingLeft: 8 + level * 16 }}>
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
  const label = type === "chapter" ? "KAPITOLA" : type === "lp" ? "LP" : type.toUpperCase();
  return <span className={`badge ${type}`}>{label}</span>;
}

function NodeDetail({ node }: { node: DocumentNode }) {
  if (node.type === "chapter") return <ChapterEditor node={node} />;
  if (node.type === "lp") return <LpEditor node={node} />;
  if (["lpp", "state", "activity", "pk_item"].includes(node.type)) return <GenericObjectEditor node={node} />;
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
  const update = (fn: (lp: Lp) => void, label = "Upravena LP") => updateLp(node.id, fn, label);
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
