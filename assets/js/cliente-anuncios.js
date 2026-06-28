/**
 * cliente-anuncios.js - ZV Publicidad Digital
 * Módulo "Mis Anuncios" del panel cliente
 * Incluye el editor de recorte de video (ffmpeg.wasm)
 */

import { requireAuth } from './auth.js';
import { initPanel } from './main.js';
import {
  misAnuncios, crearAnuncio, activarAnuncio, eliminarAnuncio,
  subirAnuncio, contratacionActivaActual
} from './supabase-data.js';
import {
  toast, confirmar, showLoading, hideLoading,
  escapeHtml, formatearFecha, tiempoRelativo,
  validarTamanoArchivo, validarTipoArchivo
} from './utils.js';
import { CONFIG } from './config.js';

// ═══════════════════════════════════════════════════════
// ESTADO DEL MÓDULO
// ═══════════════════════════════════════════════════════

let perfil = null;
let contratacion = null;
let anuncios = [];
let ffmpegLoaded = false;
let ffmpegInstance = null;

// Video en edición
let videoFile = null;
let videoUrl = null;
let trimStart = 0;

// ═══════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════

async function init() {
  perfil = await requireAuth('cliente');
  if (!perfil) return;

  initPanel(perfil);

  // Cargar contratación activa
  const { data: cont } = await contratacionActivaActual();
  contratacion = cont;

  renderEstadoContratacion();
  await cargarAnuncios();
  bindEventos();
}

// ═══════════════════════════════════════════════════════
// ESTADO DE CONTRATACIÓN
// ═══════════════════════════════════════════════════════

function renderEstadoContratacion() {
  const banner = document.getElementById('banner-contratacion');
  const btnSubir = document.getElementById('btn-subir-anuncio');

  if (!contratacion) {
    if (banner) {
      banner.className = 'alert alert-warning';
      banner.innerHTML = `
        <span class="alert-icon">⚠️</span>
        <div>
          <strong>No tienes un plan activo</strong>
          Para subir anuncios necesitas contratar un plan.
          <a href="recargar.html" class="btn btn-sm btn-primary" style="margin-left:8px">Ver planes</a>
        </div>
      `;
    }
    if (btnSubir) btnSubir.disabled = true;
    return;
  }

  const plan = contratacion.planes;
  const diasRestantes = Math.max(0, Math.ceil(
    (new Date(contratacion.fecha_fin) - Date.now()) / 86400000
  ));

  if (banner) {
    banner.className = 'alert alert-success';
    banner.innerHTML = `
      <span class="alert-icon">✅</span>
      <div>
        <strong>Plan ${escapeHtml(plan.nombre)} activo</strong>
        Vence en ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''}
        (${formatearFecha(contratacion.fecha_fin)}).
        ${plan.permite_multiples_anuncios
          ? ' <span style="color:var(--color-primary)">Puedes cambiar tu anuncio activo en cualquier momento.</span>'
          : ''
        }
      </div>
    `;
  }

  if (btnSubir) {
    // Deshabilitar si el plan no permite múltiples y ya tiene un anuncio
    if (!plan.permite_multiples_anuncios && anuncios.length > 0) {
      btnSubir.disabled = true;
      btnSubir.title = 'Tu plan solo permite un anuncio por contratación';
    } else {
      btnSubir.disabled = false;
    }
  }
}

// ═══════════════════════════════════════════════════════
// CARGAR Y RENDERIZAR ANUNCIOS
// ═══════════════════════════════════════════════════════

async function cargarAnuncios() {
  showLoading('Cargando tus anuncios...');
  const { data, error } = await misAnuncios();
  hideLoading();

  if (error) {
    toast.error('No se pudieron cargar los anuncios');
    return;
  }

  anuncios = data || [];
  renderAnuncios();
  renderEstadoContratacion(); // Re-evaluar botón de subir
}

