if (!process.env.CI) { require('dotenv').config(); } // .env solo local
const puppeteer = require('puppeteer');

const delay = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`[${new Date().toLocaleString()}] ${msg}`);
const DRY_RUN = (process.env.DRY_RUN || '').toString() === 'true';
const IS_CI = (process.env.CI || '').toString() === 'true';

async function resolveFrame(page, iframeSelector, waitForSelectorInFrame = null, timeout = 20000) {
    for (let i = 0; i < 3; i++) {
        await page.waitForSelector(iframeSelector, { visible: true, timeout });
        const handle = await page.$(iframeSelector);
        const frame = await handle.contentFrame();
        if (!frame) { await page.waitForTimeout(400); continue; }
        try {
            if (waitForSelectorInFrame) {
                await frame.waitForSelector(waitForSelectorInFrame, { visible: true, timeout });
            }
            return frame;
        } catch {
            await page.waitForTimeout(700); // el iframe se re-renderizó; reintenta
        }
    }
    throw new Error(`No se pudo estabilizar ${iframeSelector}`);
}

async function loginYAccederAsignacion(page) {
    await page.goto('https://schoolpack.smart.edu.co/idiomas/alumnos.aspx', { waitUntil: 'networkidle2' });

    const USER = process.env.SMART_USER;
    const PASS = process.env.SMART_PASS;
    if (!USER || !PASS) throw new Error('Faltan SMART_USER/SMART_PASS');

    await page.type('#vUSUCOD', USER);
    await page.type('#vPASS', PASS);
    await page.click('#BUTTON1');

    await Promise.race([
        page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => { }),
        page.waitForTimeout(2000)
    ]);

    // Cerrar modal si aparece
    try {
        await page.waitForSelector('#gxp0_cls', { visible: true, timeout: 6000 });
        await page.click('#gxp0_cls');
    } catch { }

    // Verifica que no sigues en login
    if (await page.$('#vUSUCOD')) {
        throw new Error('Parece que no inició sesión (sigo viendo #vUSUCOD). Revisa secrets o bloqueo.');
    }

    // Botón de asignación
    await page.waitForSelector('#IMAGE18', { visible: true, timeout: 12000 });
    await page.click('#IMAGE18');

    // Da tiempo a que aparezca el primer iframe
    await Promise.race([
        page.waitForSelector('#gxp0_ifrm', { timeout: 15000 }),
        page.waitForTimeout(1500)
    ]);

    // Item y botón (selector flexible por si cambia el sufijo _0001)
    await page.waitForSelector('[id^="span_W0030TMPCODART_"]', { visible: true });
    await page.click('[id^="span_W0030TMPCODART_"]');

    await page.waitForSelector('#W0030BUTTON1', { visible: true });
    await page.click('#W0030BUTTON1');
}

