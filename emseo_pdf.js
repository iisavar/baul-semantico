/* Respaldo PDF local de una evaluación. Requiere jspdf.umd.min.js. */
function crearPdfEmseo(datos, { pendiente = false } = {}) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("No se pudo cargar el generador de PDF.");
  const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
  const margen = 16, ancho = 178, alto = 297;
  const tinta = [21, 32, 46], tenue = [80, 92, 108], azul = [31, 58, 95];
  const texto = valor => String(valor ?? "").replace(/[\x00-\x1f\x7f]/g, " ").trim();
  const nombre = texto(datos.nombre) || "Estudiante";
  const archivo = `${nombre.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").slice(0, 70)} - EMSEO ${texto(datos.fecha) || "sin fecha"}${pendiente ? " - sin calificar" : ""}.pdf`;
  let y = margen;

  function pagina() {
    pdf.setFillColor(...azul);
    pdf.rect(0, 0, 210, 5, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(15);
    pdf.setTextColor(...tinta);
    pdf.text("Baúl Semántico | EMSEO", margen, 17);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...tenue);
    pdf.text("Evaluación de Memoria Semántica mediante Evocación Oral", margen, 22);
    y = 31;
  }
  function espacio(mm) {
    if (y + mm > alto - 18) { pdf.addPage(); pagina(); }
  }
  function linea(etiqueta, valor) {
    if (!texto(valor)) return;
    pdf.splitTextToSize(texto(valor), 126).forEach((fragmento, i) => {
      espacio(6);
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(...tenue);
      if (i === 0) pdf.text(`${etiqueta}:`, margen, y);
      pdf.setFont("helvetica", "normal"); pdf.setTextColor(...tinta);
      pdf.text(fragmento, margen + 43, y);
      y += i === 0 ? 6 : 4.5;
    });
  }
  function subtitulo(valor) {
    espacio(13);
    y += 5;
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(11);
    pdf.setTextColor(...azul);
    pdf.text(valor, margen, y);
    y += 5;
  }
  function parrafo(etiqueta, valor) {
    const contenido = texto(valor) || "Sin respuesta";
    const lineas = pdf.splitTextToSize(contenido, ancho - 4);
    espacio(9);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8.5);
    pdf.setTextColor(...tenue);
    pdf.text(etiqueta, margen + 2, y);
    y += 4.5;
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(...tinta);
    lineas.forEach(fragmento => {
      espacio(4.2);
      pdf.text(fragmento, margen + 2, y);
      y += 4.2;
    });
    y += 3;
  }

  pagina();
  linea("Estudiante", nombre);
  linea("Docente", datos.evaluador);
  linea("Grado y paralelo", [datos.grado, datos.paralelo].filter(Boolean).join(" "));
  linea("Fecha", datos.fecha);
  linea("Edad", datos.edad);
  linea("Sexo", datos.sexo);
  linea("Lengua materna", datos.lengua);
  linea("Origen de la familia", datos.region_origen);
  linea("Necesidades especiales", datos.nee === "Sí" && datos.nee_cual ? `Sí: ${datos.nee_cual}` : datos.nee);
  linea("Modalidad", datos.modalidad === "oral" ? "Digital para marcar" : datos.escribe === "docente" ? "Digital para escribir (docente)" : "Digital para escribir (estudiante)");
  subtitulo(pendiente ? "Evaluación pendiente" : "Resultado");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.setTextColor(...tinta);
  pdf.text(pendiente ? "Puntaje pendiente" : `${datos.puntaje_total} / ${datos.puntaje_max}   |   ${datos.puntaje_100} / 100   |   ${texto(datos.nivel)}`, margen, y + 2);
  y += 11;
  if (!pendiente) {
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(...tenue);
    pdf.text("El nivel es referencial para orientar al docente; no es un diagnóstico.", margen, y);
    y += 6;
  }

  subtitulo("Puntajes por concepto");
  const x = [margen, margen + 12, margen + 66, margen + 103, margen + 120, margen + 137, margen + 155];
  function cabecera() {
    espacio(8);
    pdf.setFillColor(232, 239, 248); pdf.rect(margen, y - 4, ancho, 7, "F");
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.setTextColor(...azul);
    ["N.º", "Concepto", "Región", "E", "C", "Ca", "Total"].forEach((t, i) => pdf.text(t, x[i] + 1, y));
    y += 7;
  }
  cabecera();
  (datos.respuestas || []).forEach((r, i) => {
    if (y + 5.2 > alto - 18) { pdf.addPage(); pagina(); cabecera(); }
    if (i % 2) { pdf.setFillColor(247, 249, 252); pdf.rect(margen, y - 4, ancho, 5.2, "F"); }
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(...tinta);
    const puntaje = v => v === null || v === undefined || v === "" ? "-" : String(v);
    const total = [r.a, r.b, r.c].every(v => v != null && v !== "") ? Number(r.a) + Number(r.b) + Number(r.c) : "-";
    [String(i + 1), texto(r.concepto).slice(0, 30), texto(r.region).slice(0, 17), puntaje(r.a), puntaje(r.b), puntaje(r.c), String(total)]
      .forEach((t, j) => pdf.text(t, x[j] + 1, y));
    y += 5.2;
  });

  if (datos.modalidad === "escrita") {
    subtitulo("Respuestas escritas");
    (datos.respuestas || []).forEach((r, i) => {
      const altoRespuesta = v => 7.5 + pdf.splitTextToSize(texto(v) || "Sin respuesta", ancho - 4).length * 4.2;
      espacio(10 + altoRespuesta(r.a_cita) + altoRespuesta(r.b_cita) + altoRespuesta(r.c_cita));
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(9); pdf.setTextColor(...azul);
      pdf.text(`${i + 1}. ${texto(r.concepto)}`, margen, y);
      y += 5;
      parrafo("1. ¿Qué es esto?", r.a_cita);
      parrafo("2. ¿A qué grupo pertenece?", r.b_cita);
      parrafo("3. ¿Qué sabes de esto?", r.c_cita);
    });
  }

  const paginas = pdf.internal.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) {
    pdf.setPage(i); pdf.setDrawColor(190, 201, 214); pdf.line(margen, 282, 194, 282);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.setTextColor(...tenue);
    pdf.text(`EMSEO | ${nombre.slice(0, 60)}`, margen, 287);
    pdf.text(`${i} / ${paginas}`, 194, 287, { align: "right" });
  }
  return { pdf, archivo };
}

async function guardarPdfEmseo(datos, opciones) {
  const { pdf, archivo } = crearPdfEmseo(datos, opciones);
  const blob = pdf.output("blob");
  if (window.showSaveFilePicker) {
    const handle = await window.showSaveFilePicker({
      suggestedName: archivo,
      types: [{ description: "Documento PDF", accept: { "application/pdf": [".pdf"] } }],
    });
    const writable = await handle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (error) { try { await writable.abort(); } catch (_) {} throw error; }
    return { archivo, confirmado: true };
  }
  const enlace = document.createElement("a");
  const url = URL.createObjectURL(blob);
  enlace.href = url; enlace.download = archivo; enlace.hidden = true;
  document.body.appendChild(enlace); enlace.click(); enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { archivo, confirmado: false };
}