function renderAnuncios() {
  const grid = document.getElementById('anuncios-grid');
  const empty = document.getElementById('anuncios-empty');

  if (!grid) return;

  if (anuncios.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }

  if (empty) empty.style.display = 'none';

  grid.innerHTML = anuncios.map(a => {
    const cont = a.contrataciones;
    const planNombre = cont?.planes?.nombre || '—';
    const esActivo = a.es_activo && cont?.estado === 'activo';
    const esMensual = cont?.planes?.tipo === 'mensual';

    const preview = a.tipo === 'video'
      ? `<video src="${escapeHtml(a.archivo_url)}" muted playsinline preload="metadata"
           style="width:100%;height:100%;object-fit:cover"
           onmouseenter="this.play()" onmouseleave="this.pause()"></video>`
      : `<img src="${escapeHtml(a.archivo_url)}" alt="Anuncio" style="width:100%;height:100%;object-fit:cover">`;

    return `
      <div class="anuncio-card" data-id="${a.id}">
        <div class="anuncio-preview">
          ${preview}
          <span class="anuncio-type-badge">${a.tipo === 'video' ? '🎬 Video' : '🖼️ Imagen'}</span>
          ${esActivo ? '<span class="anuncio-active-badge">En aire</span>' : ''}
        </div>
        <div class="anuncio-info">
          <div class="anuncio-meta">
            Plan ${escapeHtml(planNombre)} • Subido ${tiempoRelativo(a.created_at)}
          </div>
          <div class="anuncio-actions">
            ${esMensual && !esActivo ? `
              <button class="btn btn-sm btn-success btn-activar" data-id="${a.id}" data-contratacion="${a.contratacion_id}">
                ▶ Activar
              </button>
            ` : ''}
            <button class="btn btn-sm btn-ghost btn-preview" data-url="${escapeHtml(a.archivo_url)}" data-tipo="${a.tipo}">
              👁 Ver
            </button>
            ${!esActivo ? `
              <button class="btn btn-sm btn-danger btn-eliminar" data-id="${a.id}" data-url="${escapeHtml(a.archivo_url)}">
                🗑
              </button>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════

function bindEventos() {
  // Botón subir anuncio
  const btnSubir = document.getElementById('btn-subir-anuncio');
  if (btnSubir) btnSubir.addEventListener('click', abrirModalSubir);

  // Delegación de eventos en el grid
  const grid = document.getElementById('anuncios-grid');
  if (grid) {
    grid.addEventListener('click', async (e) => {
      const btnActivar = e.target.closest('.btn-activar');
      const btnPreview = e.target.closest('.btn-preview');
      const btnEliminar = e.target.closest('.btn-eliminar');

      if (btnActivar) await handleActivar(btnActivar);
      if (btnPreview) abrirPreview(btnPreview.dataset.url, btnPreview.dataset.tipo);
      if (btnEliminar) await handleEliminar(btnEliminar);
    });
  }

  // Upload zone
  const zone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');

  if (zone && fileInput) {
    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) procesarArchivoSeleccionado(file);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) procesarArchivoSeleccionado(fileInput.files[0]);
    });
  }

  // Botón confirmar upload
  const btnConfirmar = document.getElementById('btn-confirmar-subida');
  if (btnConfirmar) btnConfirmar.addEventListener('click', handleConfirmarSubida);

  // Modal cerrar
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
      resetearUploadZone();
    });
  });
}

// ═══════════════════════════════════════════════════════
// ACTIVAR ANUNCIO (Plan Mensual)
// ═══════════════════════════════════════════════════════

async function handleActivar(btn) {
  const id = btn.dataset.id;
  const contratacionId = btn.dataset.contratacion;

  const ok = await confirmar({
    titulo: 'Cambiar anuncio activo',
    mensaje: 'Este anuncio reemplazará al anuncio activo actual desde la siguiente vuelta del carrusel.',
    textoConfirmar: 'Activar',
    tipoBtnConfirmar: 'primary'
  });

  if (!ok) return;

  showLoading('Activando anuncio...');
  const { error } = await activarAnuncio(id, contratacionId);
  hideLoading();

  if (error) {
    toast.error('No se pudo activar el anuncio');
  } else {
    toast.success('Anuncio activado. Aparecerá en la próxima vuelta del carrusel.');
    await cargarAnuncios();
  }
}

// ═══════════════════════════════════════════════════════
// ELIMINAR ANUNCIO
// ═══════════════════════════════════════════════════════

