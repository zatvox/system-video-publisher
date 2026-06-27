/**
 * admin-validaciones.js - ZV Publicidad Digital
 * Módulo Admin: Cola de vouchers pendientes de aprobar/rechazar
 */

import { requireAuth } from './auth.js';
import { initPanel, actualizarBadgeValidaciones } from './main.js';
import { listarRecargas, aprobarRecarga, rechazarRecarga } from './supabase-data.js';
import { supabase } from './supabase-client.js';
import { CONFIG } from './config.js';
import {
  toast, confirmar, showLoading, hideLoading,
  escapeHtml, formatearSoles, formatearFechaHora,
  tiempoRelativo, badgeEstado, renderPaginacion
} from './utils.js';

// ═══════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════

let perfil = null;
let paginaActual = 1;
let totalRegistros = 0;
let filtroEstado = 'pendiente';
let recargaEnRevision = null; // Recarga abierta en el modal de revisión

// ═══════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════

async function init() {
  perfil = await requireAuth('admin');
  if (!perfil) return;

  initPanel(perfil);
  await cargarRecargas();
  bindEventos();
  suscribirRealtimeRecargas();
}

// ═══════════════════════════════════════════════════════
// CARGAR RECARGAS
// ═══════════════════════════════════════════════════════

async function cargarRecargas() {
  showLoading('Cargando solicitudes...');
  const { data, error, count } = await listarRecargas({
    page: paginaActual,
    estado: filtroEstado
  });
  hideLoading();

  if (error) {
    toast.error('Error al cargar las solicitudes');
    return;
  }

  totalRegistros = count || 0;
  renderTabla(data || []);
  renderPaginacionRecargas();
  actualizarBadge();
}

// ═══════════════════════════════════════════════════════
// RENDERIZAR TABLA
// ═══════════════════════════════════════════════════════

function renderTabla(recargas) {
  const tbody = document.getElementById('tabla-recargas-body');
  const empty = document.getElementById('tabla-empty');
  const contador = document.getElementById('contador-resultados');

  if (contador) contador.textContent = `${totalRegistros} solicitud${totalRegistros !== 1 ? 'es' : ''}`;

  if (!tbody) return;

  if (recargas.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }

  if (empty) empty.style.display = 'none';

  tbody.innerHTML = recargas.map(r => {
    const cliente = r.usuarios;
    const plan = r.planes;
    return `
      <tr>
        <td>
          <div style="font-weight:600">${escapeHtml(cliente?.nombre || '—')}</div>
          <div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(cliente?.email || '—')}</div>
        </td>
        <td>
          <span style="font-weight:600;color:var(--color-primary)">${formatearSoles(r.monto_declarado)}</span>
          <div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(plan?.nombre || '—')}</div>
        </td>
        <td>
          <code style="font-size:0.8rem;background:var(--color-gray-100);padding:2px 6px;border-radius:4px">
            ${escapeHtml(r.numero_operacion)}
          </code>
          ${r.banco_origen ? `<div style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(r.banco_origen)}</div>` : ''}
        </td>
        <td>
          ${r.voucher_url
            ? `<button class="btn btn-sm btn-ghost btn-ver-voucher" data-path="${escapeHtml(r.voucher_url)}">
                 📷 Ver comprobante
               </button>`
            : '<span class="badge badge-danger">Sin comprobante</span>'
          }
        </td>
        <td>${tiempoRelativo(r.created_at)}</td>
        <td>${badgeEstado(r.estado)}</td>
        <td>
          <div class="actions-cell">
            ${r.estado === 'pendiente' ? `
              <button class="btn btn-sm btn-success btn-aprobar" data-id="${r.id}" data-plan-tipo="${plan?.tipo}" data-plan-horas="${plan?.duracion_horas || ''}">
                ✓ Aprobar
              </button>
              <button class="btn btn-sm btn-danger btn-rechazar" data-id="${r.id}">
                ✗ Rechazar
              </button>
            ` : `
              <button class="btn btn-sm btn-ghost btn-ver-detalle" data-id="${r.id}">
                Ver detalle
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════
// PAGINACIÓN
// ═══════════════════════════════════════════════════════

function renderPaginacionRecargas() {
  const container = document.getElementById('paginacion');
  if (!container) return;

  const totalPaginas = Math.ceil(totalRegistros / CONFIG.PAGINATION.PAGE_SIZE);
  const nav = renderPaginacion(paginaActual, totalPaginas, async (pagina) => {
    paginaActual = pagina;
    await cargarRecargas();
  });

  container.innerHTML = '';
  if (nav) container.appendChild(nav);
}

// ═══════════════════════════════════════════════════════
// APROBAR RECARGA
// ═══════════════════════════════════════════════════════

async function handleAprobar(btn) {
  const recargaId = btn.dataset.id;
  const planTipo = btn.dataset.planTipo;
  const planHoras = parseInt(btn.dataset.planHoras);

  // Para planes con duración fija, el inicio es "ahora"
  // Para plan básico, preguntar rango
  let fechaInicio = null;
  let fechaFin = null;

  if (planTipo === 'basico') {
    // Modal para elegir fechas del plan básico
    const resultado = await modalFechasBasico();
    if (!resultado) return; // Canceló
    fechaInicio = resultado.inicio;
    fechaFin = resultado.fin;
  } else {
    // Inicio ahora, fin calculado por la función SQL
    fechaInicio = new Date().toISOString();
    fechaFin = null; // La función SQL lo calcula
  }

  const ok = await confirmar({
    titulo: 'Aprobar solicitud',
    mensaje: `¿Confirmas la aprobación de esta solicitud? Se activará el plan del cliente inmediatamente.`,
    textoConfirmar: 'Sí, aprobar',
    tipoBtnConfirmar: 'success'
  });
  if (!ok) return;

  showLoading('Aprobando solicitud...');
  const { data, error } = await aprobarRecarga(recargaId, fechaInicio, fechaFin);
  hideLoading();

  if (error || (data && !data.ok)) {
    toast.error(data?.error || error?.message || 'Error al aprobar');
    return;
  }

  toast.success(`Plan activado correctamente. ${data?.plan || ''}`);
  await cargarRecargas();
}

// ═══════════════════════════════════════════════════════
// RECHAZAR RECARGA
// ═══════════════════════════════════════════════════════

async function handleRechazar(recargaId) {
  const motivo = await modalMotivoRechazo();
  if (!motivo) return; // Canceló

  showLoading('Rechazando solicitud...');
  const { data, error } = await rechazarRecarga(recargaId, motivo);
  hideLoading();

  if (error || (data && !data.ok)) {
    toast.error(error?.message || 'Error al rechazar');
    return;
  }

  toast.info('Solicitud rechazada. El cliente será notificado.');
  await cargarRecargas();
}

// ═══════════════════════════════════════════════════════
// MODALES AUXILIARES
// ═══════════════════════════════════════════════════════

function modalMotivoRechazo() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Motivo de rechazo</h3>
          <button class="modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label required">Explica al cliente por qué se rechaza su solicitud</label>
            <textarea class="form-control" id="motivo-rechazo" rows="3"
              placeholder="Ej: El número de operación no coincide con la transferencia recibida."></textarea>
            <span class="form-hint">El cliente verá este mensaje en su historial.</span>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-cancel">Cancelar</button>
          <button class="btn btn-danger btn-confirmar-rechazo">Rechazar solicitud</button>
        </div>
      </div>
    `;

    const close = (result) => { backdrop.remove(); resolve(result); };
    backdrop.querySelector('.modal-close').addEventListener('click', () => close(null));
    backdrop.querySelector('.btn-cancel').addEventListener('click', () => close(null));
    backdrop.querySelector('.btn-confirmar-rechazo').addEventListener('click', () => {
      const motivo = backdrop.querySelector('#motivo-rechazo').value.trim();
      if (!motivo) {
        backdrop.querySelector('#motivo-rechazo').classList.add('error');
        return;
      }
      close(motivo);
    });

    document.body.appendChild(backdrop);
    backdrop.querySelector('#motivo-rechazo').focus();
  });
}

function modalFechasBasico() {
  return new Promise((resolve) => {
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const en30Dias = new Date(manana);
    en30Dias.setDate(en30Dias.getDate() + 30);

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>Fechas del Plan Básico</h3>
          <button class="modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="alert alert-info" style="margin-bottom:16px">
            <span class="alert-icon">ℹ️</span>
            <span>El Plan Básico no tiene slot garantizado. Elige el período en que el cliente quiere que sus anuncios aparezcan en los huecos disponibles.</span>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required">Fecha de inicio</label>
              <input type="datetime-local" class="form-control" id="basico-inicio"
                value="${manana.toISOString().slice(0,16)}" min="${manana.toISOString().slice(0,16)}">
            </div>
            <div class="form-group">
              <label class="form-label required">Fecha de fin</label>
              <input type="datetime-local" class="form-control" id="basico-fin"
                value="${en30Dias.toISOString().slice(0,16)}" min="${manana.toISOString().slice(0,16)}">
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-cancel">Cancelar</button>
          <button class="btn btn-primary btn-confirmar-fechas">Confirmar y aprobar</button>
        </div>
      </div>
    `;

    const close = (result) => { backdrop.remove(); resolve(result); };
    backdrop.querySelector('.modal-close').addEventListener('click', () => close(null));
    backdrop.querySelector('.btn-cancel').addEventListener('click', () => close(null));
    backdrop.querySelector('.btn-confirmar-fechas').addEventListener('click', () => {
      const inicio = backdrop.querySelector('#basico-inicio').value;
      const fin = backdrop.querySelector('#basico-fin').value;
      if (!inicio || !fin) return;
      close({
        inicio: new Date(inicio).toISOString(),
        fin:    new Date(fin).toISOString()
      });
    });

    document.body.appendChild(backdrop);
  });
}

