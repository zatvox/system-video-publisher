/**
 * tv-player.js - ZV Publicidad Digital
 * ⭐ Núcleo del reproductor de carrusel para Smart TV
 *
 * Lógica:
 * - Polling cada 60 seg para obtener anuncios activos
 * - Cola de rotación determinística (todas las TVs muestran lo mismo)
 * - Prioridad: planes pagos primero, básico en huecos libres
 * - Manejo de imagen (10 seg) y video (hasta 10 seg)
 * - Reconexión automática con backoff
 */

import { supabase } from './supabase-client.js';
import { CONFIG } from './config.js';

// ═══════════════════════════════════════════════════════
// ESTADO DEL REPRODUCTOR
// ═══════════════════════════════════════════════════════

let state = {
  anuncios:       [],       // Cache de anuncios activos
  colaActual:     [],       // Cola de anuncios de la vuelta actual
  indiceActual:   0,        // Índice dentro de la cola
  vueltas:        0,        // Contador de vueltas
  timer:          null,     // Timer de la slide actual
  pollingTimer:   null,     // Timer de polling
  errorCount:     0,        // Para backoff en reconexión
  horaInicio:     8,        // Hora de inicio de transmisión
  horaFin:        19,       // Hora de fin de transmisión
  slots:          6,        // Slots por vuelta
  duracion:       10,       // Segundos por anuncio
  pantallaNombre: 'Smart TV',
  paused:         false,
};

// ═══════════════════════════════════════════════════════
// ELEMENTOS DOM
// ═══════════════════════════════════════════════════════

let elMedia    = null;   // <img> o <video> actual
let elSlide    = null;   // Contenedor de la slide
let elStatus   = null;   // Texto de estado
let elProgress = null;   // Barra de progreso

// ═══════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════

export async function iniciarReproductor() {
  elSlide    = document.getElementById('slide-container');
  elStatus   = document.getElementById('tv-status');
  elProgress = document.getElementById('progress-bar-fill');

  mostrarEstado('Conectando...');

  // Obtener configuración del negocio
  await cargarConfiguracion();

  // Verificar horario
  if (!estaEnHorario()) {
    mostrarFueraDeHorario();
    programarReintento(60000); // Revisar cada minuto
    return;
  }

  // Cargar anuncios y arrancar
  await recargarAnuncios();
  iniciarPolling();
}

// ═══════════════════════════════════════════════════════
// CONFIGURACIÓN DEL NEGOCIO
// ═══════════════════════════════════════════════════════

async function cargarConfiguracion() {
  try {
    const { data } = await supabase
      .from('configuracion_negocio')
      .select('clave, valor')
      .in('clave', ['horario_inicio', 'horario_fin', 'slots_por_vuelta', 'duracion_anuncio_seg']);

    if (data) {
      const cfg = {};
      data.forEach(item => { cfg[item.clave] = item.valor; });

      if (cfg.horario_inicio) state.horaInicio = parseInt(cfg.horario_inicio.split(':')[0]);
      if (cfg.horario_fin)    state.horaFin    = parseInt(cfg.horario_fin.split(':')[0]);
      if (cfg.slots_por_vuelta)    state.slots    = parseInt(cfg.slots_por_vuelta);
      if (cfg.duracion_anuncio_seg) state.duracion = parseInt(cfg.duracion_anuncio_seg);
    }
  } catch (err) {
    console.warn('[TV] No se pudo cargar configuración, usando defaults:', err);
  }
}

// ═══════════════════════════════════════════════════════
// HORARIO DE TRANSMISIÓN
// ═══════════════════════════════════════════════════════

function estaEnHorario() {
  const hora = new Date().getHours();
  return hora >= state.horaInicio && hora < state.horaFin;
}

function mostrarFueraDeHorario() {
  clearTimers();
  if (elSlide) {
    elSlide.innerHTML = `
      <div class="fuera-horario">
        <div class="fuera-horario-icon">📺</div>
        <h1>Transmisión fuera de horario</h1>
        <p>Horario: ${state.horaInicio}:00 – ${state.horaFin}:00</p>
      </div>
    `;
  }
}

// ═══════════════════════════════════════════════════════
// OBTENER ANUNCIOS (POLLING)
// ═══════════════════════════════════════════════════════

