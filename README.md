# Baúl Semántico | EMSEO

**Evaluación de Memoria Semántica mediante Evocación Oral**, Universidad Bolivariana del Ecuador.
Proyecto «La memoria semántica en el desarrollo de la oralidad de los estudiantes».

**Abrir:** https://iisavar.github.io/baul-semantico/

| App | Para qué |
|---|---|
| `3_Digital_para_marcar.html` | El estudiante responde en voz alta y el docente marca 0, 1 o 2 |
| `4_Digital_para_escribir.html` | Las respuestas quedan escritas (las escribe el docente o el estudiante) y el docente califica con 0, 1 o 2 |

Es un recurso digital: se usa en el navegador, con internet, sin instalar nada. Los resultados se registran
automáticamente en la hoja de Google Sheets privada del proyecto. Si el internet se corta un momento, lo que falta
queda guardado en el navegador y se envía solo cuando vuelve la conexión.
**Ningún dato de estudiantes se guarda en este repositorio.**

La evaluación usa las mismas **20 láminas** para todos los estudiantes (máximo **120 puntos**). El banco de 27 fotos
se conserva para las evaluaciones anteriores; las siete fotos omitidas no aparecen en una evaluación nueva.

Al finalizar, la app prepara un PDF con los datos y resultados del estudiante y confirma el envío a Google Sheets. En Chrome o Edge de escritorio, el docente elige dónde guardar el PDF y la app comprueba que terminó la escritura antes de habilitar «Siguiente estudiante». En otros navegadores se inicia una descarga y el docente debe comprobar el archivo antes de continuar. Si Sheets no confirma la recepción, la app lo indica y mantiene el envío pendiente para reintentarlo. Las respuestas escritas pendientes de calificación también generan un PDF sin puntajes.

**Si Google Sheets rechaza un envío** (por ejemplo, porque el Apps Script publicado es una versión anterior), la app no lo reintenta para siempre: lo aparta, el indicador muestra «⚠ Google Sheets rechazó…» y los demás envíos siguen. Al tocar el indicador se puede volver a intentar. Un corte de internet no cuenta como rechazo: eso se reintenta solo.

**Datos en esta computadora:** mientras una evaluación no está confirmada por Google Sheets, queda guardada en el navegador (para no perderla). Las evaluaciones cerradas y ya confirmadas se borran solas del navegador 30 días después de cerrarse, y nunca se guardan más de 100 confirmadas. Las respuestas escritas que esperan calificación quedan hasta que se califican. En computadoras compartidas, al terminar la jornada conviene cerrar la sesión del navegador o borrar los datos del sitio.

| Archivo | Contenido |
|---|---|
| `emseo.css` | Estilo común de las dos apps |
| `emseo_sync.js` | Registro de cambios y envío en vivo a Google Sheets |
| `emseo_pdf.js` y `jspdf.umd.min.js` | Generación del PDF local; jsPDF se distribuye bajo licencia MIT (`JSPDF_LICENSE.txt`) |
| `img_laminas/` | Banco de 27 fotografías y mapas; la app aplica 20 |
| `img_laminas/CREDITOS.md` | Fuentes y licencias de marimba, bosque tropical y pesca artesanal |

**Publicación:** el Apps Script desplegado debe actualizarse primero con `apps_script.gs` del proyecto y una nueva
versión de la **misma** implementación (la URL no cambia); al abrir la URL `/exec` debe responder `"version":"2026-10-10-20"`. La versión antigua rechaza los envíos de 20 respuestas. Después se publican estos
archivos en GitHub Pages. Una evaluación antigua de 27 sigue aceptándose y conserva su escala de 162 puntos.

Créditos de las fotografías: ver [`CREDITOS.md`](CREDITOS.md).
El logo es propiedad de la Universidad Bolivariana del Ecuador y se usa en este proyecto institucional de la UBE.
