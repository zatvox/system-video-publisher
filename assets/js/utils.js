/**
 * utils.js - ZV Publicidad Digital
 * Funciones auxiliares reutilizables en todo el sistema
 */

// ═══════════════════════════════════════════════════════
// NOTIFICACIONES (TOAST)
// ═══════════════════════════════════════════════════════

let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);
    }
  }
  return toastContainer;
}

const TOAST_ICONS = {
  success: '✅',
  error:   '❌',
  warning: '⚠️',
  info:    'ℹ️'
};

/**
 * Muestra una notificación toast.
 * @param {string} mensaje
 * @param {'success'|'error'|'warning'|'info'} tipo
 * @param {string} titulo - Título opcional
 * @param {number} duracion - ms (0 = permanente)
 */
export function showToast(mensaje, tipo = 'info', titulo = '', duracion = 4000) {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');

  toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${TOAST_ICONS[tipo]}</span>
    <div class="toast-content">
      ${titulo ? `<div class="toast-title">${escapeHtml(titulo)}</div>` : ''}
      <div class="toast-msg">${escapeHtml(mensaje)}</div>
    </div>
    <button class="toast-close" aria-label="Cerrar notificación">×</button>
  `;

  const closeBtn = toast.querySelector('.toast-close');
  const dismiss = () => {
    toast.style.animation = 'toastOut 200ms ease forwards';
    setTimeout(() => toast.remove(), 200);
  };
  closeBtn.addEventListener('click', dismiss);

  container.appendChild(toast);

  if (duracion > 0) {
    setTimeout(dismiss, duracion);
  }

  return toast;
}

export const toast = {
  success: (msg, titulo = 'Éxito')      => showToast(msg, 'success', titulo),
  error:   (msg, titulo = 'Error')      => showToast(msg, 'error',   titulo, 6000),
  warning: (msg, titulo = 'Atención')   => showToast(msg, 'warning', titulo),
  info:    (msg, titulo = '')            => showToast(msg, 'info',    titulo),
};

// ═══════════════════════════════════════════════════════
// MODAL DE CONFIRMACIÓN
// ═══════════════════════════════════════════════════════

/**
 * Muestra un modal de confirmación y retorna una Promise<boolean>.
 * @param {{ titulo, mensaje, textoConfirmar, tipoBtnConfirmar }} opciones
 */
export function confirmar({
  titulo = '¿Estás seguro?',
  mensaje = 'Esta acción no se puede deshacer.',
  textoConfirmar = 'Confirmar',
  tipoBtnConfirmar = 'danger'
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'confirm-title');

    backdrop.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 id="confirm-title">${escapeHtml(titulo)}</h3>
          <button class="modal-close" aria-label="Cancelar">×</button>
        </div>
        <div class="modal-body">
          <p>${escapeHtml(mensaje)}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost btn-cancel">Cancelar</button>
          <button class="btn btn-${tipoBtnConfirmar} btn-confirm">${escapeHtml(textoConfirmar)}</button>
        </div>
      </div>
    `;

    const close = (result) => {
      backdrop.remove();
      resolve(result);
    };

    backdrop.querySelector('.modal-close').addEventListener('click', () => close(false));
    backdrop.querySelector('.btn-cancel').addEventListener('click', () => close(false));
    backdrop.querySelector('.btn-confirm').addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(false); });

    document.body.appendChild(backdrop);
    backdrop.querySelector('.btn-confirm').focus();
  });
}

// ═══════════════════════════════════════════════════════
// LOADING OVERLAY
// ═══════════════════════════════════════════════════════

let loadingOverlay = null;
let loadingCount = 0;

export function showLoading(mensaje = 'Cargando...') {
  loadingCount++;
  if (!loadingOverlay) {
    loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'loading-overlay';
    loadingOverlay.setAttribute('role', 'status');
    loadingOverlay.setAttribute('aria-label', mensaje);
    loadingOverlay.innerHTML = `
      <div style="text-align:center">
        <div class="spinner" aria-hidden="true"></div>
        <p style="margin-top:12px;font-size:0.875rem;color:var(--text-muted)">${escapeHtml(mensaje)}</p>
      </div>
    `;
    document.body.appendChild(loadingOverlay);
  }
}

export function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0 && loadingOverlay) {
    loadingOverlay.remove();
    loadingOverlay = null;
  }
}

// ═══════════════════════════════════════════════════════
// FORMATEO
// ═══════════════════════════════════════════════════════

/**
 * Formatea un número como moneda en soles peruanos.
 */
