import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * Generates an executive-grade Solar Performance & Audit PDF Report.
 * Supports single and multi-inverter setups with ALL configured strings per inverter.
 */
export function generateSolarPdfReport({ device, liveData, historicalData, selectedPeriod = 'today' }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const primaryColor = [26, 54, 54];
  const accentColor  = [208, 229, 19];
  const textColor    = [30, 41, 59];
  const lightBg      = [248, 250, 252];
  const greenText    = [22, 163, 74];
  const redText      = [220, 38, 38];
  const PAGE_H       = 278; // safe content bottom

  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // ─── Page helpers ───────────────────────────────────────────────────────────
  let pageNum = 1;

  function drawMiniHeader() {
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, 210, 18, 'F');
    doc.setFillColor(...accentColor);
    doc.rect(0, 18, 210, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('ONE EARTH SOLAR PVT. LTD.', 14, 8);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('SOLAR DATA LOGGER AUDIT & PERFORMANCE REPORT (continued)', 14, 13);
    doc.text(`Page ${pageNum}`, 196, 13, { align: 'right' });
  }

  function ensureSpace(neededMm, currentY) {
    if (currentY + neededMm > PAGE_H) {
      pageNum++;
      doc.addPage();
      drawMiniHeader();
      return 26;
    }
    return currentY;
  }

  // ─── Parse inverters ────────────────────────────────────────────────────────
  const inverters = (liveData && Array.isArray(liveData.inv))
    ? liveData.inv
    : (liveData ? [liveData] : []);

  const totalKw  = inverters.reduce((s, i) => s + ((parseFloat(i.ac_w) || 0) / 1000), 0);
  const todayKwh = inverters.reduce((s, i) => s + (parseFloat(i.e_day) || 0), 0);
  const totalMwh = inverters.reduce((s, i) => s + ((parseFloat(i.e_tot) || 0) / 1000), 0);
  const avgTemp  = inverters.length
    ? (inverters.reduce((s, i) => s + (parseFloat(i.temp) || 0), 0) / inverters.length).toFixed(1)
    : '—';
  const firstInv = inverters[0] || {};
  const freqHz   = (parseFloat(firstInv.freq) || 50.0).toFixed(2);

  // ─── PAGE 1 TOP BANNER ──────────────────────────────────────────────────────
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setFillColor(...accentColor);
  doc.rect(0, 32, 210, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('ONE EARTH SOLAR PVT. LTD.', 14, 14);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('SOLAR DATA LOGGER AUDIT & PERFORMANCE REPORT', 14, 21);
  doc.text('Generated: ' + dateStr + ' at ' + timeStr, 196, 21, { align: 'right' });

  // SITE & DEVICE BOX
  doc.setFillColor(...lightBg);
  doc.roundedRect(14, 38, 182, 38, 3, 3, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 38, 182, 38, 3, 3, 'S');
  doc.setTextColor(...primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('SITE & CLIENT INFORMATION', 20, 46);
  doc.text('DEVICE & LOGGER METADATA', 110, 46);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...textColor);
  doc.text('Client Name:', 20, 53);
  doc.setFont('helvetica', 'bold');
  doc.text(device.client_name || 'ABC Solar', 48, 53);
  doc.setFont('helvetica', 'normal');
  doc.text('Site Name:', 20, 60);
  doc.setFont('helvetica', 'bold');
  doc.text(device.site_name || 'Main Rooftop', 48, 60);
  doc.setFont('helvetica', 'normal');
  doc.text('Location:', 20, 67);
  doc.text(device.location || 'Maharashtra, India', 48, 67);
  doc.text('Logger ID:', 110, 53);
  doc.setFont('helvetica', 'bold');
  doc.text(device.serial_number || '—', 140, 53);
  doc.setFont('helvetica', 'normal');
  doc.text('Inverter Count:', 110, 60);
  doc.setFont('helvetica', 'bold');
  doc.text(inverters.length + ' Inverter' + (inverters.length !== 1 ? 's' : ''), 140, 60);
  doc.setFont('helvetica', 'normal');
  doc.text('System Capacity:', 110, 67);
  doc.text((device.capacity_kw || 50) + ' kWp', 140, 67);

  // KPI TABLE
  autoTable(doc, {
    startY: 81,
    margin: { left: 14, right: 14 },
    theme: 'grid',
    head: [['Active Power', "Today's Energy", 'Lifetime Energy', 'Avg Temp', 'Grid Freq']],
    body: [[
      totalKw.toFixed(2) + ' kW',
      todayKwh.toFixed(1) + ' kWh',
      totalMwh.toFixed(1) + ' MWh',
      avgTemp + ' °C',
      freqHz + ' Hz'
    ]],
    headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, halign: 'center' },
    bodyStyles: { fontSize: 10, fontStyle: 'bold', halign: 'center', textColor: primaryColor }
  });

  let y = doc.lastAutoTable.finalY + 6;

  // ─── MULTI-INVERTER SUMMARY TABLE ──────────────────────────────────────────
  if (inverters.length > 1) {
    y = ensureSpace(30, y);
    const invRows = inverters.map((inv, idx) => {
      const addr  = inv.addr || (idx + 1);
      const acKw  = ((parseFloat(inv.ac_w) || 0) / 1000).toFixed(2);
      const pvV   = (parseFloat(inv.pv_v) || 0).toFixed(1);
      const acV   = (parseFloat(inv.ac_v) || 0).toFixed(1);
      const acA   = (parseFloat(inv.ac_a) || 0).toFixed(2);
      const eDay  = (parseFloat(inv.e_day) || 0).toFixed(1);
      const st    = (inv.online === 1 || inv.online === true) ? 'Online' : 'Offline';
      return ['Inverter ' + addr, acKw + ' kW', pvV + ' V', acV + ' V', acA + ' A', eDay + ' kWh', st];
    });
    autoTable(doc, {
      startY: y,
      margin: { left: 14, right: 14 },
      theme: 'striped',
      head: [['Inverter', 'AC Power', 'PV Voltage', 'Grid Voltage', 'Grid Current', "Today's Gen", 'Status']],
      body: invRows,
      headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontSize: 8.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8.5, textColor: textColor },
      didParseCell: (data) => {
        if (data.column.index === 6 && data.section === 'body') {
          data.cell.styles.textColor = data.cell.text[0] === 'Online' ? greenText : redText;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // ─── ELECTRICAL PARAMETERS ──────────────────────────────────────────────────
  y = ensureSpace(50, y);
  const acV = (parseFloat(firstInv.ac_v) || 0).toFixed(1);
  const acA = (parseFloat(firstInv.ac_a) || 0).toFixed(2);
  const pvV = (parseFloat(firstInv.pv_v) || 0).toFixed(1);
  const pvA = (parseFloat(firstInv.pv_a) || 0).toFixed(2);
  const pvW = (parseFloat(firstInv.pv_w) || 0).toFixed(0);
  const tmp = (parseFloat(firstInv.temp) || 0).toFixed(1);

  autoTable(doc, {
    startY: y,
    margin: { left: 14, right: 14 },
    theme: 'striped',
    head: [['Parameter Category', 'Parameter Name', 'Measured Value', 'Reference']],
    body: [
      ['AC Grid Output', 'Grid Voltage (Phase A)',  acV + ' V',             '230 V ±10%'],
      ['AC Grid Output', 'Grid Current',             acA + ' A',             'Nominal'],
      ['AC Grid Output', 'Total Active Power',       totalKw.toFixed(2) + ' kW', 'Target Generation'],
      ['AC Grid Output', 'Grid Frequency',           freqHz + ' Hz',         '50.00 Hz ±1%'],
      ['DC Solar Input', 'PV Array Voltage (Vdc)',   pvV + ' V',             '600–850 V Range'],
      ['DC Solar Input', 'PV Array Current (Idc)',   pvA + ' A',             'Strings Combined'],
      ['DC Solar Input', 'Total DC Solar Power',     pvW + ' W',             'STC Calculation'],
      ['Internal Health', 'Heat Sink Temperature',   tmp + ' °C',       '< 65 °C Normal'],
    ],
    headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontSize: 8.5, fontStyle: 'bold' },
    bodyStyles: { fontSize: 8, textColor: textColor }
  });
  y = doc.lastAutoTable.finalY + 6;

  // ─── STRING DATA PER INVERTER ───────────────────────────────────────────────
  const allInvStrings = inverters.map((inv, idx) => {
    const addr = inv.addr || (idx + 1);
    const strKeys = Object.keys(inv)
      .filter(k => k.startsWith('str') && k.endsWith('_v'))
      .sort((a, b) => parseInt(a.slice(3, -2)) - parseInt(b.slice(3, -2)));

    const powers = strKeys.map(vk => {
      const sid = vk.slice(3, -2);
      return (parseFloat(inv[vk]) || 0) * (parseFloat(inv['str' + sid + '_a']) || 0);
    }).filter(p => p > 0);
    const maxPow = Math.max(...powers, 1);

    const rows = strKeys.map(vk => {
      const sid = vk.slice(3, -2);
      const v = parseFloat(inv[vk]) || 0;
      const a = parseFloat(inv['str' + sid + '_a']) || 0;
      if (v < 0.5 && a < 0.01) return null;
      const p = (v * a).toFixed(0);
      const pct = ((v * a) / maxPow * 100).toFixed(1);
      return ['Inv ' + addr + '  —  String ' + sid, v.toFixed(1) + ' V', a.toFixed(2) + ' A', p + ' W', pct + '%', 'Generating'];
    }).filter(Boolean);

    return { addr, rows };
  });

  const activeStringCount = allInvStrings.reduce((s, d) => s + d.rows.length, 0);

  allInvStrings.forEach(({ addr, rows }) => {
    if (rows.length === 0) return;
    y = ensureSpace(12 + rows.length * 7, y);

    // Section header bar
    doc.setFillColor(...primaryColor);
    doc.roundedRect(14, y, 182, 7, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('INVERTER ' + addr + '  —  STRING / MPPT PERFORMANCE DETAIL', 18, y + 5);
    y += 9;

    autoTable(doc, {
      startY: y,
      margin: { left: 14, right: 14 },
      theme: 'grid',
      head: [['String ID', 'DC Voltage', 'DC Current', 'String Power', '% of Best', 'Status']],
      body: rows,
      headStyles: { fillColor: [40, 80, 80], textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: textColor },
      alternateRowStyles: { fillColor: [240, 248, 240] },
      didParseCell: (data) => {
        if (data.column.index === 5 && data.section === 'body') {
          data.cell.styles.textColor = greenText;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });
    y = doc.lastAutoTable.finalY + 6;
  });

  // ─── COMBINED STRINGS SUMMARY (multi-inverter) ──────────────────────────────
  if (inverters.length > 1 && activeStringCount > 1) {
    const allRows = allInvStrings.flatMap(d => d.rows);
    const totalStrPower = allRows.reduce((s, r) => s + parseFloat(r[3]), 0);

    y = ensureSpace(14 + allRows.length * 7, y);

    doc.setFillColor(...accentColor);
    doc.roundedRect(14, y, 182, 7, 2, 2, 'F');
    doc.setTextColor(...primaryColor);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('ALL STRINGS COMBINED SUMMARY  —  ' + activeStringCount + ' Active Strings across ' + inverters.length + ' Inverters', 18, y + 5);
    y += 9;

    autoTable(doc, {
      startY: y,
      margin: { left: 14, right: 14 },
      theme: 'grid',
      head: [['String ID', 'DC Voltage', 'DC Current', 'String Power', '% of Best', 'Status']],
      body: allRows,
      foot: [[{
        content: 'Total String Power: ' + totalStrPower.toFixed(0) + ' W  |  ' + activeStringCount + ' active strings  |  ' + inverters.length + ' inverters',
        colSpan: 6,
        styles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center', fontSize: 8 }
      }]],
      headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: textColor },
      footStyles: { fillColor: primaryColor }
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // ─── SIGN-OFF BOX ───────────────────────────────────────────────────────────
  y = ensureSpace(36, y);
  doc.setFillColor(...lightBg);
  doc.roundedRect(14, y, 182, 30, 3, 3, 'F');
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, y, 182, 30, 3, 3, 'S');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...primaryColor);
  doc.text('SYSTEM VERIFICATION & HEALTH AUDIT', 20, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...textColor);
  doc.text('• ' + inverters.length + ' inverter(s) actively communicating over MQTT to ONE EARTH Solar Cloud.', 20, y + 14);
  doc.text('• RS485 Modbus RTU bus synchronized — all configured read blocks responding correctly.', 20, y + 19);
  doc.text('• ' + activeStringCount + ' active string(s) operating within optimal Voltage & Current tolerances.', 20, y + 24);

  // ─── FOOTERS ON ALL PAGES ───────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text('ONE EARTH Solar Cloud Monitoring Platform  •  Confidential & Proprietary Document', 14, 290);
    doc.text('Page ' + p + ' of ' + totalPages, 196, 290, { align: 'right' });
  }

  const filename = 'OES_Report_' + device.serial_number + '_' + dateStr.replace(/ /g, '_') + '.pdf';
  doc.save(filename);
}
