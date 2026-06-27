/**
 * admin-planes.js - ZV Publicidad Digital
 * Módulo Admin: CRUD de planes y configuración del negocio
 */

import { requireAuth } from './auth.js';
import { initPanel } from './main.js';
import { obtenerPlanes, crearPlan, actualizarPlan, obtenerConfiguracion, actualizarConfiguracion } from './supabase-data.js';
import {
  toast, confirmar, showLoading, hideLoading,
  escapeHtml, formatearSoles
} from './utils.js';

// ═══════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════

let perfil = null;
let planes = [];
let planEditando = null;

async function init() {
  perfil = await requireAuth('admin');
  if (!perfil) return;

  initPanel(perfil);

  showLoading('Cargando planes...');
  const [{ data: planesData }, { data: config }] = await Promise.all([
    obtenerPlanes(false), // Incluir inactivos
    obtenerConfiguracion()
  ]);
  hideLoading();

  planes = planesData || [];
  renderPlanes();
  renderFormConfig(config || {});
  bindEventos();
}

// ═══════════════════════════════════════════════════════
// RENDERIZAR TABLA DE PLANES
// ═══════════════════════════════════════════════════════

function renderPlanes() {
  const tbody = document.getElementById('tabla-planes-body');
  if (!tbody) return;

  tbody.innerHTML = planes.map(p => `
    <tr class="${p.activo ? '' : 'opacity-50'}">
      <td><strong>${escapeHtml(p.nombre)}</strong></td>
      <td><code>${escapeHtml(p.tipo)}</code></td>
      <td><strong style="color:var(--color-primary)">${formatearSoles(p.precio_soles)}</strong></td>
      <td>${p.duracion_horas ? `${p.duracion_horas}h` : '—'}</td>
      <td>${p.repeticiones_totales?.toLocaleString('es-PE') || '—'}</td>
      <td>
        <span class="badge ${p.prioridad_garantizada ? 'badge-success' : 'badge-gray'}">
          ${p.prioridad_garantizada ? 'Sí' : 'No'}
        </span>
      </td>
      <td>
        <span class="badge ${p.activo ? 'badge-success' : 'badge-danger'}">
          ${p.activo ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-sm btn-ghost btn-editar-plan" data-id="${p.id}">✏️ Editar</button>
          <button class="btn btn-sm btn-ghost btn-toggle-plan" data-id="${p.id}" data-activo="${p.activo}">
            ${p.activo ? '🔒 Desactivar' : '🔓 Activar'}
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ═══════════════════════════════════════════════════════
// MODAL EDITAR / CREAR PLAN
// ═══════════════════════════════════════════════════════

function abrirModalPlan(plan = null) {
  planEditando = plan;
  const esNuevo = !plan;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal modal-lg">
      <div class="modal-header">
        <h3>${esNuevo ? 'Nuevo plan' : `Editar: ${escapeHtml(plan.nombre)}`}</h3>
        <button class="modal-close">×</button>
      </div>
      <div class="modal-body">
        <form id="form-plan">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required">Nombre del plan</label>
              <input class="form-control" id="plan-nombre" type="text" value="${escapeHtml(plan?.nombre || '')}" required>
            </div>
            <div class="form-group">
              <label class="form-label required">Tipo</label>
              <select class="form-control" id="plan-tipo" ${!esNuevo ? 'disabled' : ''}>
                <option value="mensual"  ${plan?.tipo==='mensual'  ? 'selected':''}>Mensual</option>
                <option value="semanal"  ${plan?.tipo==='semanal'  ? 'selected':''}>Semanal</option>
                <option value="diario"   ${plan?.tipo==='diario'   ? 'selected':''}>Diario</option>
                <option value="hora"     ${plan?.tipo==='hora'     ? 'selected':''}>Por Hora</option>
                <option value="basico"   ${plan?.tipo==='basico'   ? 'selected':''}>Básico</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label required">Precio (S/)</label>
              <input class="form-control" id="plan-precio" type="number" step="0.01" min="0.01"
                value="${plan?.precio_soles || ''}" required>
            </div>
            <div class="form-group">
              <label class="form-label">Duración (horas)</label>
              <input class="form-control" id="plan-duracion" type="number" min="1"
                value="${plan?.duracion_horas || ''}" placeholder="Dejar vacío para Plan Básico">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Repeticiones totales</label>
              <input class="form-control" id="plan-repeticiones" type="number" min="0"
                value="${plan?.repeticiones_totales || ''}" placeholder="Opcional">
            </div>
            <div class="form-group">
              <label class="form-label">Máx. publicaciones (solo Básico)</label>
              <input class="form-control" id="plan-max-pub" type="number" min="1" max="10"
                value="${plan?.max_publicaciones_puntuales || ''}" placeholder="Ej: 5">
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Descripción (visible al cliente)</label>
            <textarea class="form-control" id="plan-descripcion" rows="2">${escapeHtml(plan?.descripcion || '')}</textarea>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="toggle-switch">
                <input type="checkbox" id="plan-prioridad" ${plan?.prioridad_garantizada !== false ? 'checked' : ''}>
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
                <span class="toggle-label">Prioridad garantizada</span>
              </label>
            </div>
            <div class="form-group">
              <label class="toggle-switch">
                <input type="checkbox" id="plan-multiples" ${plan?.permite_multiples_anuncios ? 'checked' : ''}>
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
                <span class="toggle-label">Permite múltiples anuncios</span>
              </label>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Orden de visualización</label>
            <input class="form-control" id="plan-orden" type="number" min="0"
              value="${plan?.orden_display || 0}">
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost btn-cancel">Cancelar</button>
        <button class="btn btn-primary btn-guardar-plan">
          ${esNuevo ? 'Crear plan' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  `;

  backdrop.querySelector('.modal-close').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('.btn-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('.btn-guardar-plan').addEventListener('click', () => guardarPlan(backdrop));

  document.body.appendChild(backdrop);
}

async function guardarPlan(backdrop) {
  const datos = {
    nombre:                    backdrop.querySelector('#plan-nombre').value.trim(),
    tipo:                      backdrop.querySelector('#plan-tipo').value,
    precio_soles:              parseFloat(backdrop.querySelector('#plan-precio').value),
    duracion_horas:            parseInt(backdrop.querySelector('#plan-duracion').value) || null,
    repeticiones_totales:      parseInt(backdrop.querySelector('#plan-repeticiones').value) || null,
    max_publicaciones_puntuales: parseInt(backdrop.querySelector('#plan-max-pub').value) || null,
    descripcion:               backdrop.querySelector('#plan-descripcion').value.trim(),
    prioridad_garantizada:     backdrop.querySelector('#plan-prioridad').checked,
    permite_multiples_anuncios: backdrop.querySelector('#plan-multiples').checked,
    orden_display:             parseInt(backdrop.querySelector('#plan-orden').value) || 0,
  };

  if (!datos.nombre || !datos.precio_soles) {
    toast.error('Completa los campos requeridos');
    return;
  }

  showLoading('Guardando...');

  let error;
  if (planEditando) {
    ({ error } = await actualizarPlan(planEditando.id, datos));
  } else {
    ({ error } = await crearPlan(datos));
  }

  hideLoading();
  backdrop.remove();

  if (error) {
    toast.error(error.message || 'Error al guardar');
    return;
  }

  toast.success(planEditando ? 'Plan actualizado' : 'Plan creado correctamente');
  const { data } = await obtenerPlanes(false);
  planes = data || [];
  renderPlanes();
}

// ═══════════════════════════════════════════════════════
// CONFIGURACIÓN DEL NEGOCIO
// ═══════════════════════════════════════════════════════

function renderFormConfig(config) {
  const form = document.getElementById('form-config');
  if (!form) return;

  const campos = [
    { key: 'nombre_negocio',      label: 'Nombre comercial',       tipo: 'text' },
    { key: 'cuenta_banco_nombre', label: 'Banco',                  tipo: 'text' },
    { key: 'cuenta_numero',       label: 'N° de cuenta',           tipo: 'text' },
    { key: 'cuenta_cci',          label: 'CCI',                    tipo: 'text' },
    { key: 'cuenta_titular',      label: 'Titular',                tipo: 'text' },
    { key: 'contacto_whatsapp',   label: 'WhatsApp de contacto',   tipo: 'text' },
    { key: 'horario_inicio',      label: 'Horario inicio (HH:MM)', tipo: 'text', placeholder: '08:00' },
    { key: 'horario_fin',         label: 'Horario fin (HH:MM)',    tipo: 'text', placeholder: '19:00' },
    { key: 'slots_por_vuelta',    label: 'Slots por vuelta',       tipo: 'number' },
    { key: 'max_size_video_mb',   label: 'Límite video (MB)',      tipo: 'number' },
    { key: 'max_size_imagen_mb',  label: 'Límite imagen (MB)',     tipo: 'number' },
  ];

  form.innerHTML = `
    <div class="grid-2" style="gap:var(--space-5)">
      ${campos.map(c => `
        <div class="form-group">
          <label class="form-label">${escapeHtml(c.label)}</label>
          <input class="form-control" type="${c.tipo}" name="${c.key}"
            value="${escapeHtml(config[c.key] || '')}"
            placeholder="${c.placeholder || ''}">
        </div>
      `).join('')}
    </div>
    <div style="text-align:right;margin-top:var(--space-4)">
      <button type="submit" class="btn btn-primary">Guardar configuración</button>
    </div>
  `;

  form.addEventListener('submit', handleGuardarConfig);
}

async function handleGuardarConfig(e) {
  e.preventDefault();
  const form = e.target;
  const inputs = form.querySelectorAll('[name]');

  showLoading('Guardando configuración...');

  const promesas = Array.from(inputs).map(input =>
    actualizarConfiguracion(input.name, input.value.trim())
  );

  await Promise.all(promesas);
  hideLoading();
  toast.success('Configuración guardada correctamente');
}

// ═══════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════

function bindEventos() {
  // Botón nuevo plan
  document.getElementById('btn-nuevo-plan')?.addEventListener('click', () => abrirModalPlan());

  // Tabla: editar y toggle
  document.getElementById('tabla-planes')?.addEventListener('click', async (e) => {
    const btnEditar = e.target.closest('.btn-editar-plan');
    const btnToggle = e.target.closest('.btn-toggle-plan');

    if (btnEditar) {
      const plan = planes.find(p => p.id === btnEditar.dataset.id);
      if (plan) abrirModalPlan(plan);
    }

    if (btnToggle) {
      const activo = btnToggle.dataset.activo === 'true';
      const ok = await confirmar({
        titulo: activo ? 'Desactivar plan' : 'Activar plan',
        mensaje: activo
          ? 'Los clientes ya no podrán contratar este plan.'
          : 'El plan estará disponible nuevamente para los clientes.',
        textoConfirmar: activo ? 'Desactivar' : 'Activar',
        tipoBtnConfirmar: activo ? 'danger' : 'success'
      });
      if (!ok) return;

      showLoading();
      await actualizarPlan(btnToggle.dataset.id, { activo: !activo });
      hideLoading();
      const { data } = await obtenerPlanes(false);
      planes = data || [];
      renderPlanes();
      toast.success(`Plan ${activo ? 'desactivado' : 'activado'}`);
    }
  });
}

// ── ARRANCAR ──
document.addEventListener('DOMContentLoaded', init);
