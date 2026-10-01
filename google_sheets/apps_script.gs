/**
 * EMSEO — Apps Script de Google Sheets (tiempo real + trazabilidad)
 * Recibe los datos de las dos apps (3_Digital_para_marcar y 4_Digital_para_escribir) MIENTRAS se evalúa:
 * cada puntaje marcado, cada respuesta escrita, cambiada o borrada llega en segundos.
 *
 * Pestañas que crea:
 *   · Resumen              tablero que se actualiza solo (solo cuenta evaluaciones terminadas)
 *   · Resultados           una fila por estudiante que se va llenando en vivo: «En curso (15/27)» → «Terminada»
 *   · Registro             TODO lo que pasó, en orden y sin borrar nada: quién, cuándo, qué concepto,
 *                          qué había antes y qué quedó después; también lo que se dejó sin responder
 *   · Respuestas escritas  lo que quedó escrito en la versión para escribir (al terminar)
 *
 * INSTALACIÓN (una sola vez; ver Guia_conectar_Google_Sheets.pdf)
 *  1. Hoja de Google nueva → Extensiones → Apps Script → pegar TODO este código → Guardar.
 *  2. Recargar la hoja → menú «EMSEO» → «Preparar la hoja» (aceptar permisos la primera vez).
 *  3. Implementar → Nueva implementación → Aplicación web · Ejecutar como: Yo · Acceso: Cualquier usuario.
 *  4. Copiar la URL /exec y pegarla en las dos apps: const SHEET_URL = "…";
 *  Si más adelante se cambia este código: Implementar → Administrar implementaciones → ✏ → Versión nueva.
 *
 * Escala: 0-1-2 por pregunta · 27 conceptos · máximo 162 · P100 = PT / 162 × 100.
 */

// ------------------------------------------------------------------ configuración
const VERSION = "2026-09-30b";
const HOJA = { resultados: "Resultados", registro: "Registro", escritas: "Respuestas escritas", resumen: "Resumen" };
const MAX_PREGUNTA = 2;

const REGIONES = [
  { nombre: "Costa", color: "#C39A55", claro: "#F3EBDD",
    conceptos: ["Garza", "Ceibo", "Guayacán", "Paja toquilla", "Marimba", "Estero", "Bosque seco"] },
  { nombre: "Sierra", color: "#8A6A4F", claro: "#EDE6E0",
    conceptos: ["Cóndor", "Curiquingue", "Totora", "Minga", "Chagra", "Páramo", "Laguna"] },
  { nombre: "Amazonía", color: "#4E7A4A", claro: "#E3ECE2",
    conceptos: ["Jaguar", "Tapir", "Guacamayo", "Armadillo", "Guayusa", "Achiote", "Canasto", "Cascada", "Bosque tropical"] },
  { nombre: "Insular", color: "#3F7A8C", claro: "#E0ECEF",
    conceptos: ["Fragata", "Cactus", "Pesca artesanal", "Islote"] },
];
const CONCEPTOS = [];
REGIONES.forEach(r => r.conceptos.forEach(c => CONCEPTOS.push({ n: CONCEPTOS.length + 1, nombre: c, region: r.nombre })));
const MAX_TOTAL = CONCEPTOS.length * 3 * MAX_PREGUNTA;  // 162

const NIVELES = [
  { nombre: "Requiere apoyo", color: "#F4CCCC", texto: "#7A1F1F" },
  { nombre: "Promedio bajo", color: "#FCE5CD", texto: "#7A4A12" },
  { nombre: "Promedio", color: "#FFF2CC", texto: "#6B5A10" },
  { nombre: "Promedio alto", color: "#D9EAD3", texto: "#274E13" },
  { nombre: "Superior", color: "#B6D7A8", texto: "#1C4012" },
];

const TINTA = "#1A1A1A", GRIS = "#595959", GRIS_CLARO = "#F2F2F2", ENCABEZADO = "#E4E4E4", TITULO = "#2B2B2B";
const FUENTE = "Times New Roman";

