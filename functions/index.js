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

// --- FUNCIONES AUXILIARES ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const crearIdDoc = (tipo, nombre) => {
    return `${tipo}_${nombre.toLowerCase().replace(/\s+/g, '_').replace(/[^\w]/g, '')}`;
};

/**
 * Pasa fechas de "1/2/26" a "01/02/2026"
 */
function formatearFecha(fechaSucio) {
    if (!fechaSucio) return "";
    const limpia = fechaSucio.replace(/-/g, '/');
    const partes = limpia.split('/');
    if (partes.length !== 3) return fechaSucio;

    const dia = partes[0].padStart(2, '0');
    const mes = partes[1].padStart(2, '0');
    let anio = partes[2];
    if (anio.length === 2) anio = "20" + anio;
    
    return `${dia}/${mes}/${anio}`;
}

async function scriptIntegradoFutbol() {
    console.log("🚀 Iniciando Extracción con selectores de tabla actualizados...");
    
    const baseDeDatosFutbol = [];
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1920,1080'] 
    });

    let jEibarB = 0, jDerio = 0, jCartagena = 0, jIndartsu = 0;

    try {
        const equiposLaPreferente = [
            { nombre: "Eibar B", url: "https://www.lapreferente.com/E5847C22299-19/sd-eibar-b", fotmob: "https://www.fotmob.com/teams/189634/overview/eibar-b" },
            { nombre: "Derio", url: "https://www.lapreferente.com/E10466C22283-19/cd-derio", sofascore: "https://www.sofascore.com/es/football/team/cd-derio/488513" },
            { nombre: "Cartagena", url: "https://www.lapreferente.com/E712C22270-1/fc-cartagena-sad", fotmob: "https://www.fotmob.com/teams/8554/overview/cartagena" }
        ];

        // --- 1. EXTRACCIÓN EQUIPOS LA PREFERENTE ---
        for (const e of equiposLaPreferente) {
            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
            
            try {
                await page.goto(e.url, { waitUntil: 'networkidle2', timeout: 45000 });
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
                                    partidos.push({
                                        fecha: fechaTab,
                                        fechaString: `${matchFecha[1]}/${matchFecha[2]}/${matchFecha[3]}`,
                                        infoJornada: th.innerText.trim(),
                                        rival: tds[0].innerText.toLowerCase().includes(nFiltro.toLowerCase()) ? `${tds[2].innerText.trim()} (C)` : `${tds[0].innerText.trim()} (F)`,
                                        resultado: tds[1].innerText.trim()
                                    });
                                }
                            }
                        }
                    });

                    const pasados = partidos.filter(p => p.fecha <= ahora).sort((a, b) => b.fecha - a.fecha);
                    const futuros = partidos.filter(p => p.fecha > ahora).sort((a, b) => a.fecha - b.fecha);
                    const numJornada = pasados[0]?.infoJornada.match(/\d+/)?.[0] || "0";

                    return {
                        ultimo: pasados[0] ? { infoJornada: pasados[0].infoJornada, rival: pasados[0].rival, resultado: pasados[0].resultado } : null,
                        proximo: futuros[0] ? { infoJornada: futuros[0].infoJornada, rival: futuros[0].rival, resultado: futuros[0].resultado, fechaRef: futuros[0].fechaString } : null,
                        jornadaNum: parseInt(numJornada)
                    };
                }, e.nombre);

                if (e.sofascore && data.proximo) {
                    const pageSofa = await browser.newPage();
                    try {
                        await pageSofa.goto(e.sofascore, { waitUntil: 'networkidle2' });
                        await delay(2000);
                        await pageSofa.evaluate(() => {
                            const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('ACEPTAR') || b.innerText.includes('AGREE'));
                            if (btn) btn.click();
                        });
                        const textoSucio = await pageSofa.evaluate(() => document.querySelector('div.card-component.desktop-only')?.innerText || "");
                        const regexHorario = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(\d{2}:\d{2})/g;
                        let coincidencias = []; let m;
                        while ((m = regexHorario.exec(textoSucio)) !== null) {
                            coincidencias.push({ f: m[1], h: m[2] });
                        }
                        if (coincidencias.length >= 2) {
                            data.proximo.resultado = `${formatearFecha(coincidencias[1].f)} ${coincidencias[1].h}`;
                        }
                    } catch (err) { console.log("⚠️ Error SofaScore"); }
                    finally { await pageSofa.close(); }
                }

                if (e.fotmob && data.proximo) {
                    const pageFot = await browser.newPage();
                    try {
                        await pageFot.goto(e.fotmob, { waitUntil: 'networkidle2' });
                        await delay(2000);
                        const horaFot = await pageFot.evaluate(() => {
                            const section = document.querySelector('section[class*="NextMatchBoxCSS"]');
                            if (!section) return null;
                            const el = Array.from(section.querySelectorAll('span, div')).find(el => /^(\d{1,2}:\d{2})/i.test(el.innerText.trim()));
                            return el ? el.innerText.trim() : null;
                        });
                        if (horaFot) {
                            data.proximo.resultado = `${formatearFecha(data.proximo.fechaRef)} ${horaFot}`;
                        }
                    } catch (err) { console.log("⚠️ Error FotMob"); }
                    finally { await pageFot.close(); }
                }

                if (data.proximo) delete data.proximo.fechaRef;
                if (e.nombre === "Eibar B") jEibarB = data.jornadaNum;
                if (e.nombre === "Derio") jDerio = data.jornadaNum;
                if (e.nombre === "Cartagena") jCartagena = data.jornadaNum;

                baseDeDatosFutbol.push({ nombre: e.nombre, tipo: "equipo", origen: "LaPreferente", ...data });
                console.log(`✅ Equipo ${e.nombre} extraído`);
            } catch (err) { console.error(`❌ Error equipo ${e.nombre}`); }
            await page.close();
        }

        // --- 2. EQUIPO INDARTSU (FEDERACIÓN) ---
        const pageInd = await browser.newPage();
        try {
            await pageInd.goto("https://www.fvf-bff.eus/pnfg/NPcd/NFG_VisCompeticiones_Grupo?cod_primaria=1000123&codequipo=30094&codgrupo=22682897", { waitUntil: 'networkidle2' });
            const dataInd = await pageInd.evaluate(() => {
                const filas = Array.from(document.querySelectorAll('tbody tr'));
                const lista = [];
                let maxJornada = 0;
                filas.forEach(f => {
                    const tds = f.querySelectorAll('td');
                    if (tds.length < 3) return;
                    const jNum = parseInt(tds[0].innerText.trim());
                    const h5s = Array.from(tds[1].querySelectorAll('h5'));
                    const fechaHoraTexto = h5s[2]?.innerText.replace(/\s+/g, ' ').trim() || ""; 
                    const partes = fechaHoraTexto.split(' ');
                    const res = tds[2].innerText.trim();
                    const yaJugado = /\d/.test(res);
                    if (yaJugado && jNum > maxJornada) maxJornada = jNum;
                    lista.push({
                        jNum: jNum,
                        f: partes[0] || "",
                        h: partes[1] || "",
                        rival: h5s[0]?.innerText.toUpperCase().includes("INDARTSU") ? `${h5s[1]?.innerText.trim()} (C)` : `${h5s[0]?.innerText.trim()} (F)`,
                        resultado: res,
                        yaJugado: yaJugado
                    });
                });
                const jugados = lista.filter(p => p.yaJugado);
                const futuros = lista.filter(p => !p.yaJugado);
                const u = jugados[jugados.length - 1];
                const p = futuros[0];

                return { 
                    ultimo: u ? { infoJornada: `JORNADA ${u.jNum}`, fRaw: u.f, rival: u.rival, resultado: u.resultado } : null, 
                    proximo: p ? { infoJornada: `JORNADA ${p.jNum}`, rival: p.rival, fRaw: p.f, hRaw: p.h } : null, 
                    jornadaNum: maxJornada 
                };
            });

            if (dataInd.ultimo && dataInd.ultimo.fRaw) {
                dataInd.ultimo.infoJornada = `JORNADA ${dataInd.jornadaNum} (${formatearFecha(dataInd.ultimo.fRaw)})`;
                delete dataInd.ultimo.fRaw;
            }
            if (dataInd.proximo) {
                dataInd.proximo.resultado = `${formatearFecha(dataInd.proximo.fRaw)} ${dataInd.proximo.hRaw}`.trim();
                delete dataInd.proximo.fRaw; delete dataInd.proximo.hRaw;
            }
            
            jIndartsu = dataInd.jornadaNum;
            baseDeDatosFutbol.push({ nombre: "Indartsu", tipo: "equipo", origen: "Federacion", ...dataInd });
            console.log(`✅ Equipo Indartsu extraído`);
        } catch (e) { console.error("❌ Error Indartsu"); }
        await pageInd.close();

        // --- 2.1 CLASIFICACIÓN INDARTSU (CORREGIDO) ---
        const pageClasInd = await browser.newPage();
        try {
            await pageClasInd.goto("https://www.fvf-bff.eus/pnfg/NPcd/NFG_VisClasificacion?cod_primaria=1000120&codjornada=17&codcompeticion=22620319&codgrupo=22682897&codjornada=17&cod_agrupacion=1773563", { waitUntil: 'networkidle2' });
            const tablaClas = await pageClasInd.evaluate(() => {
                // Seleccionamos la tabla por sus clases exactas
                const tabla = document.querySelector('table.table.table-bordered.table-striped');
                if (!tabla) return [];

                const filas = Array.from(tabla.querySelectorAll('tbody tr'));
                return filas.map(f => {
                    const tds = f.querySelectorAll('td');
                    // Verificamos que existan suficientes celdas
                    if (tds.length < 14) return null;

                    return {
                        nombre: tds[2]?.innerText.trim(),      // 3º TD (índice 2)
                        JugadosCasa: tds[4]?.innerText.trim(),          // 5º TD (índice 4)
                        GanadosCasa: tds[5]?.innerText.trim(),           // 6º
                        EmpatadosCasa: tds[6]?.innerText.trim(),           // 7º
                        PerdidosCasa: tds[7]?.innerText.trim(),           // 8º
                        JugadosFuera: tds[8]?.innerText.trim(),          // 9º
                        GanadosFuera: tds[9]?.innerText.trim(),          // 10º
                        EmpatadosFuera: tds[10]?.innerText.trim(),       // 11º
                        PerdidosFuera: tds[11]?.innerText.trim(),  // 12º
                        GolesFavor: tds[12]?.innerText.trim(), // 13º
                        GolesContra: tds[13]?.innerText.trim()       // 14º TD (índice 13)
                    };
                }).filter(e => e !== null);
            });
            if (tablaClas.length > 0) {
                baseDeDatosFutbol.push({ nombre: "Indartsu", tipo: "clasificacion", origen: "Federacion", tabla: tablaClas });
                console.log("✅ Clasificación Indartsu extraída (columnas 3, 5-14)");
            }
        } catch (e) { console.error("❌ Error Clasificación Indartsu"); }
        await pageClasInd.close();

        // --- 3. JUGADORES (LAPREFERENTE) ---
        const jugadoresLP = [
            { nombre: "Ekain Etxebarria", url: "https://www.lapreferente.com/?IDjugador=355665" },
            { nombre: "Eneko Ebro", url: "https://www.lapreferente.com/?IDjugador=355646" },
            { nombre: "Jon García", url: "https://www.lapreferente.com/J355644C22283/cd-derio/jon.html" }
        ];

        for (const j of jugadoresLP) {
            const page = await browser.newPage();
            try {
                await page.goto(j.url, { waitUntil: 'domcontentloaded' });
                const stats = await page.evaluate((n, jE, jD, jC) => {
                    const res = { nombre: n, PJ: "0", NJ: "0", Tit: "0", Sup: "0", Goles: "0", Am: "0", Roj: "0" };
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
                    let jT = 0;
                    if (n === "Ekain Etxebarria") jT = jE;
                    else if (n === "Jon García") jT = jD;
                    else if (n === "Eneko Ebro") jT = jC;
                    res.NJ = Math.max(0, jT - parseInt(res.PJ)).toString();
                    return res;
                }, j.nombre, jEibarB, jDerio, jCartagena);
                baseDeDatosFutbol.push({ tipo: "jugador", origen: "LaPreferente", ...stats });
            } catch (e) { console.error(`❌ Error Jugador ${j.nombre}`); }
            await page.close();
        }

        // --- 4. JUGADORES (FEDERACIÓN) ---
        const jugadoresFED = [
            { nombre: "Gaizka Miralles", url: "https://www.fvf-bff.eus/pnfg/NPcd/NFG_EstadisticasJugador?cod_primaria=3000328&jugador=74876&codacta=9983308" },
            { nombre: "Peio Manrique", url: "https://www.fvf-bff.eus/pnfg/NPcd/NFG_EstadisticasJugador?cod_primaria=3000328&jugador=74062&codacta=9983308" },
            { nombre: "Jon Hermida", url: "https://www.fvf-bff.eus/pnfg/NPcd/NFG_EstadisticasJugador?cod_primaria=3000328&jugador=70074&codacta=9983241" }
        ];

        for (const j of jugadoresFED) {
            const page = await browser.newPage();
            try {
                await page.goto(j.url, { waitUntil: 'networkidle2' });
                const stats = await page.evaluate((n, jI) => {
                    const res = { nombre: n, PJ: "0", NJ: "0", Tit: "0", Sup: "0", Goles: "0", Am: "0", Roj: "0" };
                    const celdas = Array.from(document.querySelectorAll('td'));
                    let biko = 0, gorria = 0;
                    celdas.forEach((td, i) => {
                        const txt = td.innerText.trim();
                        const val = celdas[i + 1]?.innerText.trim() || "0";
                        if (txt === "Jokatutakoak") res.PJ = val;
                        if (txt === "Hamaikakoan") res.Tit = val;
                        if (txt === "Ordezkoa") res.Sup = val;
                        if (txt === "Guztira") res.Goles = val;
                        if (txt === "Txartel horia") res.Am = val;
                        if (txt === "Txartel horia bikoitza") biko = parseInt(val) || 0;
                        if (txt === "Txartel gorria") gorria = parseInt(val) || 0;
                    });
                    res.Roj = (biko + gorria).toString();
                    res.NJ = Math.max(0, jI - parseInt(res.PJ)).toString();
                    return res;
                }, j.nombre, jIndartsu);
                baseDeDatosFutbol.push({ tipo: "jugador", origen: "Federacion", ...stats });
            } catch (e) { console.error(`❌ Error Jugador ${j.nombre}`); }
            await page.close();
        }

        // --- 5. SUBIDA A FIREBASE ---
        if (baseDeDatosFutbol.length > 0) {
            const batch = db.batch();
            baseDeDatosFutbol.forEach(dato => {
                const customId = crearIdDoc(dato.tipo, dato.nombre);
                const docRef = db.collection('seguimiento_futbol').doc(customId);
                const { jornadaNum, origen, tipo, ...datosLimpios } = dato;
                batch.set(docRef, datosLimpios, { merge: true });
            });
            await batch.commit();
            console.log("✅ Firebase actualizado!");
        }

    } catch (error) { console.error("❌ Error General:", error); }
    finally { await browser.close(); }
}

scriptIntegradoFutbol();