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
    const p = pendientes().length;
    if (!url) return pintar("● Guardado solo en esta compu (Google Sheets sin configurar)", "local");
    if (!navigator.onLine) return pintar(`○ Sin internet · ${p} cambio(s) por enviar`, "pendiente");
    if (p) return pintar(`○ Enviando ${p} cambio(s)…`, "pendiente");
    pintar("● Sincronizado con Google Sheets", "ok");
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

  window.addEventListener("online", () => programar(200));
  window.addEventListener("offline", estadoIndicador);
  setTimeout(estadoIndicador, 0);

  return {
    registrar,
    enviar,                       // fuerza el envío; devuelve true si todo quedó confirmado
    pendientes: () => pendientes().length,
    refrescar: estadoIndicador,
    csv() {                       // bitácora completa en CSV (para respaldo o anexos)
      const e = asegurar();
      const enc = ["n_orden", "fecha_hora", "accion", "n", "concepto", "pregunta", "antes", "despues", "detalle"];
      const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const filas = e.bitacora.map(x => [x.seq, x.t, x.accion, x.n, x.concepto, x.pregunta, x.antes, x.despues, x.detalle].map(q).join(";"));
      return "﻿" + [enc.join(";"), ...filas].join("\r\n");
    },
  };
}