async function handleEliminar(btn) {
  const ok = await confirmar({
    titulo: 'Eliminar anuncio',
    mensaje: 'Se eliminará permanentemente este anuncio y su archivo. ¿Continuar?',
    textoConfirmar: 'Eliminar',
    tipoBtnConfirmar: 'danger'
  });

  if (!ok) return;

  showLoading('Eliminando...');
  const { error } = await eliminarAnuncio(btn.dataset.id, btn.dataset.url);
  hideLoading();

  if (error) {
    toast.error('No se pudo eliminar el anuncio');
  } else {
    toast.success('Anuncio eliminado');
    await cargarAnuncios();
  }
}

// ═══════════════════════════════════════════════════════
// MODAL DE SUBIDA
// ═══════════════════════════════════════════════════════

function abrirModalSubir() {
  const modal = document.getElementById('modal-subir');
  if (modal) {
    modal.style.display = 'flex';
    document.getElementById('modal-subir').classList.remove('hidden');
  }
}

function resetearUploadZone() {
  videoFile = null;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
  trimStart = 0;
  const zone = document.getElementById('upload-zone');
  if (zone) zone.innerHTML = `
    <div class="file-upload-icon">📁</div>
    <p class="file-upload-text">Arrastra tu archivo aquí o <strong>haz click para seleccionar</strong></p>
    <p class="file-upload-hint">Video MP4 (máx. ${CONFIG.STORAGE.MAX_SIZE_VIDEO_MB}MB) o Imagen JPG/PNG (máx. ${CONFIG.STORAGE.MAX_SIZE_IMG_MB}MB)</p>
  `;
  const trimEditor = document.getElementById('trim-editor');
  if (trimEditor) trimEditor.style.display = 'none';
  const btnConfirmar = document.getElementById('btn-confirmar-subida');
  if (btnConfirmar) btnConfirmar.disabled = true;
}

// ═══════════════════════════════════════════════════════
// PROCESAR ARCHIVO SELECCIONADO
// ═══════════════════════════════════════════════════════

async function procesarArchivoSeleccionado(file) {
  const esVideo = CONFIG.STORAGE.TIPOS_VIDEO.includes(file.type);
  const esImagen = CONFIG.STORAGE.TIPOS_IMAGEN.includes(file.type);
  const maxMb = esVideo ? CONFIG.STORAGE.MAX_SIZE_VIDEO_MB : CONFIG.STORAGE.MAX_SIZE_IMG_MB;

  if (!esVideo && !esImagen) {
    toast.error('Formato no válido. Usa MP4, JPG o PNG.');
    return;
  }

  if (!validarTamanoArchivo(file, maxMb)) {
    toast.error(`El archivo supera el límite de ${maxMb}MB`);
    return;
  }

  videoFile = file;
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);

  if (esVideo) {
    // Verificar duración del video
    const duracion = await obtenerDuracionVideo(videoUrl);
    if (duracion > CONFIG.TV.DURACION_ANUNCIO_SEG) {
      // Mostrar editor de recorte
      mostrarEditorRecorte(videoUrl, duracion);
    } else {
      // Video de 10 seg o menos: subir directo
      mostrarArchivoListo(file, null);
    }
  } else {
    // Imagen: subir directo
    mostrarArchivoListo(file, null);
  }
}

function obtenerDuracionVideo(url) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = url;
    video.onloadedmetadata = () => resolve(video.duration);
    video.onerror = () => resolve(0);
  });
}

// ═══════════════════════════════════════════════════════
// PREVIEW DE ARCHIVO LISTO (sin recorte necesario)
// ═══════════════════════════════════════════════════════

