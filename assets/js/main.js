/**
 * main.js - ZV Publicidad Digital
 * Lógica global: inicialización, sidebar, logout
 * Se importa en todas las páginas protegidas del panel
 */

import { cerrarSesion, onAuthStateChange } from './auth.js';
import { initSidebarToggle, marcarNavActivo, renderSidebarUser, toast } from './utils.js';

/**
 * Inicializa el panel (sidebar, logout, etc.)
 * @param {Object} perfil - Perfil del usuario actual
 */
export function initPanel(perfil) {
  // Renderizar datos de usuario en sidebar
  if (perfil) renderSidebarUser(perfil);

  // Toggle sidebar en mobile
  initSidebarToggle();

  // Marcar ítem activo en nav
  marcarNavActivo();

  // Botón logout
  document.querySelectorAll('[data-action="logout"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      await cerrarSesion();
    });
  });

  // Cerrar dropdowns al hacer click fuera
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown')) {
      document.querySelectorAll('.dropdown-menu').forEach(menu => {
        menu.classList.add('hidden');
      });
    }
  });

  // Dropdowns
  document.querySelectorAll('[data-dropdown-toggle]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetId = btn.dataset.dropdownToggle;
      const menu = document.getElementById(targetId);
      if (menu) menu.classList.toggle('hidden');
    });
  });

  // Escuchar cambio de autenticación (logout externo)
  onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      window.location.href = '../login.html';
    }
  });
}

/**
 * Resalta la ruta de navegación activa.
 */
export function actualizarBreadcrumb(titulo, ruta = '') {
  const h1 = document.querySelector('.header-breadcrumb h1');
  const path = document.querySelector('.header-breadcrumb .breadcrumb-path');
  if (h1) h1.textContent = titulo;
  if (path && ruta) path.textContent = ruta;
}

/**
 * Muestra conteo de recargas pendientes en el badge del sidebar (solo admin).
 * @param {number} cantidad
 */
export function actualizarBadgeValidaciones(cantidad) {
  const badge = document.querySelector('[data-badge="validaciones"]');
  if (!badge) return;
  if (cantidad > 0) {
    badge.textContent = cantidad;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}
