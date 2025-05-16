const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    });

    const page = await browser.newPage();

    await page.goto('https://schoolpack.smart.edu.co/idiomas/alumnos.aspx', { waitUntil: 'networkidle2' });

    // Rellenar usuario y contraseña
    await page.type('#vUSUCOD', ' ');
    await page.type('#vPASS', ' ');

    // Click en login
    await page.click('#BUTTON1');

    await page.waitForSelector('#gxp0_cls', { visible: true });
    await page.click('#gxp0_cls');

    // Espera
    await new Promise(resolve => setTimeout(resolve, 1000));


    // Esperar la imagen y clicarla
    await page.waitForSelector('#IMAGE18', { visible: true, timeout: 10000 });
    await page.click('#IMAGE18');


    // Espera
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Esperar la imagen y clicarla
    await page.waitForSelector('#span_W0030TMPCODART_0001', { visible: true, timeout: 10000 });
    await page.click('#span_W0030TMPCODART_0001');

    // Espera
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Esperar la imagen y clicarla
    await page.waitForSelector('#W0030BUTTON1', { visible: true, timeout: 10000 });
    await page.click('#W0030BUTTON1');


    // Espera
    await new Promise(resolve => setTimeout(resolve, 5000));

    const frameHandle = await page.$('#gxp0_ifrm');  // Selecciona el iframe
    const frame = await frameHandle.contentFrame();  // Obtiene el contexto del iframe

    let claseSeleccionada = false;

    async function iterarClases(frame) {
        await frame.waitForSelector('#Grid1ContainerTbl tbody tr', { visible: true });

        const filas = await frame.$$('#Grid1ContainerTbl tbody tr');
        console.log('Número de filas:', filas.length);

        for (let i = 0; i < filas.length; i++) {
            const fila = filas[i];
            const textoFila = await fila.evaluate(el =>
                el.innerText.toLowerCase().trim()
            );
            console.log(`Fila ${i + 1}:`, textoFila);

            if (textoFila.includes('pendiente')) {
                await fila.click();
                claseSeleccionada = true;
                console.log('✅ Clase seleccionada.');
                break;
            }
        }
    }

    while (!claseSeleccionada) {
        await iterarClases(frame);

        if (!claseSeleccionada) {
            // Intentar hacer clic en el botón "Siguiente"
            const botonSiguiente = await frame.$('.PagingButtonsNext');
            if (botonSiguiente) {
                console.log('➡️ No se encontró clase "pendiente", intentando siguiente página...');
                await botonSiguiente.click();
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                console.log('❌ No hay más páginas. Finalizando...');
                break;
            }
        }
    }

    await page.click('#BUTTON1');



})();