// Columnas de «Resultados»
const COL_DATOS = ["Actualizado", "Modalidad", "Estado", "Estudiante", "Grado", "Paralelo", "Docente", "Fecha"];
const C = { actualizado: 1, modalidad: 2, estado: 3, estudiante: 4 };
const COL_PUNTAJE = ["PT (/162)", "Sobre 100", "Nivel"];
const COL_REGION = REGIONES.map(r => `${r.nombre} (/${r.conceptos.length * 3 * MAX_PREGUNTA})`);
const COL_PREGUNTA = ["Evocación (/54)", "Categorización (/54)", "Caracterización (/54)"];
const C_PT = COL_DATOS.length + 1, C_P100 = C_PT + 1, C_NIVEL = C_PT + 2;
const C_REGION = C_PT + COL_PUNTAJE.length, C_PREGUNTA = C_REGION + COL_REGION.length;
const PRIMERA_ITEM = C_PREGUNTA + COL_PREGUNTA.length;
const COL_ID = PRIMERA_ITEM + CONCEPTOS.length * 3;  // columna oculta con el id de la evaluación
const FILA_DATOS = 4;  // filas 1-3: título y encabezados

// Columnas de «Registro» y «Respuestas escritas»
const REG_COLS = ["Hora (hoja)", "Hora (dispositivo)", "Evaluación", "Estudiante", "Docente", "Modalidad",
                  "Acción", "N.º", "Concepto", "Pregunta", "Antes", "Después", "Detalle", "N.º de orden"];
const ESC_COLS = ["Registrado", "Estudiante", "Grado y paralelo", "Fecha", "Escribió", "N.º", "Concepto", "Región",
                  "¿Qué es?", "¿A qué grupo pertenece?", "Tres cosas que sabe", "E", "C", "Ca", "id"];

// ------------------------------------------------------------------ menú
function onOpen() {
  SpreadsheetApp.getUi().createMenu("EMSEO")
    .addItem("Preparar la hoja", "prepararHoja")
    .addSeparator()
    .addItem("Agregar un estudiante de prueba", "agregarPrueba")
    .addItem("Borrar los estudiantes de prueba", "borrarPruebas")
    .addToUi();
}