async function recargarAnuncios() {
  try {
    const { data, error } = await supabase
      .from('vista_carrusel_actual')
      .select('*');

    if (error) throw error;

    state.anuncios = data || [];
    state.errorCount = 0;

    if (state.anuncios.length === 0) {
      mostrarSinAnuncios();
      return;
    }

    // Si no hay cola activa o la cola terminó, construir una nueva
    if (state.colaActual.length === 0 || state.indiceActual >= state.colaActual.length) {
      construirNuevaCola();
      reproducirSiguiente();
    }

  } catch (err) {
    console.error('[TV] Error cargando anuncios:', err);
    state.errorCount++;
    const delay = Math.min(5000 * state.errorCount, 60000); // Backoff hasta 60s
    mostrarEstado(`Sin conexión. Reintentando en ${Math.round(delay/1000)}s...`);
    programarReintento(delay);
  }
}

function iniciarPolling() {
  clearInterval(state.pollingTimer);
  state.pollingTimer = setInterval(async () => {
    if (!estaEnHorario()) {
      mostrarFueraDeHorario();
      clearInterval(state.pollingTimer);
      programarReintento(60000);
      return;
    }
    await recargarAnuncios();
  }, CONFIG.TV.POLLING_INTERVAL_MS);
}

function programarReintento(ms) {
  setTimeout(async () => {
    await cargarConfiguracion();
    if (estaEnHorario()) {
      await recargarAnuncios();
      iniciarPolling();
    } else {
      mostrarFueraDeHorario();
      programarReintento(60000);
    }
  }, ms);
}

// ═══════════════════════════════════════════════════════
// CONSTRUCCIÓN DE COLA (DETERMINÍSTICA)
// ═══════════════════════════════════════════════════════

/**
 * Construye la cola de slots para la vuelta actual.
 *
 * Algoritmo determinístico:
 *   vueltaIndex = floor(timestamp_unix_en_minutos) % ceil(prioritarios / 6)
 *   Esto garantiza que TODAS las TVs físicas muestren lo mismo
 *   sin depender de estado local por TV.
 */
function construirNuevaCola() {
  const prioritarios = state.anuncios.filter(a => a.prioridad_garantizada);
  const basicos      = state.anuncios.filter(a => !a.prioridad_garantizada);

  const numGrupos = Math.max(1, Math.ceil(prioritarios.length / state.slots));
  const minutoActual = Math.floor(Date.now() / 1000 / 60);
  const vueltaIndex = minutoActual % numGrupos;

  // Seleccionar grupo de prioritarios para esta vuelta
  const inicio = vueltaIndex * state.slots;
  const grupo = prioritarios.slice(inicio, inicio + state.slots);

  // Rellenar huecos con básicos (rotativamente)
  const huecos = state.slots - grupo.length;
  if (huecos > 0 && basicos.length > 0) {
    const basicosGrupoIndex = Math.floor(Date.now() / 1000 / 60 / numGrupos) % Math.max(1, Math.ceil(basicos.length / huecos));
    const basicosInicio = basicosGrupoIndex * huecos;
    const basicosSlice = basicos.slice(basicosInicio, basicosInicio + huecos);
    grupo.push(...basicosSlice);
  }

  // Si no hay anuncios en el grupo, usar todos los disponibles
  state.colaActual = grupo.length > 0 ? grupo : state.anuncios.slice(0, state.slots);
  state.indiceActual = 0;
  state.vueltas++;

  console.log(`[TV] Cola vuelta #${state.vueltas}: ${state.colaActual.length} anuncios (${prioritarios.length} prioritarios, ${basicos.length} básicos)`);
}

// ═══════════════════════════════════════════════════════
// REPRODUCCIÓN
// ═══════════════════════════════════════════════════════

function reproducirSiguiente() {
  if (state.paused) return;

  // Si terminó la cola, construir una nueva
  if (state.indiceActual >= state.colaActual.length) {
    // Esperar al siguiente polling para reconstruir
    // (los anuncios se actualizarán en el próximo tick)
    construirNuevaCola();
  }

  const anuncio = state.colaActual[state.indiceActual];
  if (!anuncio) {
    mostrarSinAnuncios();
    return;
  }

  state.indiceActual++;
  reproducirAnuncio(anuncio);
}

