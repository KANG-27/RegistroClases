
require('dotenv').config(); // solo necesario si corres local con .env
const fs = require('fs');
const puppeteer = require('puppeteer');

const delay = ms => new Promise(r => setTimeout(r, ms));
const log = msg => console.log(`[${new Date().toLocaleString()}] ${msg}`);

async function resolveFrame(page, iframeSelector, waitForSelectorInFrame = null, timeout = 20000) {
    // Reintenta por si el iframe se re-renderiza
    for (let i = 0; i < 3; i++) {
        await page.waitForSelector(iframeSelector, { visible: true, timeout });
        const handle = await page.$(iframeSelector);
        const frame = await handle.contentFrame();
        if (!frame) {
            await page.waitForTimeout(400);
            continue;
        }
        try {
            if (waitForSelectorInFrame) {
                await frame.waitForSelector(waitForSelectorInFrame, { visible: true, timeout });
            }
            return frame; // estable
        } catch {
            await page.waitForTimeout(700); // probable recarga → reintenta
        }
    }
    throw new Error(`No se pudo estabilizar ${iframeSelector}`);
}

async function loginYAccederAsignacion(page) {
  await page.goto('https://schoolpack.smart.edu.co/idiomas/alumnos.aspx', { waitUntil: 'networkidle2' });
  await snap(page, '00_load');

  // Login con ENV
  const USER = process.env.SMART_USER;
  const PASS = process.env.SMART_PASS;
  if (!USER || !PASS) throw new Error('Faltan SMART_USER/SMART_PASS');

  await page.type('#vUSUCOD', USER);
  await page.type('#vPASS', PASS);
  await page.click('#BUTTON1');

  // Espera la navegación/recarga post-login
  await Promise.race([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {}),
    page.waitForTimeout(2000) // algunos flows no navegan pero cambian DOM
  ]);
  await snap(page, '01_after_login');

  // Cerrar modal si aparece
  try {
    await page.waitForSelector('#gxp0_cls', { visible: true, timeout: 6000 });
    await page.click('#gxp0_cls');
    await snap(page, '02_modal_closed');
  } catch (_) {
    // no había modal
  }

  // Verifica que no sigues en login (si el usuario/clave falló)
  const stillOnLogin = await page.$('#vUSUCOD');
  if (stillOnLogin) {
    await snap(page, '02_login_failed_or_blocked');
    throw new Error('Parece que no inició sesión (sigo viendo #vUSUCOD). Revisa secrets o posibles bloqueos.');
  }

  // Navegar a asignación (y probar variantes si cambia layout)
  try {
    await page.waitForSelector('#IMAGE18', { visible: true, timeout: 12000 });
  } catch {
    // Fallback: algunas vistas usan otro id / menú
    await snap(page, '03_before_IMAGE18_not_found');
    throw new Error('No apareció #IMAGE18 tras el login. Puede ser layout/responsive o flujo distinto.');
  }

  await page.click('#IMAGE18');

  await page.waitForSelector('#span_W0030TMPCODART_0001', { visible: true });
  await page.click('#span_W0030TMPCODART_0001');

  await page.waitForSelector('#W0030BUTTON1', { visible: true });
  await page.click('#W0030BUTTON1');
  await snap(page, '04_after_clicks_to_iframe1');
}


async function intentarProgramarClase(page) {
    const maxIntentos = 3;

    for (let intento = 1; intento <= maxIntentos; intento++) {
        log(`🔁 Intento ${intento} de ${maxIntentos}...`);

        // Recaptura el iframe en cada intento (evita "frame got detached")
        const frame2 = await resolveFrame(page, '#gxp1_ifrm', '#vDIA');

        // Selecciona el 2º option (suele ser “mañana”)
        const opciones = await frame2.$$eval('#vDIA option', opts =>
            opts.map(o => ({ value: o.value, text: o.textContent.trim() }))
        );
        if (opciones.length <= 1) {
            log('❌ No hay opción para el día siguiente.');
            return false;
        }
        const valorDiaSiguiente = opciones[1].value;
        log(`📅 Día seleccionado: ${valorDiaSiguiente}`);
        await frame2.select('#vDIA', valorDiaSiguiente);
        await delay(800);

        // Horarios
        await frame2.waitForSelector('#Grid1ContainerTbl tbody tr', { visible: true });
        const filas = await frame2.$$('#Grid1ContainerTbl tbody tr');
        if (!filas.length) {
            log('⚠️ No hay filas/horarios para mañana.');
            return false;
        }

        // Última fila (o cambia a [0] para la primera)
        await filas[filas.length - 1].click();
        await frame2.click('#BUTTON1');
        await delay(600);

        // ⬇️ BLOQUE DE ERRORES (el que querías agregar)
        const mensajeError = await frame2.$$eval('#TABLE2 .gx-warning-message', elems =>
            elems
                .map(e => e.innerText.trim())
                .find(texto =>
                    texto.includes("No hay salones disponibles") ||
                    texto.includes("La clase no puede ser programada, debido a que existen clases anteriores programadas en fechas futuras.") ||
                    texto.includes("Te invitamos a validar disponibilidad en otras franjas horarias o sedes cercanas. Recuerda que puedes ingresar continuamente y revisar los cupos que se liberan en el transcurso del día.")
                )
        );

        if (mensajeError) {
            log(`⚠️ Error al programar: ${mensajeError}`);
            try { await frame2.select('#vREGCONREG', '8'); } catch { }
            await delay(2000);
            continue; // reintenta con el iframe recapturado
        } else {
            log("✅ Clase asignada correctamente.");
            await delay(5000);
            return true;
        }
    }

    log('❌ No se pudo asignar la clase tras varios intentos.');
    return false;
}


(async () => {
    let browser, page;
    try {
        // Evita domingos
        const hoy = new Date();
        const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
        if (manana.getDay() === 0) {
            log('⛔ Mañana es domingo. No hay clases.');
            return;
        }

        browser = await puppeteer.launch({
            headless: true, // en GitHub Actions: true
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 850 });
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );


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

        // Iframe 2 (primer resolución)
        await resolveFrame(page, '#gxp1_ifrm', '#vDIA');

        // Programar clase (recaptura internamente)
        await intentarProgramarClase(page);

    } catch (err) {
        console.error(`[${new Date().toLocaleString()}] ❌ Error:`, err.message);
        try {
            fs.mkdirSync('screenshots', { recursive: true });
            await page?.screenshot({ path: 'screenshots/error.png', fullPage: true });
        } catch { }
    } finally {
        await browser?.close();
    }
})();