// ------------------------------------------------------------------ web app
function doGet() {
  return json_({ ok: true, servicio: "EMSEO", version: VERSION });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);  // evita que dos envíos simultáneos se pisen
  try {
    const d = JSON.parse(e.postData.contents);
    if (!d || !d.id || !Array.isArray(d.respuestas) || d.respuestas.length !== CONCEPTOS.length) {
      return json_({ ok: false, error: "Formato inesperado" });
    }
    const libro = SpreadsheetApp.getActiveSpreadsheet();
    if (!libro.getSheetByName(HOJA.resultados) || !libro.getSheetByName(HOJA.registro)) prepararHoja();
    const hasta = anotarEventos_(libro, d);
    actualizarFila_(libro, d);
    return json_({ ok: true, hasta });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ------------------------------------------------------------------ fila del estudiante (en vivo)
function actualizarFila_(libro, d) {
  const hoja = libro.getSheetByName(HOJA.resultados);
  const r = d.respuestas;
  const num = v => (v === null || v === undefined || v === "") ? "" : Number(v);
  const suma = lista => lista.reduce((t, x) => t + (Number(x) || 0), 0);
  const completos = r.filter(x => [x.a, x.b, x.c].every(v => v !== null && v !== undefined && v !== "")).length;
  const terminada = completos === CONCEPTOS.length;

  const porRegion = REGIONES.map(reg => suma(r.filter(x => x.region === reg.nombre).map(x => suma([x.a, x.b, x.c]))));
  const porPregunta = ["a", "b", "c"].map(k => suma(r.map(x => x[k])));
  const total = suma(porRegion);
  const p100 = Math.round(total / MAX_TOTAL * 100);

  const fila = [
    new Date(), etiquetaModalidad_(d.modalidad, d.escribe),
    terminada ? "Terminada" : `En curso (${completos}/${CONCEPTOS.length})`,
    d.nombre || "", d.grado || "", d.paralelo || "", d.evaluador || "", d.fecha || "",
    total, terminada ? p100 : "", terminada ? nivelDe_(p100) : "",
    ...porRegion, ...porPregunta,
  ];
  r.forEach(x => fila.push(num(x.a), num(x.b), num(x.c)));
  fila.push(d.id);

  const n = filaDe_(hoja, COL_ID, FILA_DATOS, d.id) || Math.max(hoja.getLastRow() + 1, FILA_DATOS);
  hoja.getRange(n, 1, 1, fila.length).setValues([fila]);
  hoja.getRange(n, 1).setNumberFormat("dd/mm/yyyy hh:mm:ss");

  if (d.modalidad === "escrita" && terminada) escribirRespuestas_(libro, d);
}

function filaDe_(hoja, col, desde, id) {
  const ultima = hoja.getLastRow();
  if (ultima < desde) return 0;
  const celda = hoja.getRange(desde, col, ultima - desde + 1, 1)
    .createTextFinder(String(id)).matchEntireCell(true).findNext();
  return celda ? celda.getRow() : 0;
}

function escribirRespuestas_(libro, d) {
  const esc = libro.getSheetByName(HOJA.escritas) || prepararEscritas_(libro);
  // si se corrigió después de terminar, se reemplazan sus filas (el historial queda en «Registro»)
  const ultima = esc.getLastRow();
  if (ultima >= 3) {
    const viejas = esc.getRange(3, ESC_COLS.length, ultima - 2, 1).createTextFinder(String(d.id)).matchEntireCell(true).findAll();
    viejas.map(c => c.getRow()).sort((a, b) => b - a).forEach(f => esc.deleteRow(f));
  }
  const num = v => (v === null || v === undefined || v === "") ? "" : Number(v);
  const filas = d.respuestas.map(x => [new Date(), d.nombre || "", [d.grado, d.paralelo].filter(Boolean).join(" "), d.fecha || "",
    d.escribe === "docente" ? "Docente" : "Estudiante", x.n, x.concepto, x.region,
    x.a_cita || "", x.b_cita || "", (x.c_cita || "").split(" | ").join("\n"), num(x.a), num(x.b), num(x.c), d.id]);
  const m = Math.max(esc.getLastRow() + 1, 3);
  esc.getRange(m, 1, filas.length, filas[0].length).setValues(filas);
  esc.getRange(m, 1, filas.length, 1).setNumberFormat("dd/mm/yyyy hh:mm");
}

// ------------------------------------------------------------------ registro (trazabilidad)
function anotarEventos_(libro, d) {
  const eventos = Array.isArray(d.eventos) ? d.eventos : [];
  const props = PropertiesService.getScriptProperties();
  const clave = "seq_" + d.id;
  const ultimo = Number(props.getProperty(clave) || 0);
  const nuevos = eventos.filter(ev => Number(ev.seq) > ultimo).sort((a, b) => a.seq - b.seq);
  if (!nuevos.length) return ultimo;  // ya estaban registrados (reintento)

  const hoja = libro.getSheetByName(HOJA.registro);
  const ahora = new Date();
  const corto = String(d.id).slice(0, 8);
  const mod = etiquetaModalidad_(d.modalidad, d.escribe);
  const filas = nuevos.map(ev => [ahora, ev.t ? new Date(ev.t) : "", corto, d.nombre || "", d.evaluador || "", mod,
    ev.accion || "", ev.n || "", ev.concepto || "", ev.pregunta || "", ev.antes ?? "", ev.despues ?? "", ev.detalle || "", ev.seq]);
  const m = Math.max(hoja.getLastRow() + 1, 3);
  hoja.getRange(m, 1, filas.length, REG_COLS.length).setValues(filas);
  hoja.getRange(m, 1, filas.length, 2).setNumberFormat("dd/mm/yyyy hh:mm:ss");
  const hasta = Number(nuevos[nuevos.length - 1].seq);
  props.setProperty(clave, String(hasta));
  return hasta;
}

function etiquetaModalidad_(m, escribe) {
  if (m === "escrita") return escribe === "docente" ? "Escrita (docente)" : "Escrita (estudiante)";
  return { oral: "Oral", prueba: "Prueba" }[m] || "Oral";
}

function nivelDe_(p) {
  if (p >= 90) return "Superior";
  if (p >= 80) return "Promedio alto";
  if (p >= 70) return "Promedio";
  if (p >= 50) return "Promedio bajo";
  return "Requiere apoyo";
}

// ------------------------------------------------------------------ preparar la hoja
function prepararHoja() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = prepararResultados_(libro);
  prepararRegistro_(libro);
  prepararEscritas_(libro);
  prepararResumen_(libro);
  libro.setActiveSheet(libro.getSheetByName(HOJA.resumen));
  return hoja;
}

function titulo1_(hoja, ncol, texto) {
  hoja.getRange(1, 1, 1, ncol).merge().setValue(texto)
    .setBackground(TITULO).setFontColor("#FFFFFF").setFontSize(14).setFontWeight("bold").setHorizontalAlignment("left");
  hoja.setRowHeight(1, 34);
}

