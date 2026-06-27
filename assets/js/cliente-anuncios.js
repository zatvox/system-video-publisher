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
// EDITOR DE RECORTE DE VIDEO (ffmpeg.wasm - Opción A)
// ═══════════════════════════════════════════════════════

function mostrarEditorRecorte(url, duracionTotal) {
  const editorContainer = document.getElementById('trim-editor');
  if (!editorContainer) return;

  const duracionRecorte = CONFIG.TV.DURACION_ANUNCIO_SEG;
  trimStart = 0;

  editorContainer.style.display = 'block';
  editorContainer.innerHTML = `
    <div class="trim-editor">
      <h4 style="color:white;margin-bottom:12px">✂️ Tu video dura más de ${duracionRecorte} segundos</h4>
      <p style="color:var(--color-gray-400);font-size:0.875rem;margin-bottom:16px">
        Selecciona el segmento de ${duracionRecorte} segundos que quieres publicar.
      </p>

      <div class="trim-preview">
        <video id="trim-video" src="${url}" muted controls preload="auto"></video>
      </div>

      <div class="trim-info">
        <span>Inicio: <strong id="trim-start-display">0:00</strong></span>
        <span>Segmento: <strong>${duracionRecorte} segundos</strong></span>
        <span>Duración total: <strong>${duracionTotal.toFixed(1)}s</strong></span>
      </div>

      <label style="color:var(--color-gray-300);font-size:0.875rem;margin-bottom:6px;display:block">
        Mueve el deslizador para elegir desde qué segundo empieza el recorte:
      </label>
      <input type="range" id="trim-slider"
        min="0" max="${Math.max(0, duracionTotal - duracionRecorte).toFixed(1)}"
        step="0.1" value="0"
        style="width:100%;margin-bottom:16px;accent-color:var(--color-primary)"
      >

      <div id="trim-preview-info" class="trim-info" style="background:rgba(27,79,216,0.2);padding:12px;border-radius:8px;margin-bottom:16px">
        <span style="color:white">Se publicará del segundo <strong id="trim-desde">0.0</strong> al <strong id="trim-hasta">${duracionRecorte}.0</strong></span>
      </div>

      <div class="trim-actions">
        <button id="btn-preview-recorte" class="btn btn-secondary" style="background:transparent;color:white;border-color:white">
          ▶ Previsualizar recorte
        </button>
        <button id="btn-confirmar-recorte" class="btn btn-primary">
          ✂️ Confirmar y guardar
        </button>
      </div>

      <div id="trim-procesando" style="display:none;margin-top:12px">
        <div style="display:flex;align-items:center;gap:12px;color:white">
          <div class="spinner spinner-sm"></div>
          <span id="trim-progreso">Procesando video... Por favor espera.</span>
        </div>
        <div class="progress-bar" style="margin-top:8px">
          <div class="progress-fill" id="trim-progress-fill" style="width:0%"></div>
        </div>
      </div>
    </div>
  `;

  const slider = document.getElementById('trim-slider');
  const video = document.getElementById('trim-video');
  const startDisplay = document.getElementById('trim-start-display');
  const desdeEl = document.getElementById('trim-desde');
  const hastaEl = document.getElementById('trim-hasta');

  slider.addEventListener('input', () => {
    trimStart = parseFloat(slider.value);
    const m = Math.floor(trimStart / 60).toString().padStart(2, '0');
    const s = Math.floor(trimStart % 60).toString().padStart(2, '0');
    startDisplay.textContent = `${m}:${s}`;
    desdeEl.textContent = trimStart.toFixed(1);
    hastaEl.textContent = (trimStart + duracionRecorte).toFixed(1);
    if (video) video.currentTime = trimStart;
  });

  document.getElementById('btn-preview-recorte')?.addEventListener('click', () => {
    if (!video) return;
    video.currentTime = trimStart;
    video.play();
    setTimeout(() => video.pause(), duracionRecorte * 1000);
  });

  document.getElementById('btn-confirmar-recorte')?.addEventListener('click', () => {
    procesarRecorteConFfmpeg(duracionTotal);
  });
}

async function procesarRecorteConFfmpeg(duracionTotal) {
  const btnConfirmar = document.getElementById('btn-confirmar-recorte');
  const btnPreview = document.getElementById('btn-preview-recorte');
  const procesando = document.getElementById('trim-procesando');
  const progreso = document.getElementById('trim-progreso');
  const progressFill = document.getElementById('trim-progress-fill');

  if (btnConfirmar) btnConfirmar.disabled = true;
  if (btnPreview) btnPreview.disabled = true;
  if (procesando) procesando.style.display = 'block';

  try {
    if (progreso) progreso.textContent = 'Cargando procesador de video...';
    if (progressFill) progressFill.style.width = '10%';

    // Cargar ffmpeg.wasm desde CDN
    if (!ffmpegLoaded) {
      const { createFFmpeg, fetchFile } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
      ffmpegInstance = createFFmpeg({
        log: false,
        corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
        progress: ({ ratio }) => {
          if (progressFill) progressFill.style.width = `${Math.min(90, 10 + ratio * 80)}%`;
        }
      });
      await ffmpegInstance.load();
      ffmpegLoaded = true;
    }

    if (progreso) progreso.textContent = 'Recortando video...';
    if (progressFill) progressFill.style.width = '20%';

    const { fetchFile } = await import('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');

    ffmpegInstance.FS('writeFile', 'input.mp4', await fetchFile(videoFile));

    const duracion = CONFIG.TV.DURACION_ANUNCIO_SEG;
    await ffmpegInstance.run(
      '-ss', trimStart.toFixed(2),
      '-i', 'input.mp4',
      '-t', String(duracion),
      '-c:v', 'libx264',
      '-crf', '23',
      '-preset', 'fast',
      '-an',  // Sin audio
      '-movflags', '+faststart',
      'output.mp4'
    );

    if (progressFill) progressFill.style.width = '95%';
    if (progreso) progreso.textContent = 'Preparando archivo...';

    const outputData = ffmpegInstance.FS('readFile', 'output.mp4');
    const blob = new Blob([outputData.buffer], { type: 'video/mp4' });
    videoFile = new File([blob], `recortado_${Date.now()}.mp4`, { type: 'video/mp4' });

    // Limpiar memoria de ffmpeg
    ffmpegInstance.FS('unlink', 'input.mp4');
    ffmpegInstance.FS('unlink', 'output.mp4');

    if (progressFill) progressFill.style.width = '100%';

    // Ocultar editor y mostrar archivo listo
    const editorContainer = document.getElementById('trim-editor');
    if (editorContainer) editorContainer.style.display = 'none';
    mostrarArchivoListo(videoFile, null);
    toast.success('Video recortado correctamente. Ya puedes subirlo.');

  } catch (err) {
    console.error('[Trim]', err);
    toast.error('Error al procesar el video. Intenta con la Opción B (tiempo real).');
    if (btnConfirmar) btnConfirmar.disabled = false;
    if (btnPreview) btnPreview.disabled = false;
    if (procesando) procesando.style.display = 'none';
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