export function formatearSoles(monto) {
  return new Intl.NumberFormat('es-PE', {
    style: 'currency',
    currency: 'PEN',
    minimumFractionDigits: 2
  }).format(monto || 0);
}

/**
 * Formatea una fecha como string legible en español.
 */
export function formatearFecha(isoString, opciones = {}) {
  if (!isoString) return '—';
  const fecha = new Date(isoString);
  const defaults = {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
    timeZone: 'America/Lima'
  };
  return fecha.toLocaleDateString('es-PE', { ...defaults, ...opciones });
}

/**
 * Formatea fecha y hora.
 */
export function formatearFechaHora(isoString) {
  if (!isoString) return '—';
  const fecha = new Date(isoString);
  return fecha.toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Lima'
  });
}

/**
 * Tiempo relativo (hace 5 min, hace 3 días, etc.)
 */
export function tiempoRelativo(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutos = Math.floor(diff / 60000);
  const horas = Math.floor(minutos / 60);
  const dias = Math.floor(horas / 24);

  if (minutos < 1)   return 'Hace un momento';
  if (minutos < 60)  return `Hace ${minutos} min`;
  if (horas < 24)    return `Hace ${horas} h`;
  if (dias < 30)     return `Hace ${dias} día${dias > 1 ? 's' : ''}`;
  return formatearFecha(isoString);
}

/**
 * Calcula días restantes desde hoy hasta una fecha.
 */