function prepararResultados_(libro) {
  let hoja = libro.getSheetByName(HOJA.resultados);
  if (!hoja) hoja = libro.insertSheet(HOJA.resultados, 0);
  const ncol = COL_ID;
  if (hoja.getMaxColumns() < ncol) hoja.insertColumnsAfter(hoja.getMaxColumns(), ncol - hoja.getMaxColumns());
  const filasDatos = hoja.getMaxRows() - FILA_DATOS + 1;

  hoja.getRange(1, 1, 3, ncol).breakApart().clearFormat();
  hoja.setHiddenGridlines(true);
  hoja.getRange(1, 1, hoja.getMaxRows(), ncol).setFontFamily(FUENTE).setFontSize(10).setVerticalAlignment("middle");
  titulo1_(hoja, ncol, "EMSEO · Resultados por estudiante (en vivo) — escala 0-1-2 · máximo 162 · P₁₀₀ = PT ÷ 162 × 100");

  // Fila 2: grupos · Fila 3: columnas
  [["Estudiante", 1, COL_DATOS.length, ENCABEZADO],
   ["Puntaje", C_PT, COL_PUNTAJE.length, "#CFCFCF"],
   ["Por región", C_REGION, COL_REGION.length, ENCABEZADO],
   ["Por pregunta", C_PREGUNTA, COL_PREGUNTA.length, "#CFCFCF"]]
    .forEach(([txt, c, n, fondo]) => hoja.getRange(2, c, 1, n).merge().setValue(txt).setBackground(fondo).setFontColor(TINTA));
  hoja.getRange(3, 1, 1, PRIMERA_ITEM - 1)
    .setValues([[...COL_DATOS, ...COL_PUNTAJE, ...COL_REGION, ...COL_PREGUNTA]]).setBackground(GRIS_CLARO);

  // Conceptos: nombre (fila 2) sobre E · C · Ca (fila 3), con el color de su región
  CONCEPTOS.forEach((c, i) => {
    const col = PRIMERA_ITEM + i * 3;
    const reg = REGIONES.find(r => r.nombre === c.region);
    hoja.getRange(2, col, 1, 3).merge().setValue(`${c.n} · ${c.nombre}`).setBackground(reg.color).setFontColor("#FFFFFF");
    hoja.getRange(3, col, 1, 3).setValues([["E", "C", "Ca"]]).setBackground(reg.claro);
  });
  hoja.getRange(3, COL_ID).setValue("id");

  hoja.getRange(2, 1, 2, ncol).setFontWeight("bold").setHorizontalAlignment("center").setWrap(true)
    .setBorder(true, true, true, true, true, true, "#BFBFBF", SpreadsheetApp.BorderStyle.SOLID);
  hoja.setRowHeight(2, 30);
  hoja.setRowHeight(3, 34);

  // Anchos
  [130, 120, 110, 190, 60, 64, 150, 82].forEach((w, i) => hoja.setColumnWidth(i + 1, w));
  hoja.setColumnWidths(C_PT, COL_PUNTAJE.length, 78);
  hoja.setColumnWidth(C_NIVEL, 110);
  hoja.setColumnWidths(C_REGION, COL_REGION.length + COL_PREGUNTA.length, 92);
  hoja.setColumnWidths(PRIMERA_ITEM, CONCEPTOS.length * 3, 34);
  hoja.hideColumns(COL_ID);

  // Datos: formato, centrado
  hoja.getRange(FILA_DATOS, 1, filasDatos, ncol)
    .setBorder(null, null, null, null, true, true, "#E0E0E0", SpreadsheetApp.BorderStyle.SOLID);
  hoja.getRange(FILA_DATOS, 1, filasDatos, 1).setNumberFormat("dd/mm/yyyy hh:mm:ss");
  hoja.getRange(FILA_DATOS, 2, filasDatos, 2).setHorizontalAlignment("center");
  hoja.getRange(FILA_DATOS, 5, filasDatos, 2).setHorizontalAlignment("center");
  hoja.getRange(FILA_DATOS, C_PT, filasDatos, ncol - C_PT + 1).setHorizontalAlignment("center");
  hoja.getRange(FILA_DATOS, C_PT, filasDatos, 2).setFontWeight("bold").setFontSize(11);

  // Formato condicional
  const reglas = [];
  const rango = (c, n = 1) => hoja.getRange(FILA_DATOS, c, filasDatos, n);
  NIVELES.forEach(nv => reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(nv.nombre).setBackground(nv.color).setFontColor(nv.texto).setBold(true)
    .setRanges([rango(C_NIVEL)]).build()));
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith("En curso")
    .setBackground("#FFF2CC").setFontColor("#7A6200").setItalic(true).setRanges([rango(C.estado)]).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Terminada")
    .setBackground("#D9EAD3").setFontColor("#274E13").setBold(true).setRanges([rango(C.estado)]).build());
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpointWithValue("#F4CCCC", SpreadsheetApp.InterpolationType.NUMBER, "0")
    .setGradientMidpointWithValue("#FFF2CC", SpreadsheetApp.InterpolationType.NUMBER, "60")
    .setGradientMaxpointWithValue("#B6D7A8", SpreadsheetApp.InterpolationType.NUMBER, "100")
    .setRanges([rango(C_P100)]).build());
  [[0, "#FBE3E3", "#9C2B2B"], [1, "#FFF6D6", "#7A6200"], [2, "#E3F1DC", "#2E6B1F"]].forEach(([v, fondo, tinta]) =>
    reglas.push(SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(v)
      .setBackground(fondo).setFontColor(tinta).setRanges([rango(PRIMERA_ITEM, CONCEPTOS.length * 3)]).build()));
  reglas.push(SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$B${FILA_DATOS}="Prueba"`).setFontColor("#9E9E9E").setItalic(true)
    .setRanges([rango(1, COL_DATOS.length)]).build());
  hoja.setConditionalFormatRules(reglas);

  hoja.setFrozenRows(3);
  hoja.setFrozenColumns(4);
  hoja.setTabColor(TITULO);
  return hoja;
}

function prepararRegistro_(libro) {
  let hoja = libro.getSheetByName(HOJA.registro);
  if (!hoja) hoja = libro.insertSheet(HOJA.registro);
  const ncol = REG_COLS.length, filas = hoja.getMaxRows() - 2;
  hoja.getRange(1, 1, 2, ncol).breakApart().clearFormat();
  hoja.setHiddenGridlines(true);
  hoja.getRange(1, 1, hoja.getMaxRows(), ncol).setFontFamily(FUENTE).setFontSize(10).setVerticalAlignment("top");
  titulo1_(hoja, ncol, "EMSEO · Registro de todo lo que pasó (no se borra: es la trazabilidad de cada evaluación)");
  hoja.getRange(2, 1, 1, ncol).setValues([REG_COLS]).setBackground(ENCABEZADO).setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle").setWrap(true);
  [130, 130, 80, 170, 140, 120, 190, 40, 120, 120, 170, 170, 220, 60].forEach((w, i) => hoja.setColumnWidth(i + 1, w));
  hoja.getRange(3, 1, filas, 2).setNumberFormat("dd/mm/yyyy hh:mm:ss");
  hoja.getRange(3, 11, filas, 3).setWrap(true);
  hoja.getRange(3, 8, filas, 1).setHorizontalAlignment("center");
  const acc = hoja.getRange(3, 7, filas, 1);
  const fila = hoja.getRange(3, 1, filas, ncol);
  const regla = (texto, fondo, tinta, rango = acc) => SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=REGEXMATCH($G3,"${texto}")`).setBackground(fondo).setFontColor(tinta).setRanges([rango]).build();
  hoja.setConditionalFormatRules([
    regla("^Borró", "#F4CCCC", "#7A1F1F"),
    regla("^Cambió", "#FCE5CD", "#7A4A12"),
    regla("^Dejó sin", "#EFEFEF", "#7F7F7F"),
    regla("^(Terminó|Envió)", "#D9EAD3", "#274E13"),
    regla("^(Inicio|Retomó)", "#E0ECEF", "#1F4F5C"),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=$F3="Prueba"`).setFontColor("#9E9E9E")
      .setRanges([fila]).build(),
  ]);
  hoja.setFrozenRows(2);
  hoja.setTabColor("#3F7A8C");
  // Aviso si alguien intenta editar a mano: el registro debe quedar intacto
  const protecciones = hoja.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  if (!protecciones.length) hoja.protect().setDescription("Registro de trazabilidad del EMSEO").setWarningOnly(true);
  return hoja;
}

function prepararEscritas_(libro) {
  let hoja = libro.getSheetByName(HOJA.escritas);
  if (!hoja) hoja = libro.insertSheet(HOJA.escritas);
  const ncol = ESC_COLS.length, filas = hoja.getMaxRows() - 2;
  if (hoja.getMaxColumns() < ncol) hoja.insertColumnsAfter(hoja.getMaxColumns(), ncol - hoja.getMaxColumns());
  hoja.getRange(1, 1, 2, ncol).breakApart().clearFormat();
  hoja.setHiddenGridlines(true);
  hoja.getRange(1, 1, hoja.getMaxRows(), ncol).setFontFamily(FUENTE).setFontSize(10).setVerticalAlignment("top");
  titulo1_(hoja, ncol, "EMSEO · Respuestas escritas (versión para escribir)");
  hoja.getRange(2, 1, 1, ncol).setValues([ESC_COLS]).setBackground(ENCABEZADO).setFontWeight("bold")
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  [120, 170, 90, 82, 80, 40, 120, 80, 150, 150, 260, 34, 34, 34, 60].forEach((w, i) => hoja.setColumnWidth(i + 1, w));
  hoja.hideColumns(ncol);
  hoja.getRange(3, 9, filas, 3).setWrap(true);
  hoja.getRange(3, 12, filas, 3).setHorizontalAlignment("center");
  hoja.getRange(3, 5, filas, 2).setHorizontalAlignment("center");
  const items = hoja.getRange(3, 12, filas, 3);
  const reglas = [[0, "#FBE3E3", "#9C2B2B"], [1, "#FFF6D6", "#7A6200"], [2, "#E3F1DC", "#2E6B1F"]].map(([v, f, t]) =>
    SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(v).setBackground(f).setFontColor(t).setRanges([items]).build());
  REGIONES.forEach(r => reglas.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(r.nombre)
    .setBackground(r.claro).setRanges([hoja.getRange(3, 8, filas, 1)]).build()));
  hoja.setConditionalFormatRules(reglas);
  hoja.setFrozenRows(2);
  hoja.setTabColor("#8A6A4F");
  return hoja;
}

// ------------------------------------------------------------------ tablero «Resumen»
function prepararResumen_(libro) {
  let hoja = libro.getSheetByName(HOJA.resumen);
  if (hoja) {
    hoja.getCharts().forEach(c => hoja.removeChart(c));
    hoja.clear();
  } else {
    hoja = libro.insertSheet(HOJA.resumen, 0);
  }
  hoja.setHiddenGridlines(true);
  const R = `'${HOJA.resultados}'!`;
  const hasta = 5000;
  const rango = c => `${R}${columnaLetra_(c)}${FILA_DATOS}:${columnaLetra_(c)}${hasta}`;
  const fP100 = rango(C_P100), fNivel = rango(C_NIVEL), fEst = rango(C.estudiante), fMod = rango(C.modalidad), fEstado = rango(C.estado);
  // Solo evaluaciones terminadas y que no sean de prueba
  const real = `${fMod},"<>Prueba",${fEstado},"Terminada"`;

  hoja.getRange("A1:H200").setFontFamily(FUENTE).setFontSize(11).setVerticalAlignment("middle");
  [24, 190, 120, 120, 24, 190, 120, 120].forEach((w, i) => hoja.setColumnWidth(i + 1, w));

  hoja.getRange("B2:H2").merge().setValue("EMSEO · Resumen de resultados")
    .setFontSize(20).setFontWeight("bold").setFontColor(TITULO);
  hoja.getRange("B3:H3").merge()
    .setValue("Se actualiza en vivo. Solo cuenta evaluaciones terminadas (no las de prueba). Niveles referenciales (sin baremo ecuatoriano todavía).")
    .setFontColor(GRIS).setFontSize(10).setWrap(true);

  // Tarjetas
  [["B5", "Terminadas", `=COUNTIFS(${fEst},"<>",${real})`, "0"],
   ["C5", "En curso ahora", `=COUNTIFS(${fEstado},"En curso*",${fMod},"<>Prueba")`, "0"],
   ["D5", "Promedio (sobre 100)", `=IFERROR(AVERAGEIFS(${fP100},${real}),"—")`, "0.0"],
   ["F5", "Más alto", `=IFERROR(MAXIFS(${fP100},${real}),"—")`, "0"],
   ["G5", "Más bajo", `=IFERROR(MINIFS(${fP100},${real}),"—")`, "0"],
   ["H5", "Acciones registradas", `=COUNTA('${HOJA.registro}'!G3:G)`, "0"]]
    .forEach(([celda, etiqueta, formula, fmt]) => {
      const c = hoja.getRange(celda);
      c.setValue(etiqueta).setFontColor(GRIS).setFontSize(9).setHorizontalAlignment("center").setBackground(GRIS_CLARO);
      c.offset(1, 0).setFormula(formula).setNumberFormat(fmt).setFontSize(22).setFontWeight("bold")
        .setHorizontalAlignment("center").setBackground(GRIS_CLARO);
      c.offset(0, 0, 2, 1).setBorder(true, true, true, true, null, null, "#D0D0D0", SpreadsheetApp.BorderStyle.SOLID);
    });
  hoja.setRowHeight(6, 44);

  // Niveles
  let f = 9;
  titulo_(hoja, `B${f}:D${f}`, "Estudiantes por nivel");
  cabecera_(hoja, `B${f + 1}:D${f + 1}`, ["Nivel", "Estudiantes", "%"]);
  NIVELES.forEach((nv, i) => {
    const fila = f + 2 + i;
    hoja.getRange(`B${fila}`).setValue(nv.nombre).setBackground(nv.color).setFontColor(nv.texto).setFontWeight("bold");
    hoja.getRange(`C${fila}`).setFormula(`=COUNTIFS(${fNivel},B${fila},${real})`).setHorizontalAlignment("center");
    hoja.getRange(`D${fila}`).setFormula(`=IFERROR(C${fila}/SUM($C$${f + 2}:$C$${f + 6}),0)`).setNumberFormat("0%")
      .setHorizontalAlignment("center");
  });
  bordes_(hoja, `B${f + 1}:D${f + 6}`);

  // Por región
  titulo_(hoja, `F${f}:H${f}`, "Promedio por región");
  cabecera_(hoja, `F${f + 1}:H${f + 1}`, ["Región", "Promedio", "de"]);
  REGIONES.forEach((r, i) => {
    const fila = f + 2 + i, max = r.conceptos.length * 3 * MAX_PREGUNTA;
    hoja.getRange(`F${fila}`).setValue(r.nombre).setBackground(r.claro).setFontWeight("bold");
    hoja.getRange(`G${fila}`).setFormula(`=IFERROR(AVERAGEIFS(${rango(C_REGION + i)},${real})/${max},0)`).setNumberFormat("0%")
      .setHorizontalAlignment("center");
    hoja.getRange(`H${fila}`).setValue(`${max} pts`).setFontColor(GRIS).setHorizontalAlignment("center");
  });
  bordes_(hoja, `F${f + 1}:H${f + 5}`);

  // Por pregunta
  f = 18;
  titulo_(hoja, `F${f}:H${f}`, "Promedio por pregunta");
  cabecera_(hoja, `F${f + 1}:H${f + 1}`, ["Pregunta", "Promedio", "de"]);
  ["Evocación", "Categorización", "Caracterización"].forEach((p, i) => {
    const fila = f + 2 + i;
    hoja.getRange(`F${fila}`).setValue(p).setFontWeight("bold");
    hoja.getRange(`G${fila}`).setFormula(`=IFERROR(AVERAGEIFS(${rango(C_PREGUNTA + i)},${real})/54,0)`).setNumberFormat("0%")
      .setHorizontalAlignment("center");
    hoja.getRange(`H${fila}`).setValue("54 pts").setFontColor(GRIS).setHorizontalAlignment("center");
  });
  bordes_(hoja, `F${f + 1}:H${f + 4}`);

  // Dificultad de cada concepto
  f = 25;
  titulo_(hoja, `B${f}:H${f}`, "Dificultad de cada concepto (p = puntaje promedio ÷ puntaje máximo)");
  hoja.getRange(`B${f + 1}:H${f + 1}`).merge()
    .setValue("p cercano a 1 = concepto fácil · p cercano a 0 = concepto difícil. Útil para el análisis de ítems del piloto.")
    .setFontColor(GRIS).setFontSize(9);
  cabecera_(hoja, `B${f + 2}:D${f + 2}`, ["Concepto", "Región", "p"]);
  cabecera_(hoja, `F${f + 2}:H${f + 2}`, ["Concepto", "Región", "p"]);
  const mitad = Math.ceil(CONCEPTOS.length / 2);
  CONCEPTOS.forEach((c, i) => {
    const bloque = i < mitad ? ["B", "C", "D"] : ["F", "G", "H"];
    const fila = f + 3 + (i < mitad ? i : i - mitad);
    const c0 = PRIMERA_ITEM + i * 3;
    const sumas = [0, 1, 2].map(k => `SUMIFS(${rango(c0 + k)},${fEst},"<>",${real})`).join("+");
    const reg = REGIONES.find(r => r.nombre === c.region);
    hoja.getRange(`${bloque[0]}${fila}`).setValue(`${c.n} · ${c.nombre}`);
    hoja.getRange(`${bloque[1]}${fila}`).setValue(c.region).setBackground(reg.claro).setHorizontalAlignment("center");
    hoja.getRange(`${bloque[2]}${fila}`)
      .setFormula(`=IFERROR((${sumas})/(3*${MAX_PREGUNTA}*COUNTIFS(${fEst},"<>",${real})),"—")`)
      .setNumberFormat("0.00").setHorizontalAlignment("center");
  });
  bordes_(hoja, `B${f + 2}:D${f + 2 + mitad}`);
  bordes_(hoja, `F${f + 2}:H${f + 2 + CONCEPTOS.length - mitad}`);
  hoja.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
    .setGradientMinpointWithValue("#F4CCCC", SpreadsheetApp.InterpolationType.NUMBER, "0")
    .setGradientMidpointWithValue("#FFF2CC", SpreadsheetApp.InterpolationType.NUMBER, "0.5")
    .setGradientMaxpointWithValue("#B6D7A8", SpreadsheetApp.InterpolationType.NUMBER, "1")
    .setRanges([hoja.getRange(`D${f + 3}:D${f + 2 + mitad}`), hoja.getRange(`H${f + 3}:H${f + 2 + CONCEPTOS.length - mitad}`)])
    .build()]);

  // Gráficos
  const estilo = b => b.setOption("legend", { position: "none" })
    .setOption("titleTextStyle", { fontName: FUENTE, fontSize: 13, bold: true, color: TITULO })
    .setOption("fontName", FUENTE).setOption("backgroundColor", "#FFFFFF");
  hoja.insertChart(estilo(hoja.newChart().setChartType(Charts.ChartType.COLUMN).addRange(hoja.getRange("B11:C15"))
    .setOption("title", "Estudiantes por nivel").setOption("colors", ["#6D8F5E"]).setOption("vAxis", { minValue: 0, format: "0" }))
    .setPosition(9, 10, 0, 0).setOption("width", 480).setOption("height", 260).build());
  hoja.insertChart(estilo(hoja.newChart().setChartType(Charts.ChartType.BAR).addRange(hoja.getRange("F11:G14"))
    .setOption("title", "Promedio por región").setOption("colors", ["#8A6A4F"])
    .setOption("hAxis", { minValue: 0, maxValue: 1, format: "0%" }))
    .setPosition(24, 10, 0, 0).setOption("width", 480).setOption("height", 240).build());

  hoja.setTabColor("#4E7A4A");
  return hoja;
}

function titulo_(hoja, a1, texto) {
  hoja.getRange(a1).merge().setValue(texto).setFontSize(13).setFontWeight("bold").setFontColor(TITULO);
}
function cabecera_(hoja, a1, textos) {
  hoja.getRange(a1).setValues([textos]).setBackground(ENCABEZADO).setFontWeight("bold").setHorizontalAlignment("center");
}
function bordes_(hoja, a1) {
  hoja.getRange(a1).setBorder(true, true, true, true, true, true, "#D0D0D0", SpreadsheetApp.BorderStyle.SOLID);
}
function columnaLetra_(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ------------------------------------------------------------------ pruebas desde el menú
function agregarPrueba() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  if (!libro.getSheetByName(HOJA.resultados) || !libro.getSheetByName(HOJA.registro)) prepararHoja();
  const azar = () => Math.floor(Math.random() * 3);
  const d = {
    id: "prueba-" + Date.now(), modalidad: "prueba", nombre: "Estudiante de prueba", grado: "5.º", paralelo: "A",
    evaluador: "Docente de prueba", fecha: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd"),
    respuestas: CONCEPTOS.map(c => ({ n: c.n, concepto: c.nombre, region: c.region, a: azar(), b: azar(), c: azar() })),
    eventos: [{ seq: 1, t: new Date().toISOString(), accion: "Inicio de la evaluación", detalle: "Generado desde el menú EMSEO" },
              { seq: 2, t: new Date().toISOString(), accion: "Terminó la evaluación", detalle: "Prueba" }],
  };
  anotarEventos_(libro, d);
  actualizarFila_(libro, d);
  libro.toast("Se agregó un estudiante de prueba (en gris, no cuenta en el Resumen).", "EMSEO");
}

function borrarPruebas() {
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(HOJA.resultados);
  if (!hoja || hoja.getLastRow() < FILA_DATOS) return;
  const mod = hoja.getRange(FILA_DATOS, C.modalidad, hoja.getLastRow() - FILA_DATOS + 1, 1).getValues();
  for (let i = mod.length - 1; i >= 0; i--) if (mod[i][0] === "Prueba") hoja.deleteRow(FILA_DATOS + i);
  // Las acciones de prueba quedan en «Registro» (en gris): el registro nunca se borra.
  SpreadsheetApp.getActiveSpreadsheet().toast("Estudiantes de prueba borrados de Resultados.", "EMSEO");
}