function reproducirAnuncio(anuncio) {
  clearTimeout(state.timer);
  ocultarEstado();

  if (anuncio.tipo === 'video') {
    reproducirVideo(anuncio);
  } else {
    reproducirImagen(anuncio);
  }

  // Registrar aparición de básico (sin await para no bloquear UI)
  if (!anuncio.prioridad_garantizada) {
    registrarAparicionBasico(anuncio.contratacion_id);
  }
}

function reproducirImagen(anuncio) {
  const img = document.createElement('img');
  img.src = anuncio.archivo_url;
  img.alt = 'Anuncio publicitario';
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;';

  animarTransicion(img);

  // Progresar después de duracion_seg
  iniciarProgreso(state.duracion);
  state.timer = setTimeout(reproducirSiguiente, state.duracion * 1000);
}

function reproducirVideo(anuncio) {
  const video = document.createElement('video');
  video.src = anuncio.archivo_url;
  video.muted = true;           // ← OBLIGATORIO en navegadores de TV
  video.autoplay = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'width:100%;height:100%;object-fit:contain;';

  // Forzar reproducción (algunos navegadores bloquean autoplay)
  video.play().catch(() => {
    video.muted = true;
    video.play().catch(err => console.warn('[TV] Autoplay bloqueado:', err));
  });

  animarTransicion(video);
  iniciarProgreso(state.duracion);

  // Siguiente al terminar el video (o a los 10 seg si dura más)
  const timeout = state.duracion * 1000;
  video.addEventListener('ended', reproducirSiguiente, { once: true });
  state.timer = setTimeout(() => {
    video.pause();
    reproducirSiguiente();
  }, timeout);
}

function animarTransicion(elemento) {
  if (!elSlide) return;

  // Fade out del anterior
  elSlide.style.opacity = '0';
  setTimeout(() => {
    elSlide.innerHTML = '';
    elSlide.appendChild(elemento);
    elSlide.style.opacity = '1';
  }, 300);
}

function iniciarProgreso(segundos) {
  if (!elProgress) return;
  elProgress.style.transition = 'none';
  elProgress.style.width = '0%';

  requestAnimationFrame(() => {
    elProgress.style.transition = `width ${segundos}s linear`;
    elProgress.style.width = '100%';
  });
}

// ═══════════════════════════════════════════════════════
// REGISTRAR APARICIÓN BÁSICO
// ═══════════════════════════════════════════════════════

async function registrarAparicionBasico(contratacionId) {
  try {
    await supabase.rpc('registrar_aparicion_basico', {
      p_contratacion_id: contratacionId
    });
  } catch (err) {
    console.warn('[TV] No se pudo registrar aparición básica:', err);
  }
}

// ═══════════════════════════════════════════════════════
// ESTADOS UI
// ═══════════════════════════════════════════════════════

function mostrarEstado(texto) {
  if (elStatus) {
    elStatus.textContent = texto;
    elStatus.style.display = 'block';
  }
  if (elSlide) elSlide.innerHTML = '';
}

function ocultarEstado() {
  if (elStatus) elStatus.style.display = 'none';
}

function mostrarSinAnuncios() {
  clearTimers();
  if (elSlide) {
    elSlide.innerHTML = `
      <div class="tv-standby">
        <div class="standby-logo">ZV</div>
        <p>ZV Publicidad Digital</p>
      </div>
    `;
  }
  // Reintentar en 30 segundos
  setTimeout(async () => {
    await recargarAnuncios();
  }, 30000);
}

// ═══════════════════════════════════════════════════════
// LIMPIEZA
// ═══════════════════════════════════════════════════════

function clearTimers() {
  clearTimeout(state.timer);
  clearInterval(state.pollingTimer);
}

// ═══════════════════════════════════════════════════════
// HEARTBEAT (para pantallas registradas)
// ═══════════════════════════════════════════════════════

export async function iniciarHeartbeat(pantallaNombre) {
  // Buscar la pantalla por nombre para obtener su ID
  const { data } = await supabase
    .from('pantallas')
    .select('id')
    .eq('nombre', pantallaNombre)
    .single();

  if (!data) return;

  const pantallaId = data.id;

  // Heartbeat cada 5 minutos
  const enviarHeartbeat = async () => {
    await supabase
      .from('pantallas')
      .update({ ultima_conexion: new Date().toISOString() })
      .eq('id', pantallaId);
  };

  await enviarHeartbeat();
  setInterval(enviarHeartbeat, 5 * 60 * 1000);
}
