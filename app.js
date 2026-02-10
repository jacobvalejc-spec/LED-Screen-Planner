function ceilDiv(a, b) { return Math.ceil(a / b); }

function recalc() {
  const panelWidth = 1.0;
  const panelHeight = 0.5;
  const pixelsW = 256;
  const pixelsH = 128;
  const weightKg = 12;
  const powerRms = 250;
  const powerPeak = 800;

  const screenW = parseFloat(document.getElementById("screenW").value);
  const screenH = parseFloat(document.getElementById("screenH").value);
  const voltage = parseFloat(document.getElementById("voltage").value);
  const circuitA = parseFloat(document.getElementById("circuitA").value);

  const panelsW = Math.ceil(screenW / panelWidth);
  const panelsH = Math.ceil(screenH / panelHeight);
  const totalPanels = panelsW * panelsH;

  const canvasW = panelsW * pixelsW;
  const canvasH = panelsH * pixelsH;
  const totalPixels = canvasW * canvasH;

  const totalWeight = totalPanels * weightKg;
  const totalRms = totalPanels * powerRms;
  const totalPeak = totalPanels * powerPeak;

  const rmsA = totalRms / voltage;
  const peakA = totalPeak / voltage;

  const circuitsRms = ceilDiv(rmsA, circuitA);
  const circuitsPeak = ceilDiv(peakA, circuitA);

  document.getElementById("results").textContent =
    "Panels: " + panelsW + " x " + panelsH + " (" + totalPanels + ")\n" +
    "Resolution: " + canvasW + " x " + canvasH + " (" + totalPixels.toLocaleString() + " px)\n" +
    "Weight: " + totalWeight + " kg\n\n" +
    "Power RMS: " + totalRms.toLocaleString() + " W\n" +
    "Power Peak: " + totalPeak.toLocaleString() + " W\n\n" +
    "RMS Current: " + rmsA.toFixed(1) + " A\n" +
    "Peak Current: " + peakA.toFixed(1) + " A\n" +
    "Circuits (RMS): " + circuitsRms + "\n" +
    "Circuits (Peak): " + circuitsPeak;
}

recalc();