async function intentarProgramarClase(page) {
  const maxIntentos = 3;

  for (let intento = 1; intento <= maxIntentos; intento++) {
    log(`🔁 Intento ${intento} de ${maxIntentos}...`);

    const frame2 = await resolveFrame(page, '#gxp1_ifrm', '#vDIA');

    // 1) Sede / rango (si existe)
    try {
      await frame2.waitForSelector('#vREGCONREG', { timeout: 1500 });
      await frame2.select('#vREGCONREG', '8');
      await frame2.evaluate(() => {
        const el = document.querySelector('#vREGCONREG');
        if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await delay(500);
    } catch {}

    // 2) Selecciona "mañana" (2do option) + dispara change
    await frame2.waitForSelector('#vDIA', { visible: true });
    const opciones = await frame2.$$eval('#vDIA option', opts =>
      opts.map(o => ({ value: o.value, text: o.textContent.trim() }))
    );
    if (opciones.length <= 1) {
      log('❌ No hay opción para el día siguiente (#vDIA).');
      return false;
    }
    const valorDiaSiguiente = opciones[1].value;
    log(`📅 Día seleccionado: ${valorDiaSiguiente} (${opciones[1].text})`);
    await frame2.select('#vDIA', valorDiaSiguiente);
    await frame2.evaluate(() => {
      const el = document.querySelector('#vDIA');
      el && el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // 3) Espera a que aparezcan filas (polling) con fallback "Buscar"
    let filasCount = 0;
    for (let t = 0; t < 12; t++) { // ~6s
      try {
        await frame2.waitForSelector('#Grid1ContainerTbl tbody tr', { timeout: 500 });
        const filas = await frame2.$$('#Grid1ContainerTbl tbody tr');
        filasCount = filas.length;
        if (filasCount > 0) break;
      } catch {}
      await delay(500);
    }

    if (filasCount === 0) {
      // Fallback: intenta buscar/refrescar si hay botón de búsqueda
      const btnBuscar = await frame2.$('#BUTTON2');
      if (btnBuscar) {
        log('🔎 No hay filas; probando botón de búsqueda (#BUTTON2)...');
        await btnBuscar.click();
        await delay(800);
        const filas = await frame2.$$('#Grid1ContainerTbl tbody tr');
        filasCount = filas.length;
      }
    }

    if (filasCount === 0) {
      log('⚠️ No hay filas/horarios cargados para mañana tras seleccionar el día.');
      continue; // intenta nuevamente cambiando sede/rango/refresh
    }

    log(`✅ Filas encontradas: ${filasCount}. Seleccionando horario...`);
    const filas = await frame2.$$('#Grid1ContainerTbl tbody tr');

    // Prueba primero la última; si falla, la primera en el siguiente intento
    const index = intento === 1 ? filas.length - 1 : 0;
    await filas[index].click();

    // 🔬 Modo prueba: no confirmes, retorna OK
    if (DRY_RUN) {
      log('🧪 DRY_RUN activo: NO se hace click final. Navegación OK.');
      return true;
    }

    // 4) Confirmar
    await frame2.click('#BUTTON1');
    await delay(700);

    // 5) Errores conocidos
    const mensajeError = await frame2.$$eval('#TABLE2 .gx-warning-message', elems =>
      elems.map(e => e.innerText.trim()).find(texto =>
        texto.includes('No hay salones disponibles') ||
        texto.includes('clases anteriores programadas en fechas futuras') ||
        texto.includes('valida disponibilidad en otras franjas')
      )
    );

    if (mensajeError) {
      log(`⚠️ Error al programar: ${mensajeError}`);
      // Cambia condición/rango e intenta otra vez
      try { await frame2.select('#vREGCONREG', '8'); } catch {}
      await delay(1500);
      continue;
    }

    log('🎉 Clase asignada correctamente.');
    return true;
  }

  log('❌ No se pudo asignar la clase tras varios intentos.');
  return false;
}


(async () => {
    let browser, page;
    let ok = false;
    try {
        const hoy = new Date();
        const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
        if (manana.getDay() === 0) { log('⛔ Mañana es domingo. No hay clases.'); return; }

        browser = await puppeteer.launch({
            headless: IS_CI ? true : false,  // en CI: headless
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 850 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
        await page.setDefaultTimeout(30000);

        await loginYAccederAsignacion(page);

        // Iframe 1
        await page.waitForSelector('#gxp0_ifrm');
        const frame1 = await (await page.$('#gxp0_ifrm')).contentFrame();
        if (!frame1) throw new Error('No se pudo obtener #gxp0_ifrm');

        await delay(700);
        try { await frame1.select('#vTPEAPROBO', '2'); } catch { }
        await delay(700);
        await frame1.waitForSelector('#Grid1ContainerTbl tbody tr:first-child', { visible: true });
        await frame1.click('#Grid1ContainerTbl tbody tr:first-child');
        await frame1.click('#BUTTON1');

        // Iframe 2 (primera estabilización)
        await resolveFrame(page, '#gxp1_ifrm', '#vDIA');

        ok = await intentarProgramarClase(page);


    } catch (err) {
        console.error(`[${new Date().toLocaleString()}] ❌ Error:`, err.message);
        process.exitCode = 1;
    } finally {
        await browser?.close();
    }
    if (ok) {
        console.log('🏁 FIN OK');
        process.exit(0);
    } else {
        console.log('❌ FIN SIN COMPLETAR');
        process.exit(2); // marca el job como fallido
    }
})();
