/**
 * auth.js - ZV Publicidad Digital
 * Gestión de autenticación con Supabase Auth
 */

import { supabase } from './supabase-client.js';
import { CONFIG } from './config.js';

// ═══════════════════════════════════════════════════════
// RUTAS CALCULADAS DESDE EL SUBDIRECTORIO ACTUAL
// ═══════════════════════════════════════════════════════

/**
 * Detecta si estamos en /pages/ o en la raíz
 */
function getRootPath() {
  const path = window.location.pathname;
  if (path.includes('/pages/admin/') || path.includes('/pages/cliente/')) return '../../';
  if (path.includes('/pages/')) return '../';
  return './';
}

function getLoginUrl() {
  return `${getRootPath()}pages/login.html`;
}

function getDashboardUrl(rol) {
  const root = getRootPath();
  if (rol === 'admin') return `${root}pages/admin/dashboard.html`;
  return `${root}pages/cliente/dashboard.html`;
}

// ═══════════════════════════════════════════════════════
// REGISTRO
// ═══════════════════════════════════════════════════════

/**
 * Registra un nuevo cliente.
 * @param {{ email, password, nombre, telefono }} datos
 */
export async function registrarCliente({ email, password, nombre, telefono }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { nombre, telefono, rol: 'cliente' }
    }
  });

  if (error) return { data: null, error };
  return { data, error: null };
}

// ═══════════════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════════════

/**
 * Inicia sesión con email y contraseña.
 * @param {{ email, password }} credenciales
 */
export async function iniciarSesion({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { data: null, error };
  return { data, error: null };
}

// ═══════════════════════════════════════════════════════
// LOGOUT
// ═══════════════════════════════════════════════════════

/**
 * Cierra la sesión del usuario actual y redirige al login.
 */
export async function cerrarSesion() {
  await supabase.auth.signOut();
  window.location.href = `${getRootPath()}index.html`;
}

// ═══════════════════════════════════════════════════════
// SESIÓN ACTUAL
// ═══════════════════════════════════════════════════════

/**
 * Obtiene la sesión actual del usuario.
 * @returns {{ session, user } | null}
 */
export async function obtenerSesion() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return null;
  return session;
}

/**
 * Obtiene el usuario actual con su perfil.
 * @returns {Object|null}
 */
export async function obtenerUsuarioActual() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  // Obtener perfil extendido
  const { data: perfil } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', user.id)
    .single();

  return { ...user, perfil };
}

// ═══════════════════════════════════════════════════════
// PROTECCIÓN DE RUTAS
// ═══════════════════════════════════════════════════════

/**
 * Verifica autenticación y redirige al login si no está autenticado.
 * Uso: llamar al inicio de cada página protegida.
 * @param {'admin'|'cliente'|null} rolRequerido - null = cualquier rol autenticado
 * @returns {Object} Perfil del usuario autenticado
 */
export async function requireAuth(rolRequerido = null) {
  const sesion = await obtenerSesion();

  if (!sesion) {
    window.location.href = getLoginUrl();
    return null;
  }

  const usuario = await obtenerUsuarioActual();
  if (!usuario || !usuario.perfil) {
    await cerrarSesion();
    return null;
  }

  // Verificar estado activo
  if (usuario.perfil.estado !== 'activo') {
    await cerrarSesion();
    return null;
  }

  // Verificar rol requerido
  if (rolRequerido && usuario.perfil.rol !== rolRequerido) {
    // Redirigir al dashboard correcto
    window.location.href = getDashboardUrl(usuario.perfil.rol);
    return null;
  }

  return usuario.perfil;
}

/**
 * Redirige al dashboard si ya está autenticado.
 * Uso: en páginas de login/registro para no mostrarlas a usuarios ya logueados.
 */
export async function redirectIfAuthenticated() {
  const usuario = await obtenerUsuarioActual();
  if (usuario && usuario.perfil) {
    window.location.href = getDashboardUrl(usuario.perfil.rol);
  }
}

// ═══════════════════════════════════════════════════════
// CAMBIO DE CONTRASEÑA
// ═══════════════════════════════════════════════════════

/**
 * Envía email de recuperación de contraseña.
 */
export async function olvideMiContrasena(email) {
  const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/pages/login.html?reset=true`
  });
  return { data, error };
}

/**
 * Actualiza la contraseña (desde el link de recuperación).
 */
export async function actualizarContrasena(nuevaContrasena) {
  const { data, error } = await supabase.auth.updateUser({
    password: nuevaContrasena
  });
  return { data, error };
}

// ═══════════════════════════════════════════════════════
// ESCUCHAR CAMBIOS DE AUTH
// ═══════════════════════════════════════════════════════

/**
 * Suscribe a cambios de sesión (útil para sincronizar UI).
 * @param {Function} callback - (event, session) => void
 */
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange(callback);
}