function mostrarArchivoListo(file, _trimInfo) {
  const zone = document.getElementById('upload-zone');
  const btnConfirmar = document.getElementById('btn-confirmar-subida');
  const isVideo = file.type.startsWith('video/');

  if (zone) {
    zone.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px">
        <span style="font-size:2rem">${isVideo ? '🎬' : '🖼️'}</span>
        <div>
          <p style="font-weight:600;color:var(--text-primary)">${escapeHtml(file.name)}</p>
          <p style="font-size:0.75rem;color:var(--text-muted)">${(file.size/1048576).toFixed(1)} MB • Listo para subir</p>
        </div>
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('file-input').click()">Cambiar</button>
      </div>
    `;
  }

  if (btnConfirmar) btnConfirmar.disabled = false;
}

// ═══════════════════════════════════════════════════════
// EDITOR DE RECORTE DE VIDEO — estilo online-video-cutter
// Usa @ffmpeg/ffmpeg v0.12 + @ffmpeg/core v0.12.6 (single-thread)
// No requiere SharedArrayBuffer ni headers COOP/COEP
// ═══════════════════════════════════════════════════════

function fmtTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, '0');
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function mostrarEditorRecorte(url, duracionTotal) {
  const editorContainer = document.getElementById('trim-editor');
  if (!editorContainer) return;

  const DUR = CONFIG.TV.DURACION_ANUNCIO_SEG; // 10
  trimStart = 0;

  editorContainer.style.display = 'block';
  editorContainer.innerHTML = `
    <div style="
      background:#1a1a2e;
      border-radius:12px;
      overflow:hidden;
      border:1px solid rgba(255,255,255,0.1);
    ">
      <!-- Header -->
      <div style="
        background:#16213e;
        padding:14px 20px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        border-bottom:1px solid rgba(255,255,255,0.08);
      ">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1.2rem">✂️</span>
          <div>
            <div style="color:#fff;font-weight:600;font-size:0.95rem">Recortar video</div>
            <div style="color:#8899aa;font-size:0.78rem">Duración total: ${fmtTime(duracionTotal)} (${duracionTotal.toFixed(1)}s)</div>
          </div>
        </div>
        <div style="
          background:rgba(27,79,216,0.25);
          border:1px solid rgba(27,79,216,0.5);
          color:#7eb3ff;
          padding:4px 12px;
          border-radius:20px;
          font-size:0.8rem;
          font-weight:500;
        ">Segmento: ${DUR} segundos</div>
      </div>

      <!-- Video player -->
      <div style="background:#000;display:flex;justify-content:center;max-height:320px;overflow:hidden">
        <video id="trim-video" src="${url}"
          style="max-width:100%;max-height:320px;display:block"
          preload="auto"
        ></video>
      </div>

      <!-- Controles de reproducción -->
      <div style="background:#111827;padding:10px 20px;display:flex;align-items:center;gap:12px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <button id="trim-btn-play" style="
          background:rgba(255,255,255,0.1);
          border:none;color:#fff;
          width:36px;height:36px;
          border-radius:50%;
          cursor:pointer;font-size:1rem;
          display:flex;align-items:center;justify-content:center;
          transition:background .15s;
        ">▶</button>
        <div style="flex:1;position:relative;height:4px;background:rgba(255,255,255,0.15);border-radius:2px;cursor:pointer" id="trim-progreso-video">
          <div id="trim-progreso-fill" style="height:100%;background:#1b4fd8;border-radius:2px;width:0%;pointer-events:none"></div>
          <div id="trim-progreso-thumb" style="
            position:absolute;top:50%;transform:translate(-50%,-50%);
            width:12px;height:12px;border-radius:50%;
            background:#fff;left:0%;pointer-events:none;
          "></div>
        </div>
        <span id="trim-tiempo-actual" style="color:#8899aa;font-size:0.8rem;min-width:50px;text-align:right">00:00</span>
      </div>

      <!-- Timeline de recorte -->
      <div style="padding:20px">
        <div style="color:#8899aa;font-size:0.8rem;margin-bottom:8px;display:flex;justify-content:space-between">
          <span>0:00</span>
          <span style="color:#cdd6f4;font-weight:500">Arrastra el bloque azul para elegir el segmento</span>
          <span>${fmtTime(duracionTotal)}</span>
        </div>

        <!-- Barra timeline -->
        <div id="trim-timeline" style="
          position:relative;
          height:56px;
          background:#0f172a;
          border-radius:8px;
          cursor:pointer;
          user-select:none;
          overflow:hidden;
          border:1px solid rgba(255,255,255,0.08);
        ">
          <!-- Fondo de waveform simulado -->
          <div id="trim-waveform" style="
            position:absolute;inset:0;
            display:flex;align-items:center;
            padding:0 2px;gap:1px;opacity:0.3;
          "></div>

          <!-- Bloque de selección -->
          <div id="trim-handle" style="
            position:absolute;top:0;bottom:0;
            background:rgba(27,79,216,0.45);
            border:2px solid #1b4fd8;
            border-radius:4px;
            cursor:grab;
            left:0%;
            width:${(DUR / duracionTotal * 100).toFixed(2)}%;
            box-sizing:border-box;
            display:flex;align-items:center;justify-content:center;
            transition:background .1s;
          ">
            <div style="
              background:rgba(255,255,255,0.15);
              border-radius:3px;
              padding:2px 6px;
              font-size:0.7rem;
              color:#fff;
              white-space:nowrap;
              pointer-events:none;
            " id="trim-handle-label">${fmtTime(0)} → ${fmtTime(DUR)}</div>
          </div>

          <!-- Línea de posición actual del video -->
          <div id="trim-pos-line" style="
            position:absolute;top:0;bottom:0;
            width:2px;background:#facc15;
            pointer-events:none;left:0%;
          "></div>
        </div>

        <!-- Tiempos del segmento -->
        <div style="
          display:flex;justify-content:space-between;
          margin-top:10px;
          background:rgba(27,79,216,0.15);
          border:1px solid rgba(27,79,216,0.3);
          border-radius:8px;
          padding:10px 16px;
        ">
          <div style="text-align:center">
            <div style="color:#8899aa;font-size:0.72rem;margin-bottom:2px">INICIO DEL CORTE</div>
            <div style="color:#7eb3ff;font-weight:700;font-size:1.1rem" id="trim-label-desde">${fmtTime(0)}</div>
            <div style="color:#8899aa;font-size:0.72rem" id="trim-seg-desde">0.0s</div>
          </div>
          <div style="text-align:center;border-left:1px solid rgba(255,255,255,0.1);border-right:1px solid rgba(255,255,255,0.1);padding:0 20px">
            <div style="color:#8899aa;font-size:0.72rem;margin-bottom:2px">DURACIÓN</div>
            <div style="color:#fff;font-weight:700;font-size:1.1rem">${DUR}s</div>
            <div style="color:#8899aa;font-size:0.72rem">fijo</div>
          </div>
          <div style="text-align:center">
            <div style="color:#8899aa;font-size:0.72rem;margin-bottom:2px">FIN DEL CORTE</div>
            <div style="color:#7eb3ff;font-weight:700;font-size:1.1rem" id="trim-label-hasta">${fmtTime(DUR)}</div>
            <div style="color:#8899aa;font-size:0.72rem" id="trim-seg-hasta">${DUR.toFixed(1)}s</div>
          </div>
        </div>

        <!-- Info mensaje -->
        <div id="trim-info-msg" style="
          margin-top:10px;
          color:#94a3b8;
          font-size:0.82rem;
          text-align:center;
        ">
          Se publicará del segundo <strong style="color:#7eb3ff" id="trim-msg-desde">0.0</strong>
          al <strong style="color:#7eb3ff" id="trim-msg-hasta">${DUR.toFixed(1)}</strong>
          de tu video de ${duracionTotal.toFixed(1)}s
        </div>
      </div>

      <!-- Botones de acción -->
      <div style="
        padding:16px 20px;
        background:#111827;
        display:flex;gap:12px;justify-content:flex-end;
        border-top:1px solid rgba(255,255,255,0.06);
      ">
        <button id="btn-preview-recorte" class="btn" style="
          background:transparent;color:#e2e8f0;
          border:1px solid rgba(255,255,255,0.25);
          display:flex;align-items:center;gap:6px;
        ">
          <span id="trim-preview-icon">▶</span> Vista previa del recorte
        </button>
        <button id="btn-confirmar-recorte" class="btn btn-primary" style="display:flex;align-items:center;gap:6px;">
          ✂️ Confirmar y guardar
        </button>
      </div>

      <!-- Procesando overlay -->
      <div id="trim-procesando" style="display:none;padding:16px 20px;background:#111827;border-top:1px solid rgba(255,255,255,0.06)">
        <div style="display:flex;align-items:center;gap:12px;color:#e2e8f0;margin-bottom:10px">
          <div class="spinner spinner-sm"></div>
          <span id="trim-progreso-texto">Preparando procesador de video...</span>
        </div>
        <div style="background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;height:6px">
          <div id="trim-progress-fill" style="height:100%;background:#1b4fd8;width:0%;transition:width .3s"></div>
        </div>
      </div>
    </div>
  `;

  // ── Waveform decorativo ──────────────────────────────
  const waveEl = document.getElementById('trim-waveform');
  for (let i = 0; i < 80; i++) {
    const bar = document.createElement('div');
    const h = 20 + Math.random() * 60;
    bar.style.cssText = `flex:1;background:rgba(255,255,255,0.6);border-radius:1px;height:${h}%`;
    waveEl.appendChild(bar);
  }

  // ── Referencias DOM ──────────────────────────────────
  const video       = document.getElementById('trim-video');
  const timeline    = document.getElementById('trim-timeline');
  const handle      = document.getElementById('trim-handle');
  const handleLabel = document.getElementById('trim-handle-label');
  const posLine     = document.getElementById('trim-pos-line');
  const labelDesde  = document.getElementById('trim-label-desde');
  const labelHasta  = document.getElementById('trim-label-hasta');
  const segDesde    = document.getElementById('trim-seg-desde');
  const segHasta    = document.getElementById('trim-seg-hasta');
  const msgDesde    = document.getElementById('trim-msg-desde');
  const msgHasta    = document.getElementById('trim-msg-hasta');
  const btnPlay     = document.getElementById('trim-btn-play');
  const progresoBar = document.getElementById('trim-progreso-fill');
  const progresoThumb = document.getElementById('trim-progreso-thumb');
  const tiempoEl   = document.getElementById('trim-tiempo-actual');
  const progresoVideo = document.getElementById('trim-progreso-video');

  const handleWidthPct = (DUR / duracionTotal) * 100;

  function actualizarUI() {
    const leftPct = (trimStart / duracionTotal) * 100;
    handle.style.left = `${leftPct}%`;
    handleLabel.textContent = `${fmtTime(trimStart)} → ${fmtTime(trimStart + DUR)}`;
    labelDesde.textContent = fmtTime(trimStart);
    labelHasta.textContent = fmtTime(trimStart + DUR);
    segDesde.textContent   = `${trimStart.toFixed(1)}s`;
    segHasta.textContent   = `${(trimStart + DUR).toFixed(1)}s`;
    msgDesde.textContent   = trimStart.toFixed(1);
    msgHasta.textContent   = (trimStart + DUR).toFixed(1);
  }

  // ── Drag del bloque de selección ─────────────────────
  let dragging = false;
  let dragOffsetX = 0;

  function startDrag(clientX) {
    dragging = true;
    const rect = timeline.getBoundingClientRect();
    const handleLeft = (trimStart / duracionTotal) * rect.width;
    dragOffsetX = clientX - rect.left - handleLeft;
    handle.style.cursor = 'grabbing';
  }

  function moveDrag(clientX) {
    if (!dragging) return;
    const rect = timeline.getBoundingClientRect();
    const x = clientX - rect.left - dragOffsetX;
    const maxX = rect.width * (1 - handleWidthPct / 100);
    const clampedX = Math.max(0, Math.min(x, maxX));
    trimStart = (clampedX / rect.width) * duracionTotal;
    trimStart = Math.max(0, Math.min(trimStart, duracionTotal - DUR));
    actualizarUI();
    if (video && !video.paused) { /* no interrumpir reproducción */ }
    else if (video) video.currentTime = trimStart;
  }

  function endDrag() {
    dragging = false;
    handle.style.cursor = 'grab';
  }

  handle.addEventListener('mousedown',  e => { e.preventDefault(); startDrag(e.clientX); });
  document.addEventListener('mousemove', e => moveDrag(e.clientX));
  document.addEventListener('mouseup',   endDrag);
  handle.addEventListener('touchstart',  e => { e.preventDefault(); startDrag(e.touches[0].clientX); }, { passive: false });
  document.addEventListener('touchmove',  e => { if (dragging) { e.preventDefault(); moveDrag(e.touches[0].clientX); } }, { passive: false });
  document.addEventListener('touchend',   endDrag);

  // Click directo en el timeline (fuera del handle)
  timeline.addEventListener('click', e => {
    if (e.target === handle || handle.contains(e.target)) return;
    const rect = timeline.getBoundingClientRect();
    const x = e.clientX - rect.left;
    trimStart = Math.max(0, Math.min((x / rect.width) * duracionTotal, duracionTotal - DUR));
    actualizarUI();
    if (video) video.currentTime = trimStart;
  });

  // ── Controles de video ───────────────────────────────
  video.addEventListener('timeupdate', () => {
    const pct = (video.currentTime / duracionTotal) * 100;
    if (progresoBar) progresoBar.style.width = `${pct}%`;
    if (progresoThumb) progresoThumb.style.left = `${pct}%`;
    if (tiempoEl) tiempoEl.textContent = fmtTime(video.currentTime);
    if (posLine) posLine.style.left = `${pct}%`;
  });

  btnPlay?.addEventListener('click', () => {
    if (video.paused) { video.play(); btnPlay.textContent = '⏸'; }
    else              { video.pause(); btnPlay.textContent = '▶'; }
  });
  video.addEventListener('pause', () => { if (btnPlay) btnPlay.textContent = '▶'; });
  video.addEventListener('play',  () => { if (btnPlay) btnPlay.textContent = '⏸'; });

  progresoVideo?.addEventListener('click', e => {
    const rect = progresoVideo.getBoundingClientRect();
    video.currentTime = ((e.clientX - rect.left) / rect.width) * duracionTotal;
  });

  // ── Vista previa del recorte ─────────────────────────
  let previewTimeout = null;
  document.getElementById('btn-preview-recorte')?.addEventListener('click', () => {
    if (previewTimeout) clearTimeout(previewTimeout);
    video.currentTime = trimStart;
    video.play();
    btnPlay.textContent = '⏸';
    previewTimeout = setTimeout(() => { video.pause(); }, DUR * 1000);
  });

  // ── Confirmar ────────────────────────────────────────
  document.getElementById('btn-confirmar-recorte')?.addEventListener('click', () => {
    if (previewTimeout) clearTimeout(previewTimeout);
    video.pause();
    procesarRecorteConFfmpeg();
  });
}

async function procesarRecorteConFfmpeg() {
  const btnConfirmar  = document.getElementById('btn-confirmar-recorte');
  const btnPreview    = document.getElementById('btn-preview-recorte');
  const procesando    = document.getElementById('trim-procesando');
  const progresoTexto = document.getElementById('trim-progreso-texto');
  const progressFill  = document.getElementById('trim-progress-fill');

  if (btnConfirmar) btnConfirmar.disabled = true;
  if (btnPreview)   btnPreview.disabled = true;
  if (procesando)   procesando.style.display = 'block';

  const setProgreso = (pct, txt) => {
    if (progressFill)  progressFill.style.width = `${pct}%`;
    if (progresoTexto) progresoTexto.textContent = txt;
  };

  try {
    setProgreso(5, 'Cargando procesador de video (primera vez puede tardar ~10s)...');

    // ── Cargar @ffmpeg/ffmpeg v0.12 + @ffmpeg/core v0.12.6 (single-thread)
    // toBlobURL convierte URLs externas a blob: del mismo origen → no necesita SharedArrayBuffer
    // IMPORTANTE: usar @ffmpeg/core (sin -mt) → no requiere SharedArrayBuffer ni headers COOP/COEP
    if (!ffmpegLoaded) {
      const { FFmpeg }          = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js');
      const { toBlobURL, fetchFile: ff } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/dist/esm/index.js');

      ffmpegInstance = new FFmpeg();

      ffmpegInstance.on('progress', ({ progress }) => {
        setProgreso(20 + Math.round(progress * 70), `Recortando... ${Math.round(progress * 100)}%`);
      });

      // Single-thread core → funciona en GitHub Pages sin headers especiales
      const base = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      setProgreso(10, 'Descargando núcleo de ffmpeg...');
      await ffmpegInstance.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`,   'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      // Guardamos fetchFile en el scope de la instancia para reutilizar
      ffmpegInstance._fetchFile = ff;
      ffmpegLoaded = true;
    }

    setProgreso(20, 'Leyendo archivo de video...');

    const fetchFile = ffmpegInstance._fetchFile;
    const DUR = CONFIG.TV.DURACION_ANUNCIO_SEG;

    await ffmpegInstance.writeFile('input.mp4', await fetchFile(videoFile));

    setProgreso(25, 'Recortando...');

    // -c copy = sin recodificación → casi instantáneo y no requiere mucha CPU
    await ffmpegInstance.exec([
      '-ss', trimStart.toFixed(3),
      '-i',  'input.mp4',
      '-t',  String(DUR),
      '-c',  'copy',
      '-movflags', '+faststart',
      'output.mp4'
    ]);

    setProgreso(92, 'Preparando archivo...');

    const data = await ffmpegInstance.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    videoFile  = new File([blob], `recortado_${Date.now()}.mp4`, { type: 'video/mp4' });

    await ffmpegInstance.deleteFile('input.mp4');
    await ffmpegInstance.deleteFile('output.mp4');

    setProgreso(100, '¡Listo!');

    const editorContainer = document.getElementById('trim-editor');
    if (editorContainer) editorContainer.style.display = 'none';
    mostrarArchivoListo(videoFile, null);
    toast.success('✂️ Video recortado correctamente. Ya puedes subirlo.');

  } catch (err) {
    console.error('[Trim]', err);
    toast.error('Error al recortar el video. Intenta de nuevo o usa una imagen.');
    if (btnConfirmar) { btnConfirmar.disabled = false; }
    if (btnPreview)   { btnPreview.disabled = false; }
    if (procesando)   { procesando.style.display = 'none'; }
  }
}

