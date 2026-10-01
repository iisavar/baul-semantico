/*
 * EMSEO — registro de cambios (bitácora) y envío en tiempo real a Google Sheets.
 * Lo usan 3_Digital_para_marcar.html y 4_Digital_para_escribir.html.
 *
 * Cada acción queda en estado.bitacora (nunca se borra) con: número de orden, hora, acción,
 * concepto, pregunta, valor ANTES y DESPUÉS. Los eventos pendientes se mandan al Apps Script
 * junto con una «foto» del estado actual; el Apps Script actualiza la fila del estudiante y
 * agrega los eventos a la pestaña «Registro». Sin internet, todo queda en la compu y se reenvía
 * solo cuando vuelve la conexión.
 */
function crearSync({ url, estado, guardar, foto, indicador }) {
  let temporizador = null, enviando = false;

  function asegurar() {
    const e = estado();
    if (!e.bitacora) e.bitacora = [];
    if (!e.seq) e.seq = 0;
    if (!e.sincronizadoHasta) e.sincronizadoHasta = 0;
    return e;
  }

  function pendientes() {
    const e = asegurar();
    return e.bitacora.filter(x => x.seq > e.sincronizadoHasta);
  }

  function pintar(texto, tipo) {
    const el = indicador && document.getElementById(indicador);
    if (!el) return;
    el.textContent = texto;
    el.dataset.tipo = tipo;
  }

  function estadoIndicador() {
    const p = pendientes().length + leerCola().reduce((t, x) => t + x.eventos.length, 0);
    if (!url) return pintar("● Guardado en esta computadora", "local");
    if (!navigator.onLine) return pintar(`○ Sin internet | ${p} ${p === 1 ? "cambio" : "cambios"} por enviar`, "pendiente");
    if (p) return pintar("○ Guardando en línea…", "pendiente");
    pintar("● Guardado en línea", "ok");
  }

  /** Registra una acción. info: { n, concepto, pregunta, antes, despues, detalle } */
  function registrar(accion, info = {}) {
    const e = asegurar();
    e.seq += 1;
    const limpio = v => (v === null || v === undefined) ? "" : String(v);
    e.bitacora.push({
      seq: e.seq, t: new Date().toISOString(), accion,
      n: info.n ?? "", concepto: info.concepto ?? "", pregunta: info.pregunta ?? "",
      antes: limpio(info.antes), despues: limpio(info.despues), detalle: info.detalle ?? "",
    });
    guardar();
    programar();
  }

  function programar(ms = 1500) {
    estadoIndicador();
    if (!url) return;
    clearTimeout(temporizador);
    temporizador = setTimeout(enviar, ms);
  }

  async function enviar() {
    if (!url || enviando) return false;
    if (leerCola().length) {  // primero lo que quedó en cola: el orden importa para no descartar eventos
      await vaciarCola();
      if (leerCola().length) { estadoIndicador(); clearTimeout(temporizador); temporizador = setTimeout(enviar, 15000); return false; }
    }
    const lote = pendientes();
    if (!lote.length) { estadoIndicador(); return true; }
    enviando = true;
    try {
      const cuerpo = { ...foto(), tipo: "sync", eventos: lote };
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw new Error("sin confirmación");
      const e = asegurar();
      e.sincronizadoHasta = Math.max(e.sincronizadoHasta, Number(j.hasta) || lote[lote.length - 1].seq);
      guardar();
      enviando = false;
      if (pendientes().length) return enviar();  // llegaron más mientras se enviaba
      estadoIndicador();
      return true;
    } catch (err) {
      enviando = false;
      estadoIndicador();
      clearTimeout(temporizador);
      temporizador = setTimeout(enviar, 15000);  // reintenta cada 15 s
      return false;
    }
  }

  // Cola de envíos de estudiantes anteriores: si se pasa al siguiente estudiante sin internet,
  // lo que faltaba enviar queda guardado aquí y se manda solo cuando vuelve la conexión.
  const CLAVE_COLA = "emseo-cola-envios";
  const leerCola = () => { try { return JSON.parse(localStorage.getItem(CLAVE_COLA) || "[]"); } catch (e) { return []; } };
  const escribirCola = c => { try { localStorage.setItem(CLAVE_COLA, JSON.stringify(c)); } catch (e) { /* sin almacenamiento */ } };
  function encolar() {  // guarda lo pendiente del estudiante actual antes de cambiar de estudiante
    const lote = pendientes();
    if (!url || !lote.length) return;
    const cola = leerCola();
    cola.push({ ...foto(), tipo: "sync", eventos: lote });
    escribirCola(cola);
    const e = asegurar();
    e.sincronizadoHasta = lote[lote.length - 1].seq;  // ya quedó a cargo de la cola
    guardar();
    setTimeout(vaciarCola, 300);
  }
  let vaciando = false;
  async function vaciarCola() {
    if (!url || vaciando || !navigator.onLine) return;
    vaciando = true;
    try {
      let cola = leerCola();
      while (cola.length) {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(cola[0]) });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || !j.ok) break;
        cola = leerCola().slice(1);  // el Apps Script ignora eventos repetidos (por id y número de orden)
        escribirCola(cola);
      }
    } catch (err) { /* sin internet: se reintenta luego */ }
    vaciando = false;
    if (leerCola().length) setTimeout(vaciarCola, 30000);
  }

  window.addEventListener("online", () => { programar(200); vaciarCola(); });
  window.addEventListener("offline", estadoIndicador);
  setTimeout(estadoIndicador, 0);
  setTimeout(vaciarCola, 2000);

  return {
    registrar,
    encolar,
    enviar,                       // fuerza el envío; devuelve true si todo quedó confirmado
    pendientes: () => pendientes().length,
    refrescar: estadoIndicador,
  };
}
