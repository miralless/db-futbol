const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const admin = require('firebase-admin');

// 1. CONFIGURACIÓN DE FIREBASE
const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
    : require("./serviceAccountKey.json");

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();
puppeteer.use(StealthPlugin());

// Función auxiliar para crear IDs limpios (ej: "Ekain Etxebarria" -> "ekain_etxebarria")
const crearIdDoc = (tipo, nombre) => {
    return `${tipo}_${nombre.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '')}`;
};

async function scriptIntegradoFutbol() {
    console.log("🚀 Iniciando Extracción y Actualización en Firebase...");
    
    const baseDeDatosFutbol = [];
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process', // Esto ayuda mucho en entornos con poca RAM como GitHub
            '--ignore-certificate-errors',
            '--ignore-ssl-errors',
            '--allow-running-insecure-content'
        ] 
    });

    try {
        const jugadoresLaPreferente = [
            { nombre: "Ekain Etxebarria", url: "https://www.lapreferente.com/?IDjugador=355665" },
            { nombre: "Eneko Ebro", url: "https://www.lapreferente.com/?IDjugador=355646" },
            { nombre: "Jon García", url: "https://www.lapreferente.com/J355644C22283/cd-derio/jon.html" }
        ];

        const jugadoresFederacion = [
            { nombre: "Gaizka Miralles", url: "https://www.fvf-bff.eus/pnfg/NPcd/NFG_EstadisticasJugador?cod_primaria=3000328&jugador=74876&codacta=9983308" },
            { nombre: "Peio Manrique", url: "https://www.fvf-bff.eus/pnfg/NPcd/NFG_EstadisticasJugador?cod_primaria=3000328&jugador=74062&codacta=9983308" },
            { nombre: "Jon Hermida", url: "https://www.fvf-bff.eus/pnfg/NPcd/NFG_EstadisticasJugador?cod_primaria=3000328&jugador=70074&codacta=9983241" }
        ];

        const equiposLaPreferente = [
            { nombre: "Eibar B", url: "https://www.lapreferente.com/E5847C22299-19/sd-eibar-b" },
            { nombre: "Derio", url: "https://www.lapreferente.com/E10466C22283-19/cd-derio" },
            { nombre: "Cartagena", url: "https://www.lapreferente.com/E712C22270-1/fc-cartagena-sad" }
        ];

        // --- EXTRACCIÓN JUGADORES ---
        for (const j of jugadoresLaPreferente) {
            const page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'es-ES,es;q=0.9'
            });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            // await page.waitForSelector('.lpfTable01', { visible: true, timeout: 300000 });
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });
            /*
            const contenido = await page.content();
            console.log("--- DEBUG START ---");
            console.log("Longitud del HTML:", contenido.length);
            // Esto imprimirá el texto visible para ver si hay un "Acceso denegado"
            const textoVisible = await page.evaluate(() => document.body.innerText.substring(0, 500));
            console.log("Texto visible:", textoVisible);
            console.log("--- DEBUG END ---");
            */
            try {
                await page.goto(j.url, { waitUntil: 'domcontentloaded', waitUntil: 'networkidle0', timeout: 50000 });
                try {
                    const title = await page.title();
                    console.log("Título de la página:", title);
                } catch (e) {
                    console.log("Error al obtener el título (posible bloqueo de IP)");
                }
                const stats = await page.evaluate((n) => {
                    const res = { nombre: n, origen: "LaPreferente", PJ: "0", Tit: "0", Sup: "0", Goles: "0", Am: "0", Roj: "0", timestamp: new Date().toISOString() };
                    const fila = document.querySelector('#estadisticasJugador tr.totales');
                    if (fila) {
                        const ths = Array.from(fila.querySelectorAll('th'));
                        res.PJ = ths[1]?.innerText.match(/Jugados:\s*(\d+)/)?.[1] || "0";
                        res.Tit = ths[2]?.innerText.trim() || "0";
                        res.Goles = ths[4]?.innerText.trim() || "0";
                        res.Am = ths[5]?.innerText.trim() || "0";
                        res.Roj = ths[6]?.innerText.trim() || "0";
                        res.Sup = (parseInt(res.PJ) - parseInt(res.Tit)).toString();
                    }
                    return res;
                }, j.nombre);
                baseDeDatosFutbol.push({ tipo: "jugador", ...stats });
            } catch (e) { console.error(`❌ Error Jugador ${j.nombre}`); }
            await page.close();
        }

        for (const j of jugadoresFederacion) {
            const page = await browser.newPage();
            try {
                await page.goto(j.url, { waitUntil: 'networkidle2', timeout: 40000 });
                const stats = await page.evaluate((n) => {
                    const res = { nombre: n, origen: "Federacion", PJ: "0", Tit: "0", Sup: "0", Goles: "0", Am: "0", Roj: "0", timestamp: new Date().toISOString() };
                    const celdas = Array.from(document.querySelectorAll('td'));
                    let bikoitza = 0, gorria = 0;
                    celdas.forEach((td, i) => {
                        const txt = td.innerText.trim();
                        const val = celdas[i + 1]?.innerText.trim() || "0";
                        if (txt === "Jokatutakoak") res.PJ = val;
                        if (txt === "Hamaikakoan") res.Tit = val;
                        if (txt === "Ordezkoa") res.Sup = val;
                        if (txt === "Guztira") res.Goles = val;
                        if (txt === "Txartel horia") res.Am = val;
                        if (txt === "Txartel horia bikoitza") bikoitza = parseInt(val) || 0;
                        if (txt === "Txartel gorria") gorria = parseInt(val) || 0;
                    });
                    res.Roj = (bikoitza + gorria).toString();
                    return res;
                }, j.nombre);
                baseDeDatosFutbol.push({ tipo: "jugador", ...stats });
            } catch (e) { console.error(`❌ Error Jugador ${j.nombre}`); }
            await page.close();
        }

        // --- EXTRACCIÓN EQUIPOS LA PREFERENTE ---
        for (const e of equiposLaPreferente) {
            const page = await browser.newPage();
            await page.setViewport({ width: 1920, height: 1080 });
            await page.setExtraHTTPHeaders({
                'Accept-Language': 'es-ES,es;q=0.9'
            });
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
            // await page.waitForSelector('.lpfTable01', { visible: true, timeout: 300000 });
            await page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });
            });
            await page.screenshot({ path: 'captura_debug.png', fullPage: true });
            console.log("Captura de pantalla realizada.");
            try {
                await page.goto(e.url, { waitUntil: 'networkidle2', waitUntil: 'networkidle0', timeout: 50000 });
                const data = await page.evaluate((nFiltro) => {
                    const ahora = new Date();
                    const tablas = Array.from(document.querySelectorAll('table.lpfTable01'));
                    const partidos = [];
                    tablas.forEach(tabla => {
                        const th = tabla.querySelector('th');
                        if (!th) return;
                        const matchFecha = th.innerText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                        if (matchFecha) {
                            const fechaTab = new Date(matchFecha[3], matchFecha[2] - 1, matchFecha[1]);
                            const fila = Array.from(tabla.querySelectorAll('tr')).find(tr => tr.innerText.toLowerCase().includes(nFiltro.toLowerCase()));
                            if (fila) {
                                const tds = fila.querySelectorAll('td');
                                if (tds.length >= 3) {
                                    const local = tds[0].innerText.trim();
                                    const resHora = tds[1].innerText.trim();
                                    const visitante = tds[2].innerText.trim();
                                    partidos.push({
                                        fecha: fechaTab,
                                        infoJornada: th.innerText.trim(),
                                        rival: local.toLowerCase().includes(nFiltro.toLowerCase()) ? `${visitante} (C)` : `${local} (F)`,
                                        resultado: resHora
                                    });
                                }
                            }
                        }
                    });
                    const pasados = partidos.filter(p => p.fecha <= ahora).sort((a, b) => b.fecha - a.fecha);
                    const futuros = partidos.filter(p => p.fecha > ahora).sort((a, b) => a.fecha - b.fecha);
                    return {
                        ultimo: pasados[0] ? { infoJornada: pasados[0].infoJornada, rival: pasados[0].rival, resultado: pasados[0].resultado } : null,
                        proximo: futuros[0] ? { infoJornada: futuros[0].infoJornada, rival: futuros[0].rival, resultado: futuros[0].resultado } : null
                    };
                }, e.nombre);
                baseDeDatosFutbol.push({ tipo: "equipo", nombre: e.nombre, origen: "LaPreferente", ...data, timestamp: new Date().toISOString() });
            } catch (err) { console.error(`❌ Error equipo ${e.nombre}`); }
            await page.close();
        }

        // --- EQUIPO INDARTSU ---
        const pageInd = await browser.newPage();
        try {
            await pageInd.goto("https://www.fvf-bff.eus/pnfg/NPcd/NFG_VisCompeticiones_Grupo?cod_primaria=1000123&codequipo=30094&codgrupo=22682897", { waitUntil: 'networkidle2' });
            const dataInd = await pageInd.evaluate(() => {
                const filas = Array.from(document.querySelectorAll('tbody tr'));
                const lista = [];

                filas.forEach(f => {
                    const tds = f.querySelectorAll('td');
                    if (tds.length < 3) return;

                    // 1. Extraer Jornada (la primera columna)
                    const jornadaNum = tds[0].innerText.trim();

                    // 2. Extraer Equipos y Fecha/Hora (la segunda columna tiene 3 h5)
                    const h5s = Array.from(tds[1].querySelectorAll('h5'));
                    const local = h5s[0]?.innerText.trim() || "";
                    const visitante = h5s[1]?.innerText.trim() || "";
                    
                    // Limpiamos la fecha/hora de espacios raros (&nbsp;)
                    const fechaHoraTexto = h5s[2]?.innerText.replace(/\s+/g, ' ').trim() || ""; 
                    // Separamos: "17-01-2026 15:30" -> ["17-01-2026", "15:30"]
                    const partesFecha = fechaHoraTexto.split(' ');
                    const soloFecha = partesFecha[0] || "";
                    const soloHora = partesFecha[1] || "";

                    // 3. Extraer Resultado (la tercera columna)
                    const res = tds[2].innerText.trim();
                    
                    // Un partido se considera jugado si el resultado tiene números (ej: "1 - 0")
                    const yaJugado = /\d/.test(res);

                    lista.push({
                        // Guardamos la jornada con la fecha: "JORNADA 16 - 10-01-2026"
                        infoJornada: `JORNADA ${jornadaNum} - ${soloFecha}`,
                        rival: local.toUpperCase().includes("INDARTSU") ? `${visitante} (C)` : `${local} (F)`,
                        // Si ya se jugó, guardamos el marcador. Si no, la hora.
                        resultado: yaJugado ? res : soloHora,
                        yaJugado: yaJugado
                    });
                });

                const jugados = lista.filter(p => p.yaJugado);
                const futuros = lista.filter(p => !p.yaJugado);

                return {
                    ultimo: jugados.length > 0 ? { 
                        infoJornada: jugados[jugados.length - 1].infoJornada, 
                        rival: jugados[jugados.length - 1].rival, 
                        resultado: jugados[jugados.length - 1].resultado 
                    } : null,
                    proximo: futuros.length > 0 ? { 
                        infoJornada: futuros[0].infoJornada, 
                        rival: futuros[0].rival, 
                        resultado: futuros[0].resultado // Aquí ahora irá "15:30" directamente
                    } : null
                };
            });
            
            baseDeDatosFutbol.push({ tipo: "equipo", nombre: "Indartsu", origen: "Federacion", ...dataInd, timestamp: new Date().toISOString() });
            console.log("✅ Datos extraídos (Jornada con fecha y Próximo con hora)");

        } catch (e) { 
            console.error("❌ Error Indartsu:", e); 
        }
        await pageInd.close();

        // --- SUBIDA A FIREBASE (CON ACTUALIZACIÓN) ---
        if (baseDeDatosFutbol.length > 0) {
            console.log("\n📤 Actualizando documentos en Firebase...");
            const batch = db.batch();

            baseDeDatosFutbol.forEach(dato => {
                // Generamos un ID único basado en el nombre y tipo
                const customId = crearIdDoc(dato.tipo, dato.nombre);
                const docRef = db.collection('seguimiento_futbol').doc(customId);
                
                // .set con { merge: true } asegura que si el documento existe se actualice, 
                // y si no existe se cree.
                batch.set(docRef, dato, { merge: true });
            });

            await batch.commit();
            console.log("✅ Documentos actualizados correctamente (sin duplicados).");
        }

    } catch (error) { console.error("❌ Error General:", error); }
    finally { await browser.close(); }
}

scriptIntegradoFutbol();