/*
 * Baúl Semántico — descarga de resultados en Excel (.xlsx) sin librerías ni internet.
 * Arma un libro con una hoja: texto, números y negritas. Lo usan las dos apps.
 */
(function () {
  const tabla = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; tabla[n] = c >>> 0; }
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = tabla[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const utf8 = new TextEncoder();

  function zip(archivos) {  // ZIP sin compresión (es lo que pide el formato .xlsx por dentro)
    const partes = [], central = [];
    let offset = 0;
    archivos.forEach(f => {
      const nombre = utf8.encode(f.nombre), datos = utf8.encode(f.texto), crc = crc32(datos);
      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true); loc.setUint16(4, 20, true); loc.setUint16(6, 0x0800, true);
      loc.setUint16(12, 0x21, true); loc.setUint32(14, crc, true); loc.setUint32(18, datos.length, true);
      loc.setUint32(22, datos.length, true); loc.setUint16(26, nombre.length, true);
      partes.push(new Uint8Array(loc.buffer), nombre, datos);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
      cen.setUint16(14, 0x21, true); cen.setUint32(16, crc, true); cen.setUint32(20, datos.length, true);
      cen.setUint32(24, datos.length, true); cen.setUint16(28, nombre.length, true); cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nombre);
      offset += 30 + nombre.length + datos.length;
    });
    const tam = central.reduce((t, x) => t + x.length, 0);
    const fin = new DataView(new ArrayBuffer(22));
    fin.setUint32(0, 0x06054b50, true); fin.setUint16(8, archivos.length, true); fin.setUint16(10, archivos.length, true);
    fin.setUint32(12, tam, true); fin.setUint32(16, offset, true);
    return new Blob([...partes, ...central, new Uint8Array(fin.buffer)],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  const xml = t => String(t).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
  const columna = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const CAB = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const NS = "http://schemas.openxmlformats.org";

  /**
   * archivo: nombre del archivo (.xlsx) | hoja: nombre de la pestaña
   * filas: arreglos de celdas; cada celda es texto, número, vacío o { v, negrita: true }
   * anchos: ancho de cada columna (en caracteres)
   */
  window.descargarXlsx = function (archivo, hoja, filas, anchos = []) {
    const cuerpo = filas.map((f, r) => `<row r="${r + 1}">` + f.map((c, i) => {
      if (c === null || c === undefined || c === "") return "";
      const v = typeof c === "object" ? c.v : c, s = typeof c === "object" && c.negrita ? ' s="1"' : "";
      if (v === null || v === undefined || v === "") return "";
      const ref = columna(i) + (r + 1);
      return typeof v === "number"
        ? `<c r="${ref}"${s}><v>${v}</v></c>`
        : `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join("") + "</row>").join("");
    const cols = anchos.length ? "<cols>" + anchos.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>" : "";
    const libro = zip([
      { nombre: "[Content_Types].xml", texto: CAB + `<Types xmlns="${NS}/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { nombre: "_rels/.rels", texto: CAB + `<Relationships xmlns="${NS}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { nombre: "xl/workbook.xml", texto: CAB + `<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships">` +
        `<sheets><sheet name="${xml(hoja).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
      { nombre: "xl/_rels/workbook.xml.rels", texto: CAB + `<Relationships xmlns="${NS}/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { nombre: "xl/styles.xml", texto: CAB + `<styleSheet xmlns="${NS}/spreadsheetml/2006/main">` +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' },
      { nombre: "xl/worksheets/sheet1.xml", texto: CAB + `<worksheet xmlns="${NS}/spreadsheetml/2006/main">${cols}<sheetData>${cuerpo}</sheetData></worksheet>` },
    ]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(libro);
    a.download = archivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
})();
