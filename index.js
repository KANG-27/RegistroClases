const puppeteer = require('puppeteer');

(async () => {
    try {
        const browser = await puppeteer.launch({
            headless: false,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        });

        const page = await browser.newPage();
        await page.setDefaultTimeout(10000);

        await page.goto('https://schoolpack.smart.edu.co/idiomas/alumnos.aspx', { waitUntil: 'networkidle2' });

        // Login
        await page.type('#vUSUCOD', ' ');
        await page.type('#vPASS', ' ');
        await page.click('#BUTTON1');

        // Navegación inicial
        await page.waitForSelector('#gxp0_cls', { visible: true });
        await page.click('#gxp0_cls');
        await page.waitForSelector('#IMAGE18', { visible: true });
        await page.click('#IMAGE18');
        await page.waitForSelector('#span_W0030TMPCODART_0001', { visible: true });
        await page.click('#span_W0030TMPCODART_0001');
        await page.waitForSelector('#W0030BUTTON1', { visible: true });
        await page.click('#W0030BUTTON1');

        // Esperar iframe y obtenerlo
        await page.waitForSelector('#gxp0_ifrm', { visible: true });
        const frameHandle = await page.$('#gxp0_ifrm');
        const frame = await frameHandle.contentFrame();
        if (!frame) throw new Error('No se pudo obtener el iframe');

        await frame.evaluate(() => {
            const select = document.getElementById('vTPEAPROBO');
            if (select) {
                select.value = '2'; // '2' corresponde a "Pendientes por programar"
                const event = new Event('change', { bubbles: true });
                select.dispatchEvent(event);
            }
        });

        // Espera
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        
        await frame.waitForSelector('#Grid1ContainerTbl tbody tr:first-child', { visible: true });
        const textoPrimeraFila = await frame.$eval('#Grid1ContainerTbl tbody tr:first-child', el => el.innerText);
        console.log('Texto primera fila:', textoPrimeraFila);
        
        // Ahora clic
        await frame.click('#Grid1ContainerTbl tbody tr:first-child');


        await frame.waitForSelector('#BUTTON1', { visible: true });
        await frame.click('#BUTTON1');
        
    
         // Esperar iframe de clases y obtenerlo
        await page.waitForSelector('#gxp1_ifrm', { visible: true });
        const frameSelectClassHandle = await page.$('#gxp1_ifrm');
        const frameSelectClass = await frameSelectClassHandle.contentFrame();
        if (!frameSelectClass) throw new Error('No se pudo obtener el iframe');

        await frameSelectClass.evaluate(() => {
            const select = document.getElementById('vDIA');
            if (select) {
                select.value = '5'; // '5' creo que es el segundo dia"
                const event = new Event('change', { bubbles: true });
                select.dispatchEvent(event);
            }
        });

        await frameSelectClass.waitForSelector('#Grid1ContainerTbl tbody tr', { visible: true });
        await frameSelectClass.click('#Grid1ContainerTbl tbody tr:last-child');
        await frameSelectClass.click('#BUTTON1');

        // Cerrar el navegador después de un tiempo
        await new Promise(resolve => setTimeout(resolve, 5000));
        await browser.close();

    } catch (error) {
        console.error('Error durante la ejecución:', error);
        if (browser) await browser.close();
    }
})();