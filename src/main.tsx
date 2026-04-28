import React from "react";
import ReactDOM from "react-dom/client";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { create } from "zustand";
import { z } from "zod";
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
  Plus,
  Save,
} from "lucide-react";
import initialData from "../data/lp-data.json";
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
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  moveSibling: (id: string, direction: -1 | 1) => void;
  reorderSiblings: (activeId: string, overId: string) => void;
  save: () => void;
  reset: () => void;
};

const STORAGE_KEY = "lp-tree-editor-structure-v2";
const OPERATOR_INDENT_SPACES: Record<number, number> = { 1: 0, 2: 4, 3: 8 };
const lpSchema = z.object({
  id: z.string(),
  cislo_lp: z.string().optional(),
  nadpis: z.string().optional(),
});

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
  return ["chapter", "lp"].includes(node.type);
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
  return "";
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
  return `<section class="document-block lp" data-node-id="${node.id}"><h1>${node.number} ${escapeHtml(lp.nadpis || "")}</h1>${lpp}<h2>Činnosti</h2><table><thead><tr><th>STAV</th><th>POŽADOVANÁ ČINNOST</th><th>DOBA PROVEDENÍ</th></tr></thead><tbody>${states}</tbody></table><h2>PK</h2><table><thead><tr><th>Název</th><th>Znění PK</th><th>FREKVENCE</th></tr></thead><tbody>${pk}</tbody></table>${lp.doplnujici_informace || ""}</section>`;
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
      const synced = lpToNode(node.data, node.parent_id);
      node.children = synced.children;
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
  const { root, selectedId, reorderSiblings } = useDocStore();
  const selected = findNode(root, selectedId) || root.children[0];
  const visible = flattenVisible(root, useDocStore.getState().collapsed);

  const onDragEnd = (event: DragEndEvent) => {
    if (event.over && event.active.id !== event.over.id) reorderSiblings(String(event.active.id), String(event.over.id));
  };

  return (
    <div className="app-shell">
      <TopToolbar />
      <div className="layout">
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
        <RightPanel node={selected} />
      </div>
    </div>
  );
}

function TopToolbar() {
  const { selectedId, addChapter, addLp, save, root } = useDocStore();
  const exportHtml = () => download("lp-export.html", buildExportHtml(root), "text/html;charset=utf-8");
  const exportDoc = () => download("lp-export.doc", buildExportHtml(root), "application/msword;charset=utf-8");
  const exportJson = () => download("lp-tree-export.json", JSON.stringify(root, null, 2), "application/json;charset=utf-8");
  return (
    <header className="topbar">
      <div className="brand">
        <strong>Editor LP</strong>
        <span>Stromový dokumentový editor</span>
      </div>
      <div className="toolbar">
        <button onClick={() => addChapter("after", selectedId)}><Plus size={16} /> Kapitola</button>
        <button className="primary" onClick={() => addLp("after", selectedId)}><Plus size={16} /> LP</button>
        <button onClick={save}><Save size={16} /> Uložit</button>
        <button onClick={exportJson}><Download size={16} /> JSON</button>
        <button onClick={exportHtml}><Download size={16} /> HTML</button>
        <button onClick={exportDoc}><Download size={16} /> DOC</button>
      </div>
    </header>
  );
}

function TreeRow({ node, level }: { node: DocumentNode; level: number }) {
  const { selectedId, collapsed, select, toggle, deleteNode, duplicateNode, moveSibling, addChapter, addLp } = useDocStore();
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
        {node.type === "chapter" && <button onClick={() => addLp("child", node.id)}>LP dovnitř</button>}
        <button onClick={() => addChapter("after", node.id)}>+ Kap.</button>
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
  return <ReadOnlyNode node={node} />;
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
          </Card>
        ))}
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
            <div className="inline-actions">
              <button onClick={() => update((draft) => { draft.cinnosti[stateIndex].cinnosti.push({ id: uid("activity"), zneni_cinnosti: "", doba_provedeni: "", operator: "", operator_indentation: 1 }); })}>Přidat činnost</button>
              <button onClick={() => update((draft) => { draft.cinnosti.splice(stateIndex + 1, 0, { id: uid("state"), nazev_stavu: "", zneni_stavu: "", cinnosti: [{ id: uid("activity"), zneni_cinnosti: "", doba_provedeni: "", operator: "", operator_indentation: 1 }] }); })}>Přidat stav</button>
            </div>
          </Card>
        ))}
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
