import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import {
  getDatabase,
  ref,
  onValue,
  set
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-database.js';

// Configuración pública de la aplicación web Firebase.
// Nunca colocar contraseñas ni tokens privados en este archivo.
const firebaseConfig = {
  apiKey: 'AIzaSyAwxkQo1ojwXKmOxff0MX9bKu-DWUsGnPs',
  authDomain: 'casa-inteligente-led.firebaseapp.com',
  databaseURL: 'https://casa-inteligente-led-default-rtdb.firebaseio.com',
  projectId: 'casa-inteligente-led',
  storageBucket: 'casa-inteligente-led.firebasestorage.app',
  messagingSenderId: '615314276846',
  appId: '1:615314276846:web:c6f2c91261401cc6140eff'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (id) => document.getElementById(id);
const ledNames = ['led1', 'led2', 'led3', 'led4'];
const ledCards = Object.fromEntries(
  ledNames.map(name => [
    name,
    document.querySelector(`[data-led="${name}"]`)
  ])
);

let unsubscribers = [];
let states = null;
let commands = null;
let streamReady = { states: false, commands: false };
let currentUser = null;
let pending = {};
let databaseError = '';

function showError(where, message) {
  const el = $(where);
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function connection(label, detail, kind = '') {
  $('connectionLabel').textContent = label;
  $('connectionDetail').textContent = detail;
  $('connectionDot').className = `connection-dot ${kind}`;
}

function authErrorMessage(error) {
  const codes = {
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/invalid-email': 'El formato del correo no es válido.',
    'auth/too-many-requests': 'Demasiados intentos. Intenta más tarde.',
    'auth/network-request-failed': 'No se pudo conectar. Verifica Internet.',
    'auth/user-disabled': 'Esta cuenta está deshabilitada.',
    'auth/unauthorized-domain': 'Dominio no autorizado. Revisa Firebase Authentication.',
    'auth/operation-not-allowed': 'El acceso con correo y contraseña no está habilitado en Firebase.',
    'auth/user-not-found': 'No existe un usuario con ese correo.',
    'auth/wrong-password': 'La contraseña es incorrecta.'
  };

  return codes[error.code] ||
    `No se pudo iniciar sesión (${error.code || 'error desconocido'}).`;
}

function resetSubscriptions() {
  for (const unsubscribe of unsubscribers) unsubscribe();
  unsubscribers = [];

  for (const value of Object.values(pending)) {
    clearTimeout(value.timeout);
  }

  pending = {};
  states = null;
  commands = null;
  databaseError = '';
  streamReady = { states: false, commands: false };
}

function render() {
  for (const name of ledNames) {
    const card = ledCards[name];

    if (!card) {
      console.error(`No se encontró la tarjeta HTML para ${name}.`);
      continue;
    }

    const state = states?.[name];
    const command = commands?.[name];
    const known = typeof state === 'boolean';
    const waiting = !!pending[name];

    const pill = card.querySelector('[data-state]');
    const detail = card.querySelector('[data-detail]');
    const button = card.querySelector('[data-toggle]');

    if (!pill || !detail || !button) {
      console.error(`Faltan elementos HTML dentro de la tarjeta ${name}.`);
      continue;
    }

    card.classList.toggle('on', known && state);

    pill.textContent = known
      ? (state ? 'Encendido' : 'Apagado')
      : 'Sin datos';

    detail.textContent = waiting
      ? 'Orden enviada; esperando confirmación…'
      : !known
        ? 'Sin lectura del ESP32'
        : (
            typeof command === 'boolean' && command !== state
              ? 'Orden y estado todavía no coinciden'
              : 'Estado informado por el ESP32'
          );

    button.disabled =
      !currentUser ||
      !streamReady.states ||
      !streamReady.commands ||
      !known ||
      waiting ||
      !!databaseError;

    button.textContent = waiting
      ? 'Confirmando…'
      : !known
        ? 'Esperando datos'
        : state
          ? 'Apagar luz'
          : 'Encender luz';
  }
}

function watchDatabase() {
  const onReadError = (error) => {
    databaseError = error.message || 'Sin permisos para consultar Realtime Database';
    showError('dashboardError', `No se pudieron leer los datos: ${databaseError}`);
    connection('Error de lectura', 'Verifica las reglas de Firebase', 'bad');
    render();
  };

  const statesRef = ref(db, 'domotica/estados');
  const commandsRef = ref(db, 'domotica/comandos');

  unsubscribers.push(
    onValue(statesRef, (snapshot) => {
      states = snapshot.val() || {};
      streamReady.states = true;

      $('lastData').textContent = new Date().toLocaleString('es-BO');

      if (!databaseError) {
        connection(
          'Datos de Firebase recibidos',
          'Esto no verifica que el ESP32 esté en línea',
          'good'
        );
      }

      for (const [name, entry] of Object.entries(pending)) {
        if (states?.[name] === entry.expected) {
          clearTimeout(entry.timeout);
          delete pending[name];
        }
      }

      render();
    }, onReadError)
  );

  unsubscribers.push(
    onValue(commandsRef, (snapshot) => {
      commands = snapshot.val() || {};
      streamReady.commands = true;
      render();
    }, onReadError)
  );
}

// Inicio de sesión.
$('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('loginError', '');

  const button = $('loginBtn');
  button.disabled = true;
  button.textContent = 'Verificando acceso…';

  try {
    await signInWithEmailAndPassword(
      auth,
      $('email').value.trim(),
      $('password').value
    );
  } catch (error) {
    showError('loginError', authErrorMessage(error));
  } finally {
    $('password').value = '';
    button.disabled = false;
    button.textContent = 'Entrar al panel →';
  }
});

// Cerrar sesión.
$('logoutBtn').addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showError('dashboardError', `No se pudo cerrar la sesión: ${error.message}`);
  }
});

// Controles individuales de los cuatro LED.
for (const name of ledNames) {
  const card = ledCards[name];

  if (!card) {
    console.error(`No se encontró la tarjeta HTML para ${name}.`);
    continue;
  }

  card.querySelector('[data-toggle]').addEventListener('click', async () => {
    if (
      !currentUser ||
      databaseError ||
      pending[name] ||
      !streamReady.states ||
      !streamReady.commands ||
      typeof states?.[name] !== 'boolean'
    ) {
      return;
    }

    const expected = !states[name];

    const timeout = setTimeout(() => {
      if (pending[name]?.expected === expected) {
        delete pending[name];

        showError(
          'dashboardError',
          `No llegó confirmación del ESP32 para ${name}. Revisa la conexión del dispositivo; el estado mostrado sigue siendo el último recibido.`
        );

        render();
      }
    }, 15000);

    pending[name] = { expected, timeout };
    showError('dashboardError', '');
    render();

    try {
      await set(ref(db, `domotica/comandos/${name}`), expected);
    } catch (error) {
      clearTimeout(timeout);
      delete pending[name];

      showError(
        'dashboardError',
        `No se pudo enviar la orden a ${name}: ${error.message}`
      );

      render();
    }
  });
}

// Restaurar o detectar la sesión al cargar la página.
onAuthStateChanged(auth, (user) => {
  resetSubscriptions();
  currentUser = user || null;

  $('loginView').hidden = !!currentUser;
  $('dashboardView').hidden = !currentUser;
  $('account').hidden = !currentUser;

  if (!currentUser) {
    render();
    return;
  }

  $('accountEmail').textContent = currentUser.email || 'Usuario';
  showError('dashboardError', '');

  connection(
    'Conectando a Firebase…',
    'Cargando comandos y estados'
  );

  render();
  watchDatabase();
});
