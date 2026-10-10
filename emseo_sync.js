/*
 * EMSEO — registro de cambios (bitácora) y envío en tiempo real a Google Sheets.
 * Lo usan 3_Digital_para_marcar.html y 4_Digital_para_escribir.html.
 *
 * Cada acción queda en estado.bitacora (nunca se borra) con: número de orden, hora, acción,
 * concepto, pregunta, valor ANTES y DESPUÉS. Los eventos pendientes se mandan al Apps Script
 * junto con una «foto» del estado actual; el Apps Script actualiza la fila del estudiante y
 * agrega los eventos a la pestaña «Registro». Sin internet, todo queda en la compu y se reenvía
 * solo cuando vuelve la conexión.
 *
 * Rechazos (2026-10-10, BS-02): si Google responde que el envío no es válido (respuesta con
 * ok:false, no un corte de red), ese envío no se reintenta para siempre: se aparta en
 * «emseo-envios-rechazados», el indicador lo muestra y la cola sigue con los demás. Al tocar el
 * indicador se puede reintentar (por ejemplo, después de publicar la versión nueva del Apps Script).
 *
 * Datos en el navegador (2026-10-10, BS-05): ver limpiarArchivo(). Una evaluación cerrada se borra
 * del archivo local 30 días después de cerrarse si Google ya confirmó todos sus envíos.
 */
const EMSEO_DIAS_ARCHIVO = 30;      // días que se guarda una evaluación ya confirmada por Google
const EMSEO_MAX_ARCHIVO = 100;      // tope de evaluaciones ya confirmadas en el archivo local