// ═══════════════════════════════════════════════════════
// CONFIRMAR SUBIDA
// ═══════════════════════════════════════════════════════

async function handleConfirmarSubida() {
  if (!videoFile || !contratacion) return;

  const btnConfirmar = document.getElementById('btn-confirmar-subida');
  if (btnConfirmar) {
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = '<span class="btn-spinner"></span> Subiendo...';
  }

  showLoading('Subiendo tu anuncio...');

  try {
    // Subir archivo a Storage
    const { url, error: uploadError } = await subirAnuncio(videoFile, perfil.id);

    if (uploadError) throw uploadError;

    // Determinar tipo
    const tipo = videoFile.type.startsWith('video/') ? 'video' : 'imagen';

    // Registrar en DB
    const { error: dbError } = await crearAnuncio({
      contratacion_id: contratacion.id,
      tipo,
      archivo_url: url,
      nombre_archivo: videoFile.name
    });

    if (dbError) throw dbError;

    toast.success('¡Anuncio subido con éxito! Aparecerá en el carrusel próximamente.');

    // Cerrar modal
    document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
    const modal = document.getElementById('modal-subir');
    if (modal) modal.style.display = 'none';

    resetearUploadZone();
    await cargarAnuncios();

  } catch (err) {
    toast.error(err.message || 'Error al subir el anuncio');
  } finally {
    hideLoading();
    if (btnConfirmar) {
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Subir anuncio';
    }
  }
}

// ═══════════════════════════════════════════════════════
// PREVIEW DE ANUNCIO EXISTENTE
// ═══════════════════════════════════════════════════════

function abrirPreview(url, tipo) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';

  const media = tipo === 'video'
    ? `<video src="${escapeHtml(url)}" controls autoplay muted style="max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:8px"></video>`
    : `<img src="${escapeHtml(url)}" alt="Anuncio" style="max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:8px">`;

  backdrop.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-header">
        <h3>Vista previa del anuncio</h3>
        <button class="modal-close" aria-label="Cerrar">×</button>
      </div>
      <div class="modal-body" style="background:#111;border-radius:0 0 16px 16px">
        ${media}
      </div>
    </div>
  `;

  backdrop.querySelector('.modal-close').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  document.body.appendChild(backdrop);
}

// ── ARRANCAR ──
document.addEventListener('DOMContentLoaded', init);
