// LED Screen Planner — ELX 3.9mm
// v1.1 (browser-only)

function ceilDiv(a, b) { return Math.ceil(a / b); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function fmt(n, d=0) { return Number(n).toLocaleString(undefined, { maximumFractionDigits:d, minimumFractionDigits:d }); }

const BUILD = "v1.1";

// ----------------------------
// Panel specs (EDIT these to match your ELX spec sheet)
// ----------------------------
// User requested: 1.0m x 0.5m panel = 256px x 128px
// For 0.5m x 0.5m, default is 128px x 128px (adjust if your half panels differ).
const PANELS = {
  ELX_1x0p5: {
    key: "ELX_1x0p5",
    label: "ELX Series 3.9mm — 1.0m x 0.5m",
    panel_w_m: 1.0,
    panel_h_m: 0.5,
    pixels_w: 256,
    pixels_h: 128,
    weight_kg: 12.0,      // TODO: set exact
    power_rms_w: 250,     // TODO: set typical/average
    power_peak_w: 800     // TODO: set max
  },
  ELX_0p5x0p5: {
    key: "ELX_0p5x0p5",
    label: "ELX Series 3.9mm — 0.5m x 0.5m",
    panel_w_m: 0.5,
    panel_h_m: 0.5,
    pixels_w: 128,        // TODO: confirm
    pixels_h: 128,        // TODO: confirm
    weight_kg: 6.5,       // TODO: set exact
    power_rms_w: 125,     // TODO: set typical/average
    power_peak_w: 400     // TODO: set max
  }
};

// ----------------------------
// Processor DB (EDIT based on NovaStar specs you use)
// ----------------------------
const PROCESSORS = {
  VX600: { model: "NovaStar VX600", ports: 6, max_pixels_total: 3900000, default_max_px_per_port: 650000 },
  VX1000:{ model: "NovaStar VX1000", ports:10, max_pixels_total: 6500000, default_max_px_per_port: 650000 }
};

// ----------------------------
// Groundstack concept rules (non-engineering)
// ----------------------------
function structureSuggestion(area_m2) {
  if (area_m2 <= 12) return "Groundstack: basic goalpost (2 towers + header). Confirm base size/ballast/wind.";
  if (area_m2 <= 30) return "Groundstack: towers + substantial header (consider mid support if wide). Confirm deflection/ballast/wind.";
  return "Recommend engineered support (stage roof / superstructure). Engage rigger/engineer.";
}

// ----------------------------
// Cut-out math (panel-grid based)
// Assumes cut-out centred horizontally, with bottom offset from screen bottom.
// Returns panels removed (grid cells) and removed area in m2.
// ----------------------------
function cutoutPanelsRemoved(pW, pH, panelsW, panelsH, cutWm, cutHm, cutBottomM) {
  const wallWm = panelsW * pW;
  const wallHm = panelsH * pH;

  // Clamp cutout to wall
  const cw = clamp(cutWm, 0, wallWm);
  const ch = clamp(cutHm, 0, wallHm);

  const cutLeft = (wallWm - cw) / 2;
  const cutRight = cutLeft + cw;

  const cutBottom = clamp(cutBottomM, 0, wallHm);
  const cutTop = clamp(cutBottom + ch, 0, wallHm);

  // Convert to panel indices overlapped (grid cells)
  // Any overlap removes the panel cell for planning purposes.
  const colStart = Math.floor(cutLeft / pW);
  const colEnd = Math.ceil(cutRight / pW) - 1;
  const rowStart = Math.floor(cutBottom / pH);
  const rowEnd = Math.ceil(cutTop / pH) - 1;

  if (cw <= 0 || ch <= 0 || cutTop <= cutBottom) return { removed: 0, grid: [] };

  const removedCells = [];
  let removed = 0;
  for (let r = rowStart; r <= rowEnd; r++) {
    for (let c = colStart; c <= colEnd; c++) {
      if (r >= 0 && r < panelsH && c >= 0 && c < panelsW) {
        removed++;
        removedCells.push({ r, c });
      }
    }
  }
  return { removed, removedCells, cutRect: { cutLeft, cutRight, cutBottom, cutTop } };
}

// ----------------------------
// Port planning
// Strategy:
// 1) Determine number of ports required by pixels per port cap.
// 2) Distribute total pixels evenly across ports (last port may be smaller).
// 3) Convert to "panel target per port" based on pixels per panel.
// 4) For each port, split into chains with max panels per chain.
// ----------------------------
function buildPortPlan(totalPanels, pxPerPanel, panelsW, panelsH, portsAvailable, maxPxPerPort, maxPanelsPerChain) {
  const totalPixels = totalPanels * pxPerPanel;
  const portsNeeded = Math.max(1, ceilDiv(totalPixels, maxPxPerPort));
  const portsUsed = Math.min(portsAvailable, portsNeeded);

  // If portsUsed < portsNeeded, it's over capacity.
  const overCapacity = portsUsed < portsNeeded;

  const pxPerPortTarget = Math.ceil(totalPixels / portsUsed);
  const plan = [];
  let remainingPanels = totalPanels;

  for (let i = 0; i < portsUsed; i++) {
    // Aim for proportional panels, but ensure we don't exceed remaining.
    const panelsForPort = (i === portsUsed - 1)
      ? remainingPanels
      : Math.min(remainingPanels, Math.max(1, Math.round(pxPerPortTarget / pxPerPanel)));

    remainingPanels -= panelsForPort;

    // Chains
    const chains = Math.max(1, ceilDiv(panelsForPort, maxPanelsPerChain));
    const chainSizes = [];
    let rem = panelsForPort;
    for (let c = 0; c < chains; c++) {
      const thisSize = (c === chains - 1) ? rem : Math.min(maxPanelsPerChain, rem - (chains - c - 1));
      chainSizes.push(thisSize);
      rem -= thisSize;
    }

    plan.push({
      port: i + 1,
      panels: panelsForPort,
      pixels: panelsForPort * pxPerPanel,
      chains,
      chainSizes
    });
  }

  // If rounding left remainingPanels negative or positive, fix by adjusting last port.
  if (remainingPanels !== 0 && plan.length > 0) {
    plan[plan.length - 1].panels += remainingPanels;
    plan[plan.length - 1].pixels = plan[plan.length - 1].panels * pxPerPanel;
    const panelsForPort = plan[plan.length - 1].panels;
    const chains = Math.max(1, ceilDiv(panelsForPort, maxPanelsPerChain));
    const chainSizes = [];
    let rem = panelsForPort;
    for (let c = 0; c < chains; c++) {
      const thisSize = (c === chains - 1) ? rem : Math.min(maxPanelsPerChain, rem - (chains - c - 1));
      chainSizes.push(thisSize);
      rem -= thisSize;
    }
    plan[plan.length - 1].chains = chains;
    plan[plan.length - 1].chainSizes = chainSizes;
  }

  // Cable counts from plan:
  // - Each chain needs 1 processor feed cable
  // - Each chain needs (chainSize - 1) patch cables between panels
  let processorFeeds = 0;
  let patchLeads = 0;
  for (const p of plan) {
    processorFeeds += p.chains;
    patchLeads += p.chainSizes.reduce((acc, s) => acc + Math.max(0, s - 1), 0);
  }

  return {
    totalPixels,
    portsNeeded,
    portsUsed,
    overCapacity,
    pxPerPortCap: maxPxPerPort,
    processorFeeds,
    patchLeads,
    totalDataCables: processorFeeds + patchLeads,
    plan
  };
}

// ----------------------------
// Power planning
// - Circuits based on 80% continuous load by default.
// - For PD620 (3-phase 32A), compute an "equivalent total power" and show how many 10A/15A-ish circuits you'd need.
//   (This is a planning view; real distro wiring depends on your outlet config.)
// ----------------------------
function powerPlan(totalRmsW, totalPeakW, voltage, circuitA, continuousFactor=0.8) {
  const usableA = circuitA * continuousFactor;
  const usableW = voltage * usableA;
  const rmsCircuits = Math.max(1, ceilDiv(totalRmsW, usableW));
  const peakCircuits = Math.max(1, ceilDiv(totalPeakW, usableW));

  const rmsA = totalRmsW / voltage;
  const peakA = totalPeakW / voltage;

  return { continuousFactor, usableW, rmsCircuits, peakCircuits, rmsA, peakA };
}

function distroTemplateValues(distroKey) {
  if (distroKey === "SP10") return { voltage: 230, circuitA: 10, note: "Single-phase planning (10A)." };
  if (distroKey === "SP15") return { voltage: 230, circuitA: 15, note: "Single-phase planning (15A)." };
  // PD620 style approximation: 3-phase 32A @ 400V; apparent power ~ √3 * V * I
  if (distroKey === "PD620") return { voltage: 230, circuitA: 10, note: "PD620 planning view (treating outputs as multiple SP circuits; confirm outlet mix)." };
  return { voltage: 230, circuitA: 10, note: "" };
}

// ----------------------------
// Per-row power (rows = panelsH)
// ----------------------------
function perRowPower(panelsW, panelsH, panelsRemovedCellsSet, powerRmsW, powerPeakW) {
  const rows = [];
  for (let r = 0; r < panelsH; r++) {
    let panelsInRow = 0;
    for (let c = 0; c < panelsW; c++) {
      const key = `${r},${c}`;
      if (panelsRemovedCellsSet.has(key)) continue;
      panelsInRow++;
    }
    rows.push({
      row: r + 1,
      panels: panelsInRow,
      rmsW: panelsInRow * powerRmsW,
      peakW: panelsInRow * powerPeakW
    });
  }
  return rows;
}

// ----------------------------
// Power cable estimation (simple chain model)
// ----------------------------
function estimatePowerCables(totalPanels, maxPanelsPerChain) {
  const chains = Math.max(1, ceilDiv(totalPanels, maxPanelsPerChain));
  const jumpers = Math.max(0, totalPanels - chains);
  const mainsFeeds = chains;
  return { chains, mainsFeeds, jumpers, totalPowerCables: mainsFeeds + jumpers };
}

// ----------------------------
// BOM CSV generation
// ----------------------------
function makeBomCsv(items) {
  const header = ["Category","Item","Qty","Unit","Notes"];
  const lines = [header.join(",")];
  for (const it of items) {
    const row = [
      it.category ?? "",
      it.item ?? "",
      it.qty ?? "",
      it.unit ?? "",
      (it.notes ?? "").replaceAll('"', '""')
    ].map(v => {
      const s = String(v);
      return (s.includes(",") || s.includes('"') || s.includes("\n")) ? `"${s}"` : s;
    });
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function downloadBlob(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ----------------------------
// UI bindings
// ----------------------------
const $ = (id) => document.getElementById(id);

let latest = null;

function refreshPanelDropdown() {
  const sel = $("panelType");
  sel.innerHTML = "";
  Object.values(PANELS).forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.key;
    opt.textContent = p.label;
    sel.appendChild(opt);
  });
}

function selectedProcessor(procMode, totalPixels) {
  if (procMode === "VX600") return PROCESSORS.VX600;
  if (procMode === "VX1000") return PROCESSORS.VX1000;

  // AUTO: smallest that fits
  const candidates = Object.values(PROCESSORS).filter(p => totalPixels <= p.max_pixels_total);
  candidates.sort((a,b) => a.max_pixels_total - b.max_pixels_total);
  return candidates[0] ?? null;
}

function recalc() {
  $("buildInfo").textContent = `Build ${BUILD}`;

  const panel = PANELS[$("panelType").value];
  $("panelHint").textContent = `${panel.panel_w_m}m × ${panel.panel_h_m}m • ${panel.pixels_w}px × ${panel.pixels_h}px`;

  const screenW = Number($("screenW").value);
  const screenH = Number($("screenH").value);
  const rounding = $("rounding").value;

  const maxPxPerPort = Number($("maxPxPerPort").value);
  const maxPanelsData = Math.max(1, Number($("maxPanelsData").value));
  const maxPanelsPower = Math.max(1, Number($("maxPanelsPower").value));

  const distroKey = $("distro").value;
  const distro = distroTemplateValues(distroKey);

  // allow manual override voltage/circuitA inputs, but keep synced when distro changes
  const voltage = Number($("voltage").value);
  const circuitA = Number($("circuitA").value);

  const wRaw = screenW / panel.panel_w_m;
  const hRaw = screenH / panel.panel_h_m;
  let panelsW = (rounding === "UP") ? Math.ceil(wRaw) : Math.max(1, Math.floor(wRaw));
  let panelsH = (rounding === "UP") ? Math.ceil(hRaw) : Math.max(1, Math.floor(hRaw));

  const builtW = panelsW * panel.panel_w_m;
  const builtH = panelsH * panel.panel_h_m;
  const area = builtW * builtH;

  // Cut-out
  const cutoutEnabled = $("cutoutEnable").checked;
  const cutW = Number($("cutoutW").value);
  const cutH = Number($("cutoutH").value);
  const cutBottom = Number($("cutoutBottom").value);

  let removedInfo = { removed: 0, removedCells: [], cutRect: null };
  if (cutoutEnabled) {
    removedInfo = cutoutPanelsRemoved(panel.panel_w_m, panel.panel_h_m, panelsW, panelsH, cutW, cutH, cutBottom);
  }

  const removedSet = new Set(removedInfo.removedCells.map(x => `${x.r},${x.c}`));
  const totalPanelsGross = panelsW * panelsH;
  const totalPanelsNet = Math.max(0, totalPanelsGross - removedInfo.removed);

  const canvasWpx = panelsW * panel.pixels_w;
  const canvasHpx = panelsH * panel.pixels_h;
  const totalPixelsNet = totalPanelsNet * (panel.pixels_w * panel.pixels_h);

  // Processor selection
  const procMode = $("procMode").value;
  const proc = selectedProcessor(procMode, totalPixelsNet);
  let procRec = "No processor fits the total pixel load (based on current DB). Add a larger model or change constraints.";
  let portPlan = null;

  if (proc) {
    const maxPxPort = maxPxPerPort || proc.default_max_px_per_port;
    portPlan = buildPortPlan(
      totalPanelsNet,
      panel.pixels_w * panel.pixels_h,
      panelsW,
      panelsH,
      proc.ports,
      maxPxPort,
      maxPanelsData
    );
    procRec = `${proc.model} • Ports: ${proc.ports} • Wall pixels: ${fmt(totalPixelsNet)} • Ports needed by cap: ${portPlan.portsNeeded}`;
    if (portPlan.overCapacity) procRec += " • OVER CAPACITY (needs more ports/processors)";
  }

  // Power totals (net panels only)
  const totalWeight = totalPanelsNet * panel.weight_kg;
  const totalRmsW = totalPanelsNet * panel.power_rms_w;
  const totalPeakW = totalPanelsNet * panel.power_peak_w;

  const power = powerPlan(totalRmsW, totalPeakW, voltage, circuitA, 0.8);

  // Per-row power
  const rows = perRowPower(panelsW, panelsH, removedSet, panel.power_rms_w, panel.power_peak_w);

  // Power cables (simple chain model)
  const powerCables = estimatePowerCables(totalPanelsNet, maxPanelsPower);

  // Cables summary
  const dataCables = portPlan ? {
    processorFeeds: portPlan.processorFeeds,
    patchLeads: portPlan.patchLeads,
    totalDataCables: portPlan.totalDataCables
  } : { processorFeeds: 0, patchLeads: 0, totalDataCables: 0 };

  // Structure
  const structure = structureSuggestion(area);

  // Metrics UI
  $("mPanels").textContent = `${panelsW} × ${panelsH} (${totalPanelsNet} net${cutoutEnabled ? `, ${removedInfo.removed} removed` : ""})`;
  $("mSize").textContent = `${builtW.toFixed(2)} × ${builtH.toFixed(2)} (${area.toFixed(1)} m²)`;
  $("mPixels").textContent = `${canvasWpx} × ${canvasHpx} (per-grid), net ${fmt(totalPixelsNet)} px`;
  $("mWeight").textContent = `${totalWeight.toFixed(1)} kg (LED only)`;

  $("procRec").textContent = procRec;
  $("structureConcept").textContent = structure;

  // Power UI
  $("powerOut").textContent =
    `RMS: ${fmt(totalRmsW)} W\n` +
    `Peak: ${fmt(totalPeakW)} W\n\n` +
    `Assumed: ${voltage}V, ${circuitA}A, 80% cont.\n` +
    `Usable per circuit: ${fmt(power.usableW)} W\n\n` +
    `RMS current: ${power.rmsA.toFixed(1)} A\n` +
    `Peak current: ${power.peakA.toFixed(1)} A\n\n` +
    `Circuits needed (RMS): ${power.rmsCircuits}\n` +
    `Circuits needed (Peak): ${power.peakCircuits}\n` +
    `Template note: ${distro.note}`;

  // Ports table
  const portsTbl = $("portsTable");
  portsTbl.innerHTML = "";
  if (portPlan) {
    $("portNote").textContent = `Pixels/port cap: ${fmt(portPlan.pxPerPortCap)} • Data chains cap: ${maxPanelsData} panels/chain`;
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
      <th>Port</th>
      <th>Panels</th>
      <th>Pixels</th>
      <th>Chains</th>
      <th>Chain sizes</th>
    </tr>`;
    portsTbl.appendChild(thead);
    const tbody = document.createElement("tbody");
    portPlan.plan.forEach(p => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${p.port}</td>
        <td>${p.panels}</td>
        <td>${fmt(p.pixels)}</td>
        <td>${p.chains}</td>
        <td>${p.chainSizes.join(", ")}</td>`;
      tbody.appendChild(tr);
    });
    portsTbl.appendChild(tbody);
  } else {
    $("portNote").textContent = "—";
    portsTbl.innerHTML = `<thead><tr><th>—</th></tr></thead><tbody><tr><td>No processor selected / fits.</td></tr></tbody>`;
  }

  // Row table
  const rowTbl = $("rowTable");
  rowTbl.innerHTML = "";
  const rowHead = document.createElement("thead");
  rowHead.innerHTML = `<tr><th>Row</th><th>Panels</th><th>RMS (W)</th><th>Peak (W)</th></tr>`;
  rowTbl.appendChild(rowHead);
  const rowBody = document.createElement("tbody");
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.row}</td><td>${r.panels}</td><td>${fmt(r.rmsW)}</td><td>${fmt(r.peakW)}</td>`;
    rowBody.appendChild(tr);
  });
  rowTbl.appendChild(rowBody);

  // Cable summary UI
  $("cablesOut").textContent =
    `DATA\n` +
    `Processor→First panel feeds: ${dataCables.processorFeeds}\n` +
    `Panel→Panel patch leads: ${dataCables.patchLeads}\n` +
    `Total data cables: ${dataCables.totalDataCables}\n\n` +
    `POWER\n` +
    `Power chains: ${powerCables.chains}\n` +
    `Mains feeds: ${powerCables.mainsFeeds}\n` +
    `Power jumpers: ${powerCables.jumpers}\n` +
    `Total power cables: ${powerCables.totalPowerCables}`;

  latest = {
    build: BUILD,
    inputs: {
      panelKey: panel.key,
      screenW_m: screenW,
      screenH_m: screenH,
      rounding,
      cutout: cutoutEnabled ? { enabled: true, width_m: cutW, height_m: cutH, bottomOffset_m: cutBottom } : { enabled: false },
      maxPxPerPort,
      maxPanelsData,
      maxPanelsPower,
      distroTemplate: distroKey,
      voltage_v: voltage,
      circuitA
    },
    panel,
    derived: {
      panelsW,
      panelsH,
      totalPanelsGross,
      panelsRemoved: removedInfo.removed,
      totalPanelsNet,
      builtW_m: builtW,
      builtH_m: builtH,
      area_m2: area,
      canvasGrid_px: { w: canvasWpx, h: canvasHpx },
      totalPixelsNet,
      totals: {
        weight_kg: totalWeight,
        power_rms_w: totalRmsW,
        power_peak_w: totalPeakW
      },
      processor: proc,
      portPlan,
      power,
      perRow: rows,
      cables: { data: dataCables, power: powerCables },
      structureConcept: structure
    }
  };

  $("jsonOut").textContent = JSON.stringify(latest, null, 2);
}

// UI events
document.addEventListener("DOMContentLoaded", () => {
  refreshPanelDropdown();
  $("buildInfo").textContent = `Build ${BUILD}`;

  // Defaults
  $("panelType").value = "ELX_1x0p5";

  // Cutout enable toggles
  const toggleCut = () => {
    const en = $("cutoutEnable").checked;
    ["cutoutW","cutoutH","cutoutBottom"].forEach(id => $(id).disabled = !en);
  };
  $("cutoutEnable").addEventListener("change", () => { toggleCut(); recalc(); });
  toggleCut();

  // Distro template quick-set voltage/circuit defaults (doesn't override if user changes afterwards unless they change template)
  $("distro").addEventListener("change", () => {
    const key = $("distro").value;
    const d = distroTemplateValues(key);
    // For SP10/SP15 set defaults; for PD620 keep voltage as user but default circuitA to 10 for planning.
    $("voltage").value = d.voltage;
    $("circuitA").value = d.circuitA;
    recalc();
  });

  // Buttons
  $("recalcBtn").addEventListener("click", recalc);
  $("downloadJsonBtn").addEventListener("click", () => {
    if (!latest) recalc();
    downloadBlob(JSON.stringify(latest, null, 2), "led_screen_plan.json", "application/json");
  });
  $("downloadBomBtn").addEventListener("click", () => {
    if (!latest) recalc();
    const d = latest.derived;
    const p = latest.panel;
    const proc = d.processor;

    const items = [];
    items.push({ category:"LED", item:p.label, qty:d.totalPanelsNet, unit:"panel", notes:`${p.panel_w_m}m x ${p.panel_h_m}m • ${p.pixels_w}x${p.pixels_h}px` });
    if (proc) items.push({ category:"Processing", item:proc.model, qty:1, unit:"unit", notes:`Ports ${proc.ports}` });

    // Cables
    items.push({ category:"Cables - Data", item:"Processor feeds (data)", qty:d.cables.data.processorFeeds, unit:"cable", notes:"Processor → first panel per chain" });
    items.push({ category:"Cables - Data", item:"Patch leads (data)", qty:d.cables.data.patchLeads, unit:"cable", notes:"Panel → panel within chains" });
    items.push({ category:"Cables - Power", item:"Mains feeds (power)", qty:d.cables.power.mainsFeeds, unit:"cable", notes:"Feed per power chain" });
    items.push({ category:"Cables - Power", item:"Power jumpers", qty:d.cables.power.jumpers, unit:"cable", notes:"Panel → panel within power chains" });

    // Power summary line
    items.push({ category:"Power", item:"Estimated RMS", qty:Math.round(d.totals.power_rms_w), unit:"W", notes:"Total wall RMS estimate" });
    items.push({ category:"Power", item:"Estimated Peak", qty:Math.round(d.totals.power_peak_w), unit:"W", notes:"Total wall peak estimate" });
    items.push({ category:"Power", item:"Circuits (RMS)", qty:d.power.rmsCircuits, unit:"circuit", notes:`${latest.inputs.voltage_v}V @ ${latest.inputs.circuitA}A (80%)` });

    // Structure concept line
    items.push({ category:"Rigging", item:"Structure concept", qty:1, unit:"note", notes:d.structureConcept });

    // Cutout
    if (latest.inputs.cutout.enabled) {
      items.push({ category:"LED", item:"Cut-out (removed panels)", qty:d.panelsRemoved, unit:"panel", notes:"Removed from gross panel grid" });
    }

    const csv = makeBomCsv(items);
    downloadBlob(csv, "led_wall_bom.csv", "text/csv");
  });

  // Recalc on input change (lightweight)
  ["panelType","screenW","screenH","rounding","cutoutW","cutoutH","cutoutBottom",
   "procMode","maxPxPerPort","maxPanelsData","maxPanelsPower","voltage","circuitA"].forEach(id => {
     $(id).addEventListener("input", () => recalc());
     $(id).addEventListener("change", () => recalc());
  });

  recalc();
});
