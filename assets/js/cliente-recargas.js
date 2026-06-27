/**
 * cliente-recargas.js - ZV Publicidad Digital
 * Módulo "Recargar" del panel cliente
 * Flujo: elegir plan → ver disponibilidad → ver cuenta bancaria → subir voucher
 */

import { requireAuth } from './auth.js';
import { initPanel } from './main.js';
import {
  obtenerPlanes, obtenerConfiguracion, crearRecarga, subirVoucher,
  verificarDisponibilidad, misContrataciones
} from './supabase-data.js';
import {
  toast, showLoading, hideLoading, escapeHtml,
  formatearSoles, formatearFecha, validarTamanoArchivo
} from './utils.js';
import { CONFIG } from './config.js';

// ═══════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════

let perfil = null;
let planes = [];
let planSeleccionado = null;
let configNegocio = {};
let voucherFile = null;
let voucherPath = null;
let fechaInicio = null;
let fechaFin = null;

// ═══════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════

async function init() {
  perfil = await requireAuth('cliente');
  if (!perfil) return;

  initPanel(perfil);

  showLoading('Cargando planes...');
  const [{ data: planesData }, { data: config }] = await Promise.all([
    obtenerPlanes(),
    obtenerConfiguracion()
  ]);
  hideLoading();

  planes = planesData || [];
  configNegocio = config || {};

  renderPlanes();
  renderDatosBancarios();
  bindEventos();

  // Preseleccionar plan por query param
  const params = new URLSearchParams(window.location.search);
  if (params.get('plan')) {
    const plan = planes.find(p => p.tipo === params.get('plan'));
    if (plan) seleccionarPlan(plan);
  }
}

// ═══════════════════════════════════════════════════════
// RENDERIZAR PLANES
// ═══════════════════════════════════════════════════════

function renderPlanes() {
  const grid = document.getElementById('planes-grid');
  if (!grid) return;

  grid.innerHTML = planes.map(plan => `
    <div class="plan-card" data-plan-id="${plan.id}" tabindex="0" role="button"
         aria-label="Seleccionar plan ${plan.nombre}">
      ${plan.tipo === 'mensual' ? '<span class="plan-badge">Más popular</span>' : ''}
      <div class="plan-name">${escapeHtml(plan.nombre)}</div>
      <div class="plan-price">
        <sup>S/</sup>${formatearSoles(plan.precio_soles).replace('S/.', '').replace('S/ ', '').trim()}
      </div>
      <div class="plan-period">
        ${plan.duracion_horas
          ? `${plan.duracion_horas >= 720 ? '30 días' : plan.duracion_horas >= 168 ? '7 días' : plan.duracion_horas >= 24 ? '1 día' : '1 hora'}`
          : 'Hasta 5 publicaciones'
        }
      </div>
      <ul class="plan-features">
        ${plan.prioridad_garantizada
          ? `<li>1 aparición por minuto garantizada</li>
             <li>${plan.repeticiones_totales?.toLocaleString('es-PE') || '—'} repeticiones totales</li>`
          : `<li>Hasta ${plan.max_publicaciones_puntuales} publicaciones puntuales</li>
             <li>Sin slot garantizado (huecos libres)</li>`
        }
        ${plan.permite_multiples_anuncios ? '<li>Cambio de anuncio ilimitado</li>' : ''}
        <li>Tú eliges las fechas</li>
      </ul>
      ${escapeHtml(plan.descripcion || '')}
    </div>
  `).join('');

  // Interactividad
  grid.querySelectorAll('.plan-card').forEach(card => {
    const onClick = () => {
      const plan = planes.find(p => p.id === card.dataset.planId);
      if (plan) seleccionarPlan(plan);
    };
    card.addEventListener('click', onClick);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); });
  });
}

// ═══════════════════════════════════════════════════════
// DATOS BANCARIOS (desde config del negocio)
// ═══════════════════════════════════════════════════════