// ═══════════════════════════════════════════════════════
// VER VOUCHER
// ═══════════════════════════════════════════════════════

async function verVoucher(path) {
  showLoading('Cargando comprobante...');
  try {
    const { data: { signedUrl } } = await supabase.storage
      .from(CONFIG.STORAGE.BUCKET_VOUCHERS)
      .createSignedUrl(path, 3600);
    hideLoading();

    if (!signedUrl) throw new Error('No se pudo generar el enlace');

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>Comprobante de pago</h3>
          <button class="modal-close">×</button>
        </div>
        <div class="modal-body" style="text-align:center;background:#111">
          <img src="${signedUrl}" alt="Comprobante de pago"
            style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px">
        </div>
        <div class="modal-footer">
          <a href="${signedUrl}" target="_blank" class="btn btn-primary">Abrir en nueva pestaña</a>
          <button class="btn btn-ghost btn-close">Cerrar</button>
        </div>
      </div>
    `;

    backdrop.querySelector('.modal-close').addEventListener('click', () => backdrop.remove());
    backdrop.querySelector('.btn-close').addEventListener('click', () => backdrop.remove());
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
  } catch (err) {
    hideLoading();
    toast.error('No se pudo cargar el comprobante');
  }
}

// ═══════════════════════════════════════════════════════
// BADGE DE PENDIENTES
// ═══════════════════════════════════════════════════════

async function actualizarBadge() {
  const { data, count } = await listarRecargas({ estado: 'pendiente' });
  const total = count || (data ? data.length : 0);
  actualizarBadgeValidaciones(total);

  const headerBadge = document.getElementById('badge-pendientes');
  if (headerBadge) {
    headerBadge.textContent = total > 0
      ? `${total} pendiente${total !== 1 ? 's' : ''}`
      : '✓ Al día';
    headerBadge.className = `badge ${total > 0 ? 'badge-warning' : 'badge-success'}`;
  }
}

// ═══════════════════════════════════════════════════════
// REALTIME (actualizaciones en tiempo real)
// ═══════════════════════════════════════════════════════

function suscribirRealtimeRecargas() {
  supabase.channel('recargas-admin')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'recargas'
    }, () => {
      toast.info('Nueva solicitud de recarga recibida');
      if (filtroEstado === 'pendiente') cargarRecargas();
    })
    .subscribe();
}

// ═══════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════

function bindEventos() {
  // Filtro por estado
  document.querySelectorAll('[data-filtro-estado]').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('[data-filtro-estado]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      filtroEstado = btn.dataset.filtroEstado;
      paginaActual = 1;
      await cargarRecargas();
    });
  });

  // Delegación de eventos en la tabla
  const tabla = document.getElementById('tabla-recargas');
  if (tabla) {
    tabla.addEventListener('click', async (e) => {
      const btnAprobar  = e.target.closest('.btn-aprobar');
      const btnRechazar = e.target.closest('.btn-rechazar');
      const btnVoucher  = e.target.closest('.btn-ver-voucher');

      if (btnAprobar)  await handleAprobar(btnAprobar);
      if (btnRechazar) await handleRechazar(btnRechazar.dataset.id);
      if (btnVoucher)  await verVoucher(btnVoucher.dataset.path);
    });
  }

  // Refresh manual
  document.getElementById('btn-refresh')?.addEventListener('click', async () => {
    paginaActual = 1;
    await cargarRecargas();
  });
}

// ── ARRANCAR ──
document.addEventListener('DOMContentLoaded', init);
