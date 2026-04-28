#!/usr/bin/env python3
"""Conservative LP parser for the source DOCX file."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET


NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
VALID_OPERATORS = {"A", "NEBO"}
ATTRIBUTE_LABELS = {
    "lp.cislo_lp": "Číslo LP",
    "lp.nadpis": "Nadpis LP",
    "lpp.nazev": "Název LPP",
    "lpp.zneni": "Znění LPP",
    "lpp.platnost.rezimy": "Platnost - režimy",
    "lpp.platnost.doplnujici_text": "Platnost - doplňující text",
    "lpp.platnost.exportovana_hodnota": "Platnost - výsledná hodnota",
    "stav.nazev_stavu": "Název stavu",
    "stav.zneni_stavu": "Znění stavu",
    "cinnost.poradove_cislo": "Pořadové číslo činnosti",
    "cinnost.zneni_cinnosti": "Znění činnosti",
    "cinnost.doba_provedeni": "Doba provedení",
    "cinnost.operator": "Operátor",
    "cinnost.operator_indentation": "Úroveň odsazení operátoru",
    "pk.nazev": "Název PK",
    "pk.zneni": "Znění PK",
    "pk.frekvence": "Frekvence",
    "lp.doplnujici_informace": "Doplňující informace",
    "kapitola.nazev": "Název kapitoly",
    "kapitola.html_obsah": "Obsah kapitoly",
}


@dataclass
class Block:
    kind: str
    text: str = ""
    rows: list[list[str]] | None = None


def text_of(element: ET.Element) -> str:
    parts: list[str] = []
    for node in element.iter():
        tag = node.tag.split("}")[-1]
        if tag == "t":
            parts.append(node.text or "")
        elif tag == "tab":
            parts.append("\t")
        elif tag == "br":
            parts.append("\n")
    return "".join(parts)


def read_blocks(docx_path: Path) -> list[Block]:
    with zipfile.ZipFile(docx_path) as package:
        root = ET.fromstring(package.read("word/document.xml"))

    body = root.find("w:body", NS)
    if body is None:
        raise ValueError("DOCX neobsahuje word/body.")

    blocks: list[Block] = []
    for child in list(body):
        tag = child.tag.split("}")[-1]
        if tag == "p":
            text = text_of(child)
            if text.strip():
                blocks.append(Block(kind="p", text=text.strip()))
        elif tag == "tbl":
            rows: list[list[str]] = []
            for row in child.findall("./w:tr", NS):
                cells = [text_of(cell).strip("\n") for cell in row.findall("./w:tc", NS)]
                rows.append(cells)
            blocks.append(Block(kind="tbl", rows=rows))
    return blocks


def field_ids(prefix: str, names: list[str]) -> dict[str, str]:
    return {name: f"{prefix}.{name}" for name in names}


def format_platnost(regimes: list[int], extra: str) -> str:
    regimes_part = "Režim " + ", ".join(str(item) for item in regimes) if regimes else ""
    if regimes_part and extra:
        return f"{regimes_part} – {extra}"
    return regimes_part or extra


def parse_platnost(text: str, lpp_id: str) -> dict[str, Any]:
    raw = re.sub(r"^PLATNOST\s*", "", text, flags=re.IGNORECASE).strip()
    prefix_match = re.match(r"^([1-6](?:\s*,\s*[1-6])*)(?:\s*[-–]\s*(.*))?$", raw)
    regimes: list[int] = []
    extra = raw
    structured = False

    if prefix_match:
        regimes = [int(item.strip()) for item in prefix_match.group(1).split(",")]
        extra = (prefix_match.group(2) or "").strip()
        structured = True

    pid = f"{lpp_id}.platnost"
    export_value = format_platnost(regimes, extra) if structured else raw
    return {
        "id": pid,
        "fieldIds": field_ids(pid, ["rezimy", "doplnujici_text", "exportovana_hodnota"]),
        "rezimy": regimes,
        "doplnujici_text": extra,
        "exportovana_hodnota": export_value,
        "raw": raw,
        "structured": structured,
        "unstructured": "" if structured else raw,
    }


def indentation_level(spaces: int) -> int:
    if spaces >= 8:
        return 3
    if spaces >= 1:
        return 2
    return 1


def split_operator(cell_text: str) -> tuple[str, str, int]:
    lines = cell_text.split("\n")
    if len(lines) < 2:
        return cell_text, "", 1

    last_line = lines[-1]
    operator = last_line.strip()
    if operator not in VALID_OPERATORS:
        return cell_text, "", 1

    spaces = len(last_line) - len(last_line.lstrip(" "))
    activity_text = "\n".join(lines[:-1]).strip("\n")
    return activity_text, operator, indentation_level(spaces)


def strip_activity_number(text: str) -> str:
    return re.sub(r"^\s*[A-ZÁ-Ž]?\d+\.\s*", "", text).strip()


def parse_state(raw: str, state_id: str) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    text = raw.strip()
    match = re.match(r"^([A-ZÁ-Ž0-9]+)\s+(.+)$", text)
    if match:
        name = match.group(1).strip()
        body = match.group(2).strip()
    else:
        name = text
        body = ""
        warnings.append(
            f"Stav '{text}' nemá jednoznačný oddělovač názvu a znění; uložen jako nestrukturovaný název."
        )

    return (
        {
            "id": state_id,
            "fieldIds": field_ids(state_id, ["nazev_stavu", "zneni_stavu"]),
            "nazev_stavu": name,
            "zneni_stavu": body,
            "cinnosti": [],
            "unstructured": "" if body else text,
        },
        warnings,
    )


def parse_activities(rows: list[list[str]], lp_id: str) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    states: list[dict[str, Any]] = []
    warnings: list[str] = []
    unstructured: list[str] = []

    if not rows:
        return states, ["Tabulka činností je prázdná."], []

    header = [cell.strip().upper() for cell in rows[0]]
    expected = ["STAV", "POŽADOVANÁ ČINNOST", "DOBA PROVEDENÍ"]
    if header[:3] != expected:
        warnings.append("Hlavička tabulky činností neodpovídá očekávanému formátu.")
        unstructured.extend(" | ".join(row) for row in rows)
        return states, warnings, unstructured

    current_state: dict[str, Any] | None = None
    state_index = 0
    action_index_by_state: dict[str, int] = {}

    for row in rows[1:]:
        cells = row + [""] * (3 - len(row))
        state_text, activity_cell, duration = cells[:3]

        if state_text.strip():
            state_index += 1
            state_id = f"{lp_id}.stav-{state_index:03d}"
            current_state, state_warnings = parse_state(state_text, state_id)
            warnings.extend(state_warnings)
            states.append(current_state)
            action_index_by_state[state_id] = 0

        if current_state is None:
            row_text = " | ".join(cells)
            warnings.append(f"Činnost bez navázaného stavu přesunuta do nestrukturovaných dat: {row_text}")
            unstructured.append(row_text)
            continue

        action_index_by_state[current_state["id"]] += 1
        action_index = action_index_by_state[current_state["id"]]
        action_id = f"{current_state['id']}.cinnost-{action_index:03d}"
        activity_text, operator, indentation = split_operator(activity_cell)
        current_state["cinnosti"].append(
            {
                "id": action_id,
                "fieldIds": field_ids(
                    action_id,
                    ["poradove_cislo", "zneni_cinnosti", "doba_provedeni", "operator", "operator_indentation"],
                ),
                "zneni_cinnosti": strip_activity_number(activity_text),
                "doba_provedeni": duration.strip(),
                "operator": operator,
                "operator_id": f"{action_id}.operator",
                "operator_indentation": indentation,
            }
        )

    return states, warnings, unstructured


def parse_pk(rows: list[list[str]], lp_id: str) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    pks: list[dict[str, Any]] = []
    warnings: list[str] = []
    unstructured: list[str] = []

    if not rows:
        return pks, ["Tabulka PK je prázdná."], []

    header = [cell.strip().upper() for cell in rows[0]]
    if len(header) < 3 or header[1] != "ZNĚNÍ PK" or header[2] != "FREKVENCE":
        warnings.append("Hlavička tabulky PK neodpovídá očekávanému formátu.")
        unstructured.extend(" | ".join(row) for row in rows)
        return pks, warnings, unstructured

    for index, row in enumerate(rows[1:], start=1):
        cells = row + [""] * (3 - len(row))
        pk_id = f"{lp_id}.pk-{index:03d}"
        pks.append(
            {
                "id": pk_id,
                "fieldIds": field_ids(pk_id, ["nazev", "zneni", "frekvence"]),
                "nazev": cells[0].strip(),
                "zneni": cells[1].strip(),
                "frekvence": cells[2].strip(),
            }
        )

    return pks, warnings, unstructured


def is_lp_start(blocks: list[Block], index: int) -> bool:
    if index + 6 >= len(blocks):
        return False
    title, lpp, platnost, section, activities, pk_label, pk_table = blocks[index : index + 7]
    return (
        title.kind == "p"
        and lpp.kind == "p"
        and lpp.text.upper().startswith("LPP")
        and platnost.kind == "p"
        and platnost.text.upper().startswith("PLATNOST")
        and section.kind == "p"
        and section.text.strip().lower() == "činnosti"
        and activities.kind == "tbl"
        and pk_label.kind == "p"
        and pk_label.text.strip().upper() == "PK"
        and pk_table.kind == "tbl"
    )


def html_escape(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def block_to_html(block: Block) -> str:
    if block.kind == "p":
        return f"<p>{html_escape(block.text)}</p>"
    if block.kind == "tbl":
        rows = block.rows or []
        body = "".join(
            "<tr>" + "".join(f"<td>{html_escape(cell)}</td>" for cell in row) + "</tr>"
            for row in rows
        )
        return f"<table><tbody>{body}</tbody></table>"
    return ""


def parse_lp_blocks(blocks: list[Block]) -> dict[str, Any]:
    lps: list[dict[str, Any]] = []
    warnings: list[str] = []
    i = 0

    while i < len(blocks):
        if i + 6 >= len(blocks):
            warnings.append(f"Zbývající bloky od indexu {i} nemají úplnou strukturu LP.")
            break

        title, lpp, platnost, _section, activities, _pk_label, pk_table = blocks[i : i + 7]
        if not is_lp_start(blocks, i):
            warnings.append(f"Blok od indexu {i} neodpovídá očekávané LP sekvenci; přeskočen jako nestrukturovaný.")
            i += 1
            continue

        lp_index = len(lps) + 1
        lp_id = f"lp-{lp_index:03d}"
        lpp_id = f"{lp_id}.lpp-001"
        lp_warnings = ["Číslo LP nebylo ve zdroji jednoznačně nalezeno; pole je připravené k ručnímu doplnění."]

        lpp_text = re.sub(r"^LPP\s*", "", lpp.text, flags=re.IGNORECASE).strip()
        states, activity_warnings, activity_unstructured = parse_activities(activities.rows or [], lp_id)
        pk_items, pk_warnings, pk_unstructured = parse_pk(pk_table.rows or [], lp_id)

        extra_index = i + 7
        extra_blocks: list[Block] = []
        while extra_index < len(blocks) and not is_lp_start(blocks, extra_index):
            extra_blocks.append(blocks[extra_index])
            extra_index += 1

        lp_warnings.extend(activity_warnings)
        lp_warnings.extend(pk_warnings)

        lps.append(
            {
                "id": lp_id,
                "fieldIds": field_ids(lp_id, ["cislo_lp", "nadpis", "doplnujici_informace"]),
                "cislo_lp": "",
                "nadpis": title.text.strip(),
                "lpp": [
                    {
                        "id": lpp_id,
                        "fieldIds": field_ids(lpp_id, ["nazev", "zneni", "platnost"]),
                        "nazev": "LPP",
                        "zneni": lpp_text,
                        "platnost": parse_platnost(platnost.text, lpp_id),
                    }
                ],
                "cinnosti": states,
                "pk": pk_items,
                "doplnujici_informace": "".join(block_to_html(block) for block in extra_blocks),
                "parserWarnings": lp_warnings,
                "unstructured": activity_unstructured + pk_unstructured,
            }
        )
        i = extra_index

    blocks_out = [
        {
            "id": f"blok-{lp['id']}",
            "typ": "lp",
            "poradi": index + 1,
            "obsah": lp,
        }
        for index, lp in enumerate(lps)
    ]

    return {
        "schemaVersion": 3,
        "document": {
            "id": "document-001",
            "bloky": blocks_out,
        },
        "source": "Testertestujetest.docx",
        "attributeLabels": ATTRIBUTE_LABELS,
        "ciselniky": {
            "doba_provedeni": ["MINUTA", "HODINA", "DEN"],
            "frekvence": ["MINUTA", "HODINA", "DEN"],
            "operator": sorted(VALID_OPERATORS),
            "operator_indentation": [1, 2, 3],
        },
        "lps": lps,
        "parserWarnings": warnings,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("docx", type=Path)
    parser.add_argument("--json-out", type=Path)
    parser.add_argument("--js-out", type=Path)
    args = parser.parse_args()

    data = parse_lp_blocks(read_blocks(args.docx))
    encoded = json.dumps(data, ensure_ascii=False, indent=2)

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(encoded + "\n", encoding="utf-8")
    if args.js_out:
        args.js_out.parent.mkdir(parents=True, exist_ok=True)
        args.js_out.write_text("window.LP_INITIAL_DATA = " + encoded + ";\n", encoding="utf-8")
    if not args.json_out and not args.js_out:
        print(encoded)


if __name__ == "__main__":
    main()