function crearSync({ url, estado, guardar, foto, indicador }) {
  let temporizador = null, enviando = false, fallos = 0, ultimoRechazo = "";

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

  function pintar(texto, tipo, ayuda = "") {
    const el = indicador && document.getElementById(indicador);
    if (!el) return;
    el.textContent = texto;
    el.dataset.tipo = tipo;
    el.title = ayuda;
    el.style.cursor = tipo === "error" ? "pointer" : "";
  }

  function estadoIndicador() {
    const p = pendientes().length + leerCola().reduce((t, x) => t + x.eventos.length, 0);
    const rech = leerRechazados().length;
    if (!url) return pintar("● Guardado en esta computadora", "local");
    if (rech) return pintar(`⚠ Google Sheets rechazó ${rech} ${rech === 1 ? "evaluación" : "evaluaciones"} | quedan en esta computadora y en el PDF`,
      "error", "Toque aquí para volver a intentar el envío. Si se repite, avise al responsable del proyecto.");
    if (!navigator.onLine) return pintar(`○ Sin internet | ${p} ${p === 1 ? "cambio" : "cambios"} por enviar`, "pendiente");
    if (p && fallos >= 2) return pintar(`○ No se pudo enviar | ${p} ${p === 1 ? "cambio" : "cambios"} por enviar, se reintenta solo`, "pendiente");
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

  /** Respuesta de Google que dice que el envío no es válido. No se arregla reintentando. */
  function esRechazo(r, j) {
    if (!r.ok || !j || j.ok !== false) return false;
    return j.rechazado === true || /formato inesperado/i.test(String(j.error || ""));
  }

  async function mandar(cuerpo) {  // "ok", "rechazado" (con j.error) o "fallo" (red, servidor ocupado, sin JSON)
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.ok) return { res: "ok", j };
    if (esRechazo(r, j)) return { res: "rechazado", j };
    return { res: "fallo", j };
  }

  async function enviar() {
    if (!url || enviando) return false;
    if (leerCola().length) {  // primero lo que quedó en cola: el orden importa para no descartar eventos
      await vaciarCola();
      if (leerCola().length) { estadoIndicador(); clearTimeout(temporizador); temporizador = setTimeout(enviar, 15000); return false; }
    }
    const evaluacion = asegurar();
    const lote = evaluacion.bitacora.filter(x => x.seq > evaluacion.sincronizadoHasta);
    if (!lote.length) { estadoIndicador(); return !rechazadoActual(); }
    enviando = true;
    try {
      const cuerpo = { ...foto(), tipo: "sync", eventos: lote };
      const { res, j } = await mandar(cuerpo);
      if (res === "rechazado") {
        // No se reintenta solo: se aparta (con todo lo necesario para reenviarlo) y se sigue.
        apartar(cuerpo, j.error);
        if (asegurar().id === evaluacion.id) {
          const e = asegurar();
          e.sincronizadoHasta = Math.max(e.sincronizadoHasta, lote[lote.length - 1].seq);
          guardar();
        }
        enviando = false; fallos = 0;
        estadoIndicador();
        return false;
      }
      if (res !== "ok") throw new Error("sin confirmación");
      fallos = 0;
      // La respuesta puede llegar después de pasar al siguiente estudiante.
      // Nunca aplicar su número de orden a otra evaluación.
      if (asegurar().id === evaluacion.id) {
        const e = asegurar();
        e.sincronizadoHasta = Math.max(e.sincronizadoHasta, Number(j.hasta) || lote[lote.length - 1].seq);
        guardar();
      }
      enviando = false;
      if (pendientes().length) return enviar();  // llegaron más mientras se enviaba
      estadoIndicador();
      return !rechazadoActual();
    } catch (err) {
      enviando = false; fallos += 1;
      estadoIndicador();
      clearTimeout(temporizador);
      temporizador = setTimeout(enviar, 15000);  // reintenta cada 15 s (fallo de red o de Google, no rechazo)
      return false;
    }
  }

  // Cola de envíos de estudiantes anteriores: si se pasa al siguiente estudiante sin internet,
  // lo que faltaba enviar queda guardado aquí y se manda solo cuando vuelve la conexión.
  const CLAVE_COLA = "emseo-cola-envios";
  const CLAVE_RECHAZADOS = "emseo-envios-rechazados";
  const leerLista = clave => { try { return JSON.parse(localStorage.getItem(clave) || "[]"); } catch (e) { return []; } };
  const escribirLista = (clave, l) => {
    try { localStorage.setItem(clave, JSON.stringify(l)); return true; }
    catch (e) { return false; }
  };
  const leerCola = () => leerLista(CLAVE_COLA);
  const escribirCola = c => escribirLista(CLAVE_COLA, c);
  const leerRechazados = () => leerLista(CLAVE_RECHAZADOS);

  /** Aparta un envío rechazado. Si ya hay uno de la misma evaluación, se juntan sus eventos. */
  function apartar(cuerpo, error) {
    const l = leerRechazados();
    const previo = l.find(x => x.id === cuerpo.id);
    const ahora = new Date().toISOString();
    ultimoRechazo = String(error || "rechazado");
    if (previo) {
      const vistos = new Set(previo.eventos.map(ev => ev.seq));
      Object.assign(previo, cuerpo, { eventos: [...previo.eventos, ...cuerpo.eventos.filter(ev => !vistos.has(ev.seq))]
        .sort((a, b) => a.seq - b.seq), rechazadoEn: ahora, error: ultimoRechazo });
    } else {
      l.push({ ...cuerpo, rechazadoEn: ahora, error: ultimoRechazo });
    }
    escribirLista(CLAVE_RECHAZADOS, l);
  }

  function rechazadoActual() {
    const id = asegurar().id;
    return leerRechazados().some(x => x.id === id);
  }

  /** Devuelve los rechazados a la cola para volver a enviarlos (la cola respeta el orden). */
  function reintentarRechazados() {
    const l = leerRechazados();
    if (!l.length) return;
    const cola = leerCola();
    l.forEach(x => { const { rechazadoEn, error, ...cuerpo } = x; cola.push(cuerpo); });
    if (!escribirCola(cola)) return;
    escribirLista(CLAVE_RECHAZADOS, []);
    ultimoRechazo = "";
    estadoIndicador();
    vaciarCola();
  }

  function encolar() {  // guarda lo pendiente del estudiante actual antes de cambiar de estudiante
    const lote = pendientes();
    if (!url || !lote.length) return true;
    const cola = leerCola();
    cola.push({ ...foto(), tipo: "sync", eventos: lote });
    if (!escribirCola(cola)) return false;
    const e = asegurar();
    e.sincronizadoHasta = lote[lote.length - 1].seq;  // ya quedó a cargo de la cola
    guardar();
    setTimeout(vaciarCola, 300);
    return true;
  }
  let vaciando = false;
  async function vaciarCola() {
    if (!url || vaciando || !navigator.onLine) return;
    vaciando = true;
    try {
      let cola = leerCola();
      while (cola.length) {
        const { res, j } = await mandar(cola[0]);
        if (res === "fallo") { fallos += 1; break; }   // red o Google ocupado: se reintenta luego
        if (res === "rechazado") apartar(cola[0], j.error);  // no se reintenta: se aparta y se sigue
        else fallos = 0;
        cola = leerCola().slice(1);  // el Apps Script ignora eventos repetidos (por id y número de orden)
        escribirCola(cola);
      }
    } catch (err) { fallos += 1; /* sin internet: se reintenta luego */ }
    vaciando = false;
    estadoIndicador();
    if (leerCola().length) setTimeout(vaciarCola, 30000);
  }

  /**
   * BS-05: el archivo local de evaluaciones cerradas (clave) guarda solo lo necesario.
   * Se borra una evaluación cuando (1) Google ya confirmó todos sus envíos (no está en la cola ni
   * entre los rechazados) y (2) pasaron EMSEO_DIAS_ARCHIVO días desde que se cerró. Además, de las
   * ya confirmadas se guardan como máximo EMSEO_MAX_ARCHIVO. Lo no confirmado nunca se borra.
   */
  function limpiarArchivo(clave) {
    try {
      const a = leerLista(clave);
      if (!a.length) return 0;
      const sinConfirmar = new Set([...leerCola(), ...leerRechazados()].map(x => x.id));
      const ahora = Date.now(), plazo = EMSEO_DIAS_ARCHIVO * 864e5;
      a.forEach(x => { if (x && !x.archivadoEn) x.archivadoEn = new Date(ahora).toISOString(); });  // anteriores a este cambio
      const confirmada = x => x && !sinConfirmar.has(x.id) && !(x.bitacora || []).some(ev => ev.seq > (x.sincronizadoHasta || 0));
      let quedan = a.filter(x => !confirmada(x) || ahora - Date.parse(x.archivadoEn) < plazo);
      const confirmadas = quedan.filter(confirmada);
      if (confirmadas.length > EMSEO_MAX_ARCHIVO) {
        const sobran = new Set(confirmadas.slice(0, confirmadas.length - EMSEO_MAX_ARCHIVO));
        quedan = quedan.filter(x => !sobran.has(x));
      }
      escribirLista(clave, quedan);
      return a.length - quedan.length;
    } catch (e) { return 0; }
  }

  /** Agrega una evaluación cerrada al archivo local y aplica la limpieza. */
  function archivar(clave, e) {
    try {
      const a = leerLista(clave);
      a.push({ ...e, archivadoEn: new Date().toISOString() });
      escribirLista(clave, a);
    } catch (err) { /* sin almacenamiento */ }
    limpiarArchivo(clave);
  }

  window.addEventListener("online", () => { programar(200); vaciarCola(); });
  window.addEventListener("offline", estadoIndicador);
  setTimeout(() => {
    estadoIndicador();
    const el = indicador && document.getElementById(indicador);
    if (el) el.addEventListener("click", () => {
      if (leerRechazados().length && confirm("Google Sheets rechazó algunos envíos. ¿Intentar enviarlos otra vez?")) reintentarRechazados();
    });
  }, 0);
  setTimeout(vaciarCola, 2000);

  return {
    registrar,
    encolar,
    enviar,                       // fuerza el envío; devuelve true si todo quedó confirmado
    pendientes: () => pendientes().length,
    refrescar: estadoIndicador,
    rechazados: () => leerRechazados().length,
    rechazadoActual,              // true si Google rechazó un envío de la evaluación actual
    ultimoRechazo: () => ultimoRechazo,
    reintentarRechazados,
    archivar,
    limpiarArchivo,
  };
}