function renderDatosBancarios() {
  const el = document.getElementById('datos-bancarios');
  if (!el || !configNegocio) return;

  el.innerHTML = `
    <div style="display:grid;gap:12px">
      <div>
        <span style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;font-weight:600">Banco</span>
        <p style="font-weight:600">${escapeHtml(configNegocio.cuenta_banco_nombre || '—')}</p>
      </div>
      <div>
        <span style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;font-weight:600">N° de Cuenta</span>
        <p style="font-weight:600;font-family:monospace">${escapeHtml(configNegocio.cuenta_numero || '—')}</p>
      </div>
      <div>
        <span style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;font-weight:600">CCI</span>
        <p style="font-weight:600;font-family:monospace">${escapeHtml(configNegocio.cuenta_cci || '—')}</p>
      </div>
      <div>
        <span style="color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;font-weight:600">A nombre de</span>
        <p style="font-weight:600">${escapeHtml(configNegocio.cuenta_titular || '—')}</p>
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
// SELECCIONAR PLAN
// ═══════════════════════════════════════════════════════

function seleccionarPlan(plan) {
  planSeleccionado = plan;

  // Marcar visualmente
  document.querySelectorAll('.plan-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`[data-plan-id="${plan.id}"]`);
  if (card) {
    card.classList.add('selected');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Mostrar sección de fechas y monto
  const seccionFechas = document.getElementById('seccion-fechas');
  if (seccionFechas) seccionFechas.style.display = 'block';

  // Si el plan tiene duración fija, calcular fecha fin automáticamente
  actualizarFechasSegunPlan(plan);
  actualizarMontoOrden(plan);

  // Scroll a la sección de pago
  setTimeout(() => {
    document.getElementById('seccion-pago')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function actualizarFechasSegunPlan(plan) {
  const inputInicio = document.getElementById('fecha-inicio');
  const inputFin = document.getElementById('fecha-fin');

  if (!inputInicio) return;

  // Fecha mínima: mañana
  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  inputInicio.min = manana.toISOString().slice(0, 16);
  inputInicio.value = manana.toISOString().slice(0, 16);

  if (plan.duracion_horas && plan.tipo !== 'basico') {
    // Calcular fecha fin automáticamente
    const fin = new Date(manana);
    fin.setHours(fin.getHours() + plan.duracion_horas);

    if (inputFin) {
      inputFin.value = fin.toISOString().slice(0, 16);
      inputFin.disabled = true; // Se calcula automáticamente
    }

    fechaInicio = manana.toISOString();
    fechaFin = fin.toISOString();
  } else {
    // Plan básico: el cliente elige ambas fechas
    if (inputFin) {
      inputFin.disabled = false;
      const fin = new Date(manana);
      fin.setDate(fin.getDate() + 7); // Por defecto 7 días
      inputFin.min = manana.toISOString().slice(0, 16);
      inputFin.value = fin.toISOString().slice(0, 16);
      fechaFin = fin.toISOString();
    }
    fechaInicio = manana.toISOString();
  }

  verificarYMostrarDisponibilidad();
}

// ═══════════════════════════════════════════════════════
// VERIFICAR DISPONIBILIDAD
// ═══════════════════════════════════════════════════════

async function verificarYMostrarDisponibilidad() {
  if (!fechaInicio || !fechaFin || !planSeleccionado) return;

  const contenedor = document.getElementById('disponibilidad-info');
  if (!contenedor) return;

  contenedor.innerHTML = '<div style="color:var(--text-muted)">Verificando disponibilidad...</div>';

  try {
    const { data } = await verificarDisponibilidad(fechaInicio, fechaFin);

    if (!data || data.length === 0) {
      contenedor.innerHTML = '';
      return;
    }

    // Calcular % promedio de ocupación
    const promedioOcupados = data.reduce((sum, h) => sum + (h.slots_ocupados || 0), 0) / data.length;
    const totalSlots = data[0]?.slots_totales || 6;
    const porcentaje = totalSlots > 0 ? Math.round((promedioOcupados / totalSlots) * 100) : 0;
    const horasSinCupo = data.filter(h => !h.hay_cupo).length;

    let alertClass = 'alert-success';
    let icono = '✅';
    let texto = `Disponibilidad promedio: ${100 - porcentaje}% libre.`;

    if (planSeleccionado.prioridad_garantizada) {
      if (horasSinCupo > 0) {
        alertClass = 'alert-danger';
        icono = '❌';
        texto = `⚠️ Sin cupo garantizado para ${horasSinCupo} hora(s) de tu rango. Considera otras fechas o contrata el Plan Básico.`;
      } else if (porcentaje > 60) {
        alertClass = 'alert-warning';
        icono = '⚠️';
        texto = `Cupo disponible (${100-porcentaje}% libre). Se recomienda reservar pronto.`;
      }
    } else {
      // Plan básico: mostrar recomendaciones de horarios con más huecos
      const mejoresHoras = data
        .filter(h => h.hay_cupo)
        .sort((a, b) => b.slots_disponibles - a.slots_disponibles)
        .slice(0, 3);
      texto = `Como Plan Básico, tu anuncio aparecerá en los huecos libres. Horas con más espacio disponible: ${
        mejoresHoras.map(h => h.hora_local.split(' ')[1]).join(', ')
      }`;
    }

    contenedor.innerHTML = `
      <div class="alert ${alertClass}">
        <span class="alert-icon">${icono}</span>
        <span>${texto}</span>
      </div>
    `;
  } catch (err) {
    contenedor.innerHTML = '';
  }
}

// ═══════════════════════════════════════════════════════
// MONTO DE LA ORDEN
// ═══════════════════════════════════════════════════════

function actualizarMontoOrden(plan) {
  const el = document.getElementById('monto-orden');
  if (el) el.textContent = formatearSoles(plan.precio_soles);

  const inputMonto = document.getElementById('monto-declarado');
  if (inputMonto) {
    inputMonto.value = plan.precio_soles.toFixed(2);
    inputMonto.placeholder = `Monto exacto: ${formatearSoles(plan.precio_soles)}`;
  }
}

// ═══════════════════════════════════════════════════════
// SUBIR VOUCHER Y ENVIAR SOLICITUD
// ═══════════════════════════════════════════════════════

async function handleEnviarSolicitud(e) {
  e.preventDefault();

  if (!planSeleccionado) {
    toast.warning('Selecciona un plan primero');
    return;
  }

  if (!voucherFile) {
    toast.warning('Adjunta la foto de tu comprobante de pago');
    return;
  }

  const form = document.getElementById('form-voucher');
  const monto = parseFloat(form.querySelector('#monto-declarado').value);
  const nroOp = form.querySelector('#numero-operacion').value.trim();
  const banco = form.querySelector('#banco-origen').value.trim();

  // Validaciones
  if (!monto || monto <= 0) { toast.error('Ingresa el monto depositado'); return; }
  if (!nroOp) { toast.error('Ingresa el número de operación'); return; }

  const btnEnviar = form.querySelector('#btn-enviar-solicitud');
  btnEnviar.disabled = true;
  btnEnviar.innerHTML = '<span class="btn-spinner"></span> Enviando...';
  showLoading('Subiendo comprobante...');

  try {
    // Subir voucher a Storage
    const { url: voucherUrl, path, error: uploadError } = await subirVoucher(voucherFile, perfil.id);
    if (uploadError) throw uploadError;

    // Crear solicitud de recarga en DB
    const { error: recargaError } = await crearRecarga({
      plan_id:          planSeleccionado.id,
      monto_declarado:  monto,
      numero_operacion: nroOp,
      banco_origen:     banco || null,
      voucher_url:      path, // Guardamos el path (no la URL firmada que expira)
    });

    if (recargaError) throw recargaError;

    toast.success(
      '¡Solicitud enviada! Revisaremos tu comprobante en breve y activaremos tu plan.',
      'Solicitud recibida'
    );

    // Redirigir al historial
    setTimeout(() => { window.location.href = 'historial.html'; }, 2500);

  } catch (err) {
    toast.error(err.message || 'Error al enviar la solicitud');
    btnEnviar.disabled = false;
    btnEnviar.textContent = 'Enviar solicitud';
  } finally {
    hideLoading();
  }
}

// ═══════════════════════════════════════════════════════
// EVENTOS
// ═══════════════════════════════════════════════════════

function bindEventos() {
  // Cambio de fechas
  document.getElementById('fecha-inicio')?.addEventListener('change', (e) => {
    fechaInicio = new Date(e.target.value).toISOString();
    if (planSeleccionado?.duracion_horas) {
      const fin = new Date(e.target.value);
      fin.setHours(fin.getHours() + planSeleccionado.duracion_horas);
      fechaFin = fin.toISOString();
      const inputFin = document.getElementById('fecha-fin');
      if (inputFin) inputFin.value = fin.toISOString().slice(0, 16);
    }
    verificarYMostrarDisponibilidad();
  });

  document.getElementById('fecha-fin')?.addEventListener('change', (e) => {
    fechaFin = new Date(e.target.value).toISOString();
    verificarYMostrarDisponibilidad();
  });

  // Upload voucher
  const voucherZone = document.getElementById('voucher-zone');
  const voucherInput = document.getElementById('voucher-input');

  if (voucherZone && voucherInput) {
    voucherZone.addEventListener('click', () => voucherInput.click());
    voucherInput.addEventListener('change', () => {
      const file = voucherInput.files[0];
      if (file) procesarVoucher(file);
    });
    voucherZone.addEventListener('dragover', (e) => { e.preventDefault(); voucherZone.classList.add('dragover'); });
    voucherZone.addEventListener('dragleave', () => voucherZone.classList.remove('dragover'));
    voucherZone.addEventListener('drop', (e) => {
      e.preventDefault();
      voucherZone.classList.remove('dragover');
      if (e.dataTransfer.files[0]) procesarVoucher(e.dataTransfer.files[0]);
    });
  }

  // Formulario de solicitud
  document.getElementById('form-voucher')?.addEventListener('submit', handleEnviarSolicitud);
}

function procesarVoucher(file) {
  const tipos = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!tipos.includes(file.type)) {
    toast.error('Solo se aceptan imágenes JPG o PNG para el comprobante');
    return;
  }
  if (!validarTamanoArchivo(file, 5)) {
    toast.error('La imagen del comprobante no puede superar 5MB');
    return;
  }

  voucherFile = file;
  const zone = document.getElementById('voucher-zone');
  const preview = URL.createObjectURL(file);

  if (zone) {
    zone.innerHTML = `
      <img src="${preview}" alt="Comprobante" style="max-height:200px;max-width:100%;object-fit:contain;border-radius:8px">
      <p style="margin-top:8px;font-size:0.75rem;color:var(--text-muted)">${escapeHtml(file.name)} • Click para cambiar</p>
    `;
  }
}

// ── ARRANCAR ──
document.addEventListener('DOMContentLoaded', init);