export function diasRestantes(fechaFin) {
  if (!fechaFin) return 0;
  const diff = new Date(fechaFin).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

/**
 * Formatea bytes a MB, KB, etc.
 */
export function formatearBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Formatea segundos como mm:ss
 */
export function formatearSegundos(segundos) {
  const m = Math.floor(segundos / 60).toString().padStart(2, '0');
  const s = Math.floor(segundos % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ═══════════════════════════════════════════════════════
// BADGES Y ESTADOS
// ═══════════════════════════════════════════════════════

const ESTADO_CONFIG = {
  // Recargas
  pendiente:      { clase: 'badge-warning', texto: 'Pendiente' },
  aprobado:       { clase: 'badge-success', texto: 'Aprobado' },
  rechazado:      { clase: 'badge-danger',  texto: 'Rechazado' },
  // Contrataciones
  pendiente_pago: { clase: 'badge-warning', texto: 'Pend. pago' },
  activo:         { clase: 'badge-success', texto: 'Activo' },
  vencido:        { clase: 'badge-gray',    texto: 'Vencido' },
  cancelado:      { clase: 'badge-danger',  texto: 'Cancelado' },
  // Usuarios
  suspendido:     { clase: 'badge-danger',  texto: 'Suspendido' },
  eliminado:      { clase: 'badge-danger',  texto: 'Eliminado' },
};

/**
 * Genera HTML de un badge de estado.
 */
export function badgeEstado(estado) {
  const cfg = ESTADO_CONFIG[estado] || { clase: 'badge-gray', texto: estado };
  return `<span class="badge ${cfg.clase}">${cfg.texto}</span>`;
}

/**
 * Badge de tipo de plan.
 */
export function badgePlan(tipo) {
  const colores = {
    mensual: 'badge-primary',
    semanal: 'badge-info',
    diario:  'badge-info',
    hora:    'badge-gray',
    basico:  'badge-gray'
  };
  const nombres = {
    mensual: 'Mensual',
    semanal: 'Semanal',
    diario:  'Diario',
    hora:    'Por Hora',
    basico:  'Básico'
  };
  return `<span class="badge ${colores[tipo] || 'badge-gray'}">${nombres[tipo] || tipo}</span>`;
}

// ═══════════════════════════════════════════════════════
// SEGURIDAD / SANITIZACIÓN
// ═══════════════════════════════════════════════════════

/**
 * Escapa HTML para prevenir XSS.
 * SIEMPRE usar al insertar texto del usuario en el DOM.
 */
export function escapeHtml(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ═══════════════════════════════════════════════════════
// VALIDACIÓN
// ═══════════════════════════════════════════════════════

/**
 * Valida un email.
 */
export function esEmailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Valida contraseña (mínimo 8 caracteres).
 */
export function esContrasenaValida(password) {
  return password && password.length >= 8;
}

/**
 * Valida el tamaño de un archivo.
 * @param {File} file
 * @param {number} maxMb - Tamaño máximo en MB
 */
export function validarTamanoArchivo(file, maxMb) {
  return file.size <= maxMb * 1024 * 1024;
}

/**
 * Valida el tipo MIME de un archivo.
 * @param {File} file
 * @param {string[]} tiposPermitidos - Array de MIME types
 */
export function validarTipoArchivo(file, tiposPermitidos) {
  return tiposPermitidos.includes(file.type);
}

// ═══════════════════════════════════════════════════════
// PAGINACIÓN UI
// ═══════════════════════════════════════════════════════

/**
 * Genera HTML de paginación.
 * @param {number} paginaActual
 * @param {number} totalPaginas
 * @param {Function} onPageChange - Callback(pagina)
 */
export function renderPaginacion(paginaActual, totalPaginas, onPageChange) {
  if (totalPaginas <= 1) return null;

  const nav = document.createElement('nav');
  nav.className = 'pagination';
  nav.setAttribute('aria-label', 'Paginación');

  const crearBtn = (pagina, texto, disabled = false, active = false) => {
    const btn = document.createElement('button');
    btn.className = `page-btn${active ? ' active' : ''}`;
    btn.textContent = texto;
    btn.disabled = disabled;
    btn.setAttribute('aria-label', `Página ${pagina}`);
    if (active) btn.setAttribute('aria-current', 'page');
    if (!disabled && !active) {
      btn.addEventListener('click', () => onPageChange(pagina));
    }
    return btn;
  };

  // Prev
  nav.appendChild(crearBtn(paginaActual - 1, '←', paginaActual === 1));

  // Pages
  const start = Math.max(1, paginaActual - 2);
  const end = Math.min(totalPaginas, paginaActual + 2);

  if (start > 1) {
    nav.appendChild(crearBtn(1, '1'));
    if (start > 2) {
      const dots = document.createElement('span');
      dots.className = 'page-btn';
      dots.textContent = '…';
      dots.style.border = 'none';
      dots.style.cursor = 'default';
      nav.appendChild(dots);
    }
  }

  for (let i = start; i <= end; i++) {
    nav.appendChild(crearBtn(i, String(i), false, i === paginaActual));
  }

  if (end < totalPaginas) {
    if (end < totalPaginas - 1) {
      const dots = document.createElement('span');
      dots.className = 'page-btn';
      dots.textContent = '…';
      dots.style.border = 'none';
      dots.style.cursor = 'default';
      nav.appendChild(dots);
    }
    nav.appendChild(crearBtn(totalPaginas, String(totalPaginas)));
  }

  // Next
  nav.appendChild(crearBtn(paginaActual + 1, '→', paginaActual === totalPaginas));

  return nav;
}

// ═══════════════════════════════════════════════════════
// SIDEBAR MOBILE
// ═══════════════════════════════════════════════════════

/**
 * Inicializa el toggle del sidebar móvil.
 */
export function initSidebarToggle() {
  const toggleBtn = document.querySelector('.btn-sidebar-toggle');
  const sidebar = document.querySelector('.app-sidebar');

  if (!toggleBtn || !sidebar) return;

  // Overlay
  let overlay = document.querySelector('.sidebar-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }

  toggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
  });

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  });
}

/**
 * Marca el ítem de navegación activo en el sidebar
 * basado en la URL actual.
 */
export function marcarNavActivo() {
  const currentPath = window.location.pathname;
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    const href = item.getAttribute('href');
    if (href && currentPath.endsWith(href.replace('../', '').replace('./', ''))) {
      item.classList.add('active');
    }
  });
}

/**
 * Rellena el nombre e inicial del usuario en el sidebar.
 * @param {{ nombre, email, rol }} perfil
 */
export function renderSidebarUser(perfil) {
  const nameEl = document.querySelector('.sidebar-user-name');
  const roleEl = document.querySelector('.sidebar-user-role');
  const avatarEl = document.querySelector('.sidebar-avatar');

  if (nameEl) nameEl.textContent = perfil.nombre || perfil.email;
  if (roleEl) roleEl.textContent = perfil.rol === 'admin' ? 'Administrador' : 'Cliente';
  if (avatarEl) avatarEl.textContent = (perfil.nombre || perfil.email)[0].toUpperCase();
}

// ═══════════════════════════════════════════════════════
// MISC
// ═══════════════════════════════════════════════════════

/**
 * Debounce para optimizar inputs de búsqueda.
 */
export function debounce(fn, ms = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Genera un ID único simple para el cliente.
 */
export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/**
 * Copia texto al portapapeles.
 */
export async function copiarAlPortapapeles(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success('Copiado al portapapeles');
  } catch {
    toast.error('No se pudo copiar');
  }
}
