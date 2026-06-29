/**
 * admin-anuncios-propios.js - ZV Publicidad Digital
 * Gestión de anuncios propios del administrador (negocios propios)
 * Se reproducen en los slots libres del carrusel TV
 */

import { requireAuth }    from './auth.js';
import { initPanel }      from './main.js';
import {
  listarAnunciosAdmin, crearAnuncioAdmin,
  toggleAnuncioAdmin, eliminarAnuncioAdmin,
  subirAnuncio,
} from './supabase-data.js';
import {
  toast, confirmar, showLoading, hideLoading,
  escapeHtml, tiempoRelativo,
} from './utils.js';
import { CONFIG } from './config.js';

// ═══════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════

let videoFile    = null;  // Archivo seleccionado para subir
let trimmedFile  = null;  // Si aplica recorte

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════

(async () => {
  const perfil = await requireAuth('admin');
  if (!perfil) return;

  initPanel(perfil);
  bindEventos();
  await cargarAnuncios();
})();

// ═══════════════════════════════════════════════════════
// CARGAR Y RENDERIZAR ANUNCIOS
// ═══════════════════════════════════════════════════════

async function cargarAnuncios() {
  const grid  = document.getElementById('admin-anuncios-grid');
  const empty = document.getElementById('admin-anuncios-empty');
  if (!grid) return;

  grid.innerHTML = '<div style="padding:var(--space-8);text-align:center;color:var(--color-gray-400)">Cargando...</div>';

  const { data, error } = await listarAnunciosAdmin();
  if (error) {
    toast.error('Error al cargar anuncios');
    grid.innerHTML = '';
    return;
  }

  const anuncios = data || [];

  if (anuncios.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = anuncios.map(a => {
    const preview = a.tipo === 'video'
      ? `<video src="${escapeHtml(a.archivo_url)}" muted playsinline preload="metadata"
           style="width:100%;height:100%;object-fit:cover"
           onmouseenter="this.play()" onmouseleave="this.pause()"></video>`
      : `<img src="${escapeHtml(a.archivo_url)}" alt="${escapeHtml(a.nombre)}"
           style="width:100%;height:100%;object-fit:cover">`;

    return `
      <div class="anuncio-card" data-id="${a.id}">
        <div class="anuncio-preview">
          ${preview}
          <span class="anuncio-type-badge">${a.tipo === 'video' ? '🎬 Video' : '🖼️ Imagen'}</span>
          ${a.es_activo
            ? '<span class="anuncio-active-badge">● Activo</span>'
            : '<span class="anuncio-inactive-badge">Inactivo</span>'}
        </div>
        <div class="anuncio-info">
          <div class="anuncio-nombre" style="font-weight:600;margin-bottom:4px">
            ${escapeHtml(a.nombre)}
          </div>
          <div class="anuncio-meta">
            Subido ${tiempoRelativo(a.created_at)}
          </div>
          <div class="anuncio-reproducciones" style="font-size:0.8rem;color:var(--color-gray-400);margin-top:4px">
            📊 ${(a.reproducciones || 0).toLocaleString()} reproducciones
          </div>
          <div class="anuncio-actions">
            <button class="btn btn-sm ${a.es_activo ? 'btn-warning' : 'btn-success'} btn-toggle"
              data-id="${a.id}" data-activo="${a.es_activo}">
              ${a.es_activo ? '⏸ Desactivar' : '▶ Activar'}
            </button>
            <button class="btn btn-sm btn-ghost btn-preview"
              data-url="${escapeHtml(a.archivo_url)}" data-tipo="${a.tipo}">
              👁 Ver
            </button>
            <button class="btn btn-sm btn-danger btn-eliminar"
              data-id="${a.id}" data-url="${escapeHtml(a.archivo_url)}">
              🗑
            </button>
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
  // Botón subir
  document.getElementById('btn-subir-admin')
    ?.addEventListener('click', abrirModal);

  // Grid delegación de eventos
  document.getElementById('admin-anuncios-grid')
    ?.addEventListener('click', async (e) => {
      const btnToggle   = e.target.closest('.btn-toggle');
      const btnPreview  = e.target.closest('.btn-preview');
      const btnEliminar = e.target.closest('.btn-eliminar');

      if (btnToggle)   await handleToggle(btnToggle);
      if (btnPreview)  abrirPreview(btnPreview.dataset.url, btnPreview.dataset.tipo);
      if (btnEliminar) await handleEliminar(btnEliminar);
    });

  // Upload zone
  const zone      = document.getElementById('upload-zone-admin');
  const fileInput = document.getElementById('file-input-admin');
  if (zone && fileInput) {
    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) procesarArchivo(f);
    });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) procesarArchivo(fileInput.files[0]);
    });
  }

  // Confirmar subida
  document.getElementById('btn-confirmar-admin')
    ?.addEventListener('click', handleSubir);

  // Cerrar modales
  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', cerrarModales);
  });
}

// ═══════════════════════════════════════════════════════
// TOGGLE ACTIVO / INACTIVO
// ═══════════════════════════════════════════════════════

async function handleToggle(btn) {
  const id      = btn.dataset.id;
  const activo  = btn.dataset.activo === 'true';
  const accion  = activo ? 'desactivar' : 'activar';

  const ok = await confirmar({
    titulo: activo ? 'Desactivar anuncio' : 'Activar anuncio',
    mensaje: activo
      ? 'El anuncio dejará de aparecer en el carrusel.'
      : 'El anuncio aparecerá en los slots libres del carrusel.',
    textoConfirmar: activo ? 'Desactivar' : 'Activar',
    tipoBtnConfirmar: activo ? 'warning' : 'primary',
  });
  if (!ok) return;

  showLoading(`${accion.charAt(0).toUpperCase() + accion.slice(1)}ando...`);
  const { error } = await toggleAnuncioAdmin(id, !activo);
  hideLoading();

  if (error) {
    toast.error(`Error al ${accion} el anuncio`);
  } else {
    toast.success(`Anuncio ${activo ? 'desactivado' : 'activado'} correctamente.`);
    await cargarAnuncios();
  }
}

// ═══════════════════════════════════════════════════════
// ELIMINAR
// ═══════════════════════════════════════════════════════

async function handleEliminar(btn) {
  const ok = await confirmar({
    titulo: 'Eliminar anuncio',
    mensaje: 'Se eliminará permanentemente este anuncio y su archivo. ¿Continuar?',
    textoConfirmar: 'Eliminar',
    tipoBtnConfirmar: 'danger',
  });
  if (!ok) return;

  showLoading('Eliminando...');
  const { error } = await eliminarAnuncioAdmin(btn.dataset.id, btn.dataset.url);
  hideLoading();

  if (error) {
    toast.error('Error al eliminar el anuncio');
  } else {
    toast.success('Anuncio eliminado.');
    await cargarAnuncios();
  }
}

// ═══════════════════════════════════════════════════════
// SUBIR NUEVO ANUNCIO
// ═══════════════════════════════════════════════════════

function abrirModal() {
  const modal = document.getElementById('modal-admin-subir');
  if (modal) modal.style.display = 'flex';
  videoFile   = null;
  trimmedFile = null;
  resetearUploadZone();
}

function cerrarModales() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.style.display = 'none');
  videoFile   = null;
  trimmedFile = null;
  resetearUploadZone();
}

function resetearUploadZone() {
  const zone  = document.getElementById('upload-zone-admin');
  const input = document.getElementById('file-input-admin');
  const btn   = document.getElementById('btn-confirmar-admin');
  if (zone) {
    zone.innerHTML = `
      <input type="file" id="file-input-admin" accept="video/mp4,image/jpeg,image/jpg,image/png,image/webp" style="display:none">
      <div class="file-upload-icon">📁</div>
      <p class="file-upload-text">Arrastra tu archivo aquí o <strong>haz click para seleccionar</strong></p>
      <p class="file-upload-hint">Video MP4 (máx. 15MB) o Imagen JPG/PNG (máx. 5MB)</p>
    `;
    // Rebind file input
    const nuevoInput = zone.querySelector('#file-input-admin');
    zone.addEventListener('click', () => nuevoInput?.click());
    nuevoInput?.addEventListener('change', () => {
      if (nuevoInput.files[0]) procesarArchivo(nuevoInput.files[0]);
    });
  }
  if (btn) btn.disabled = true;
  document.getElementById('input-nombre-admin')?.setAttribute('value', '');
}

function procesarArchivo(file) {
  const esVideo  = file.type === 'video/mp4';
  const esImagen = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type);

  if (!esVideo && !esImagen) {
    toast.error('Formato no soportado. Usa MP4, JPG o PNG.');
    return;
  }

  const maxMB = esVideo ? CONFIG.STORAGE.MAX_SIZE_VIDEO_MB : CONFIG.STORAGE.MAX_SIZE_IMG_MB;
  if (file.size > maxMB * 1024 * 1024) {
    toast.error(`El archivo supera el límite de ${maxMB}MB.`);
    return;
  }

  videoFile = file;

  const zone = document.getElementById('upload-zone-admin');
  if (zone) {
    zone.innerHTML = `
      <div class="file-upload-icon">✅</div>
      <p class="file-upload-text"><strong>${escapeHtml(file.name)}</strong></p>
      <p class="file-upload-hint">${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type}</p>
    `;
  }

  // Auto-completar nombre si está vacío
  const inputNombre = document.getElementById('input-nombre-admin');
  if (inputNombre && !inputNombre.value.trim()) {
    inputNombre.value = file.name.replace(/\.[^.]+$/, '');
  }

  const btn = document.getElementById('btn-confirmar-admin');
  if (btn) btn.disabled = false;
}

async function handleSubir() {
  if (!videoFile) return;

  const nombre = document.getElementById('input-nombre-admin')?.value.trim();
  if (!nombre) {
    toast.error('Escribe un nombre para el anuncio.');
    document.getElementById('input-nombre-admin')?.focus();
    return;
  }

  const btn = document.getElementById('btn-confirmar-admin');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Subiendo...'; }

  try {
    // Subir archivo a Storage (carpeta 'admin/' dentro del bucket anuncios)
    showLoading('Subiendo archivo...');
    const { url: archivoUrl, error: uploadError } = await subirAnuncio(videoFile, 'admin');
    if (uploadError) throw uploadError;

    // Crear registro en anuncios_admin
    const esVideo = videoFile.type === 'video/mp4';
    const { error: dbError } = await crearAnuncioAdmin({
      nombre,
      tipo:           esVideo ? 'video' : 'imagen',
      archivo_url:    archivoUrl,
      nombre_archivo: videoFile.name,
    });
    if (dbError) throw dbError;

    hideLoading();
    toast.success('✅ Anuncio subido correctamente.');
    cerrarModales();
    await cargarAnuncios();

  } catch (err) {
    hideLoading();
    console.error('[Admin] Error subiendo anuncio:', err);
    toast.error('Error al subir el anuncio. Intenta de nuevo.');
    if (btn) { btn.disabled = false; btn.textContent = '📤 Subir anuncio'; }
  }
}

// ═══════════════════════════════════════════════════════
// PREVIEW
// ═══════════════════════════════════════════════════════

function abrirPreview(url, tipo) {
  const modalPreview = document.createElement('div');
  modalPreview.className = 'modal-backdrop';
  modalPreview.style.cssText = 'display:flex;z-index:9999';
  modalPreview.innerHTML = `
    <div class="modal" style="max-width:720px;width:90%">
      <div class="modal-header">
        <h3>Vista previa</h3>
        <button class="modal-close" aria-label="Cerrar">×</button>
      </div>
      <div class="modal-body" style="padding:0;background:#000;border-radius:0 0 8px 8px;min-height:300px;display:flex;align-items:center;justify-content:center">
        ${tipo === 'video'
          ? `<video src="${escapeHtml(url)}" controls autoplay muted style="max-width:100%;max-height:70vh"></video>`
          : `<img src="${escapeHtml(url)}" style="max-width:100%;max-height:70vh;object-fit:contain">`}
      </div>
    </div>
  `;
  modalPreview.querySelector('.modal-close').addEventListener('click', () => modalPreview.remove());
  modalPreview.addEventListener('click', (e) => { if (e.target === modalPreview) modalPreview.remove(); });
  document.body.appendChild(modalPreview);
}
