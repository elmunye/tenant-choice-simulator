import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const personaCoefs = JSON.parse(
  fs.readFileSync(path.join(root, "notebooks/data/persona_coefs.json"), "utf8")
);
const csv = fs.readFileSync(path.join(root, "notebooks/data/attributes.csv"), "utf8");
const pooledCsv = fs.readFileSync(path.join(root, "notebooks/data/pooled_coefs.csv"), "utf8");

function parseCsv(text) {
  const rows = [];
  let i = 0,
    field = "",
    row = [],
    inQ = false;
  while (i < text.length) {
    const c = text[i++];
    if (inQ) {
      if (c === '"') {
        if (text[i] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i] === "\n") i++;
        row.push(field);
        if (row.some((x) => x !== "")) rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((x) => x !== "")) rows.push(row);
  }
  return rows;
}

const rows = parseCsv(csv);
const dataRows = rows.slice(1);
const byAttr = {};
for (const r of dataRows) {
  const [attr, level, numStr, ordStr] = r;
  if (!attr) continue;
  if (!byAttr[attr]) byAttr[attr] = [];
  const numericValue = numStr === "" ? null : Number(numStr);
  const level_order = Number(ordStr);
  let id;
  if (attr === "Size") id = `size_${numericValue}`;
  else if (attr === "Price") id = `price_${numericValue}`;
  else id = `L_${attr}_${level_order}`;
  byAttr[attr].push({ id, label: level, numericValue: Number.isFinite(numericValue) ? numericValue : null, level_order });
}
for (const k of Object.keys(byAttr)) byAttr[k].sort((a, b) => a.level_order - b.level_order);

const ATTR_NAMES = [
  "Size",
  "Price",
  "MoveInSpecial",
  "Location",
  "CommuteToWork",
  "Walkability",
  "Finishes",
  "Parking",
  "Security",
  "Rooftop",
  "Coworking",
  "PetAmenities",
  "PackageHandling",
];

const ATTRIBUTES_UI = ATTR_NAMES.map((id) => {
  const levels = byAttr[id] || [];
  const isNumeric = id === "Size" || id === "Price";
  const name = id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
  return { id, name, isNumeric, levels };
});

const pooledRows = parseCsv(pooledCsv)
  .slice(1)
  .map((r) => ({ feature: r[0].replace(/^"|"$/g, "") }))
  .filter((r) => r.feature.includes("__"));

function deriveBaselineLabel(attr) {
  const levels = byAttr[attr];
  if (!levels || !levels.length) return "";
  const inPooled = new Set();
  for (const { feature } of pooledRows) {
    const sep = feature.indexOf("__");
    if (sep === -1) continue;
    const a = feature.slice(0, sep);
    if (a !== attr) continue;
    inPooled.add(feature.slice(sep + 2));
  }
  for (const lv of levels) {
    if (!inPooled.has(lv.label)) return lv.label;
  }
  return levels[0].label;
}

const baselineLabel = {};
for (const id of ATTR_NAMES) {
  if (id === "Size" || id === "Price") continue;
  baselineLabel[id] = deriveBaselineLabel(id);
}

function pickLevelId(attr, pred) {
  for (const lv of byAttr[attr]) {
    if (pred(lv)) return lv.id;
  }
  return byAttr[attr][0].id;
}

const defSubjectAttr = {
  Size: pickLevelId("Size", (lv) => lv.numericValue === 1000),
  Price: pickLevelId("Price", (lv) => lv.numericValue === 1950),
  Location: pickLevelId("Location", (lv) => lv.label.includes("Decatur")),
  CommuteToWork: pickLevelId("CommuteToWork", (lv) => lv.label.startsWith("Average")),
  Walkability: pickLevelId("Walkability", (lv) => lv.label.includes("Walkable Errands")),
  Finishes: pickLevelId("Finishes", (lv) => lv.label.includes("Mid-tier")),
  Parking: pickLevelId("Parking", (lv) => lv.label.startsWith("Surface")),
  Security: pickLevelId("Security", (lv) => lv.label.includes("Tier 1")),
  MoveInSpecial: pickLevelId("MoveInSpecial", (lv) => lv.label === "None"),
  Rooftop: pickLevelId("Rooftop", (lv) => lv.label.startsWith("No rooftop")),
  Coworking: pickLevelId("Coworking", (lv) => lv.label.startsWith("No dedicated")),
  PetAmenities: pickLevelId("PetAmenities", (lv) => lv.label.startsWith("No pet")),
  PackageHandling: pickLevelId("PackageHandling", (lv) => lv.label.startsWith("Standard mailroom")),
};

const defCompAAttr = {
  ...defSubjectAttr,
  Price: pickLevelId("Price", (lv) => lv.numericValue === 1650),
  Finishes: pickLevelId("Finishes", (lv) => lv.label.includes("Builder-grade")),
};

const defCompBAttr = {
  ...defSubjectAttr,
  Price: pickLevelId("Price", (lv) => lv.numericValue === 2250),
  Location: pickLevelId("Location", (lv) => lv.label.includes("Virginia-Highland")),
  Finishes: pickLevelId("Finishes", (lv) => lv.label.includes("Premium")),
};

const ATTR_PACK = {
  ATTRIBUTES_UI,
  baselineLabel,
  ATTR_NAMES,
  defaults: {
    subject: { id: "subject", name: "450 W Ponce de Leon Ave", attributes: defSubjectAttr },
    compA: { id: "comp-a", name: "The Solis Decatur", attributes: defCompAAttr },
    compB: { id: "comp-b", name: "Highland Park Residences", attributes: defCompBAttr },
  },
};

const appJs = fs.readFileSync(path.join(__dirname, "comp-underwriter-app.jsx"), "utf8");

const coefJson = JSON.stringify(personaCoefs);
const attrJson = JSON.stringify(ATTR_PACK);

const html =
  `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Comp Underwriter</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  <style>
    html, body { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    body { margin: 0; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel" data-type="module" data-presets="react">
import * as React from "https://esm.sh/react@19";
import { createRoot } from "https://esm.sh/react-dom@19/client";
const { useEffect, useMemo, useState } = React;

const PERSONA_COEFS_RAW = ` +
  coefJson +
  `;
const ATTR_PACK = ` +
  attrJson +
  `;
const ATTRIBUTES = ATTR_PACK.ATTRIBUTES_UI;
const BASELINE_LEVEL_LABEL = ATTR_PACK.baselineLabel;
const ENGINE_ATTR_NAMES = ATTR_PACK.ATTR_NAMES;

` +
  appJs +
  `
createRoot(document.getElementById("root")).render(<App />);
  </script>
</body>
</html>
`;

fs.writeFileSync(path.join(root, "comp-underwriter.html"), html);
console.log("Wrote comp-underwriter.html");
