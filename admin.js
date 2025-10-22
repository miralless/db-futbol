import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ==== CONFIG FIREBASE ====
const firebaseConfig = {
apiKey: "AIzaSyDpjK4HsS4X4XmTzdjnRTTjlPJBuXzXAw4",
authDomain: "db-futbol.firebaseapp.com",
projectId: "db-futbol",
storageBucket: "db-futbol.appspot.com",
messagingSenderId: "533304962889",
appId: "1:533304962889:web:86243092a1ddcf89323498"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ==== URLs Magic Loops ====
const loop1 = "https://magicloops.dev/api/loop/ff5cf494-d83a-4abd-894f-87459cbd8856/run"; // Jugadores
const loop2 = "https://magicloops.dev/api/loop/172f72ab-319e-4809-8f79-afb1d88aae1b/run"; // Equipos

// URLs de jugadores (input para loop1)
const inputUrls = [
"https://es.besoccer.com/jugador/ekain-1023338",
"https://es.besoccer.com/jugador/eneko-9999999",
"https://es.besoccer.com/jugador/jon-8888888"
];

const btn = document.getElementById("btnEjecutar");
const statusText = document.getElementById("statusText");

async function ejecutarLoop1() {
const inputTexto = inputUrls.join("\n");
const resp = await fetch(`${loop1}?input=${encodeURIComponent(inputTexto)}`);
if (!resp.ok) throw new Error("Error en Loop 1");
return await resp.json();
}

async function ejecutarLoop2() {
const resp = await fetch(`${loop2}?input=${encodeURIComponent("Hello World")}`, { method: "POST" });
if (!resp.ok) throw new Error("Error en Loop 2");
return await resp.json();
}

async function guardarEnFirebase(jugadores, equipos) {
const ref = doc(db, "loops", "datosLoops");
await setDoc(ref, {
    jugadores: jugadores,
    equipos: equipos,
    fechaActualizacion: new Date().toISOString()
});
}

btn.addEventListener("click", async () => {
try {
    btn.disabled = true;
    statusText.textContent = "⏳ Ejecutando loops...";

    const [jugadoresData, equiposData] = await Promise.all([
    ejecutarLoop1(),
    ejecutarLoop2()
    ]);

    statusText.textContent = "💾 Guardando en Firebase...";
    await guardarEnFirebase(jugadoresData, equiposData);

    statusText.textContent = "✅ Datos guardados correctamente.";
} catch (error) {
    console.error(error);
    statusText.textContent = "❌ Error al ejecutar los loops o guardar datos.";
} finally {
    btn.disabled = false;
}
});
