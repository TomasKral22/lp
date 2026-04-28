# Editor LP

Moderní dokumentový editor nad `Testertestujetest.docx`.

## Spuštění

```powershell
npm install
npm run dev -- --port 5173
```

Aplikace běží na `http://127.0.0.1:5173`.

Produkční build:

```powershell
npm run build
```

## Model

Editor používá stromový model `DocumentNode`:

- `id`: stabilní interní ID pro API, databázi a odkazy
- `parent_id`: nadřazený uzel
- `type`: `document`, `chapter`, `lp`
- `order`: pořadí mezi sourozenci
- `number`: uživatelské/exportní číslo přepočítané ze stromu
- `title`: název pro UI
- `children[]`: podřízené uzly
- `data`: konkrétní data podle typu uzlu

ID se při přesunu, přejmenování ani přečíslování nemění. Číslo je prezentační hodnota.

Strom v levém panelu obsahuje pouze kapitoly, podkapitoly a LP. Vnitřní části LP (`LPP`, `Činnosti`, `PK`, `Doplňující informace`) nejsou stromové uzly; zůstávají v detailu vybrané LP jako karty/accordion sekce.

## UI

Frontend je React + TypeScript aplikace s:

- stromovým levým sidebarem
- hlavním detailem vybraného uzlu
- pravým panelem metadat, odkazů a historie
- drag & drop řazením sourozenců přes dnd-kit
- rich-text editorem Tiptap pro kapitoly a doplňující informace
- stavem aplikace v Zustand
- validací/modelovou kontrolou přes Zod
- ikonami Lucide React
- shadcn-like komponentami postavenými lokálně nad CSS proměnnými

## Import dat

```powershell
python scripts\parse_docx.py Testertestujetest.docx --json-out data\lp-data.json --js-out data\lp-data.js
```

Parser je konzervativní: rozpoznává jasnou sekvenci LP bloků `nadpis -> LPP -> PLATNOST -> Činnosti tabulka -> PK tabulka`. Nejednoznačné části ukládá jako upozornění „vyžaduje kontrolu“.

## API odkazů

```js
window.LP_ATTRIBUTE_API.getData()
window.LP_ATTRIBUTE_API.listAttributes()
window.LP_ATTRIBUTE_API.makeReference("lp-001")
```

Mazání LP v UI má potvrzení a je blokované, pokud existují reference na LP nebo její atributy.
