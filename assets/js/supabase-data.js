/**
 * supabase-data.js - ZV Publicidad Digital
 * Capa de datos: queries, mutations y transformaciones
 * Capa DATA_LAYER del patrón Three-Layer
 *
 * Todas las funciones devuelven { data, error }
 * El error handling está centralizado aquí.
 */

import { supabase } from './supabase-client.js';
import { CONFIG } from './config.js';

// ═══════════════════════════════════════════════════════
// HELPERS INTERNOS
// ═══════════════════════════════════════════════════════

/**
 * Envuelve una query de Supabase con manejo de errores estándar.
 * @param {Promise} queryPromise
 * @returns {{ data: any, error: Error|null }}
 */
async function handleQuery(queryPromise) {
  try {
    const { data, error } = await queryPromise;
    if (error) throw error;
    return { data, error: null };
  } catch (err) {
    console.error('[ZV Data]', err.message || err);
    return { data: null, error: err };
  }
}

// ═══════════════════════════════════════════════════════
// CONFIGURACIÓN DEL NEGOCIO
// ═══════════════════════════════════════════════════════

/**
 * Obtiene toda la configuración del negocio como objeto clave-valor.
 * @returns {{ data: Object, error }}
 */
export async function obtenerConfiguracion() {
  const { data, error } = await handleQuery(
    supabase.from('configuracion_negocio').select('clave, valor')
  );
  if (error) return { data: null, error };

  // Convertir array [{clave, valor}] a objeto {clave: valor}
  const config = {};
  data.forEach(item => { config[item.clave] = item.valor; });
  return { data: config, error: null };
}

/**
 * Actualiza un valor de configuración.
 * @param {string} clave
 * @param {string} valor
 */
export async function actualizarConfiguracion(clave, valor) {
  return handleQuery(
    supabase.from('configuracion_negocio')
      .update({ valor, updated_at: new Date().toISOString() })
      .eq('clave', clave)
  );
}

// ═══════════════════════════════════════════════════════
// PLANES
// ═══════════════════════════════════════════════════════

/**
 * Lista todos los planes activos.
 */
export async function obtenerPlanes(soloActivos = true) {
  let query = supabase.from('planes').select('*').order('orden_display');
  if (soloActivos) query = query.eq('activo', true);
  return handleQuery(query);
}

/**
 * Obtiene un plan por ID.
 */
export async function obtenerPlanPorId(id) {
  return handleQuery(
    supabase.from('planes').select('*').eq('id', id).single()
  );
}

/**
 * Crea un nuevo plan (admin).
 */
export async function crearPlan(datos) {
  return handleQuery(
    supabase.from('planes').insert(datos).select().single()
  );
}

/**
 * Actualiza un plan (admin).
 */
export async function actualizarPlan(id, datos) {
  return handleQuery(
    supabase.from('planes')
      .update({ ...datos, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single()
  );
}

// ═══════════════════════════════════════════════════════
// USUARIOS
// ═══════════════════════════════════════════════════════

/**
 * Obtiene el perfil del usuario actual.
 */
export async function obtenerPerfilActual() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('No autenticado') };
  return handleQuery(
    supabase.from('usuarios').select('*').eq('id', user.id).single()
  );
}

/**
 * Actualiza el perfil del usuario actual.
 */
export async function actualizarPerfil(datos) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('No autenticado') };
  return handleQuery(
    supabase.from('usuarios')
      .update({ ...datos, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select().single()
  );
}

/**
 * Lista todos los clientes (admin).
 * @param {{ page, search, estado }} opciones
 */
export async function listarClientes({ page = 1, search = '', estado = '' } = {}) {
  const pageSize = CONFIG.PAGINATION.PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from('usuarios')
    .select(`
      *,
      contrataciones!contrataciones_cliente_id_fkey(id, estado),
      recargas!recargas_cliente_id_fkey(monto_declarado, estado)
    `, { count: 'exact' })
    .eq('rol', 'cliente')
    .order('created_at', { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(`nombre.ilike.%${search}%,email.ilike.%${search}%`);
  }
  if (estado) query = query.eq('estado', estado);

  const { data, error, count } = await query;

  // Calcular campos derivados desde los joins
  const enriched = (data || []).map(c => ({
    ...c,
    contrataciones_activas: (c.contrataciones || []).filter(ct => ct.estado === 'activo').length,
    total_pagado: (c.recargas || [])
      .filter(r => r.estado === 'aprobado')
      .reduce((sum, r) => sum + (parseFloat(r.monto_declarado) || 0), 0)
  }));

  return { data: enriched, error, count };
}

/**
 * Obtiene un cliente por ID (admin).
 */
export async function obtenerClientePorId(id) {
  return handleQuery(
    supabase.from('usuarios').select('*').eq('id', id).single()
  );
}

/**
 * Cambia el estado de un usuario (admin): activo/suspendido/eliminado
 */
export async function cambiarEstadoUsuario(id, estado) {
  return handleQuery(
    supabase.from('usuarios')
      .update({ estado, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select().single()
  );
}

// ═══════════════════════════════════════════════════════
// RECARGAS (VOUCHERS)
// ═══════════════════════════════════════════════════════

/**
 * Lista recargas del usuario actual.
 */
export async function misRecargas({ page = 1 } = {}) {
  const pageSize = CONFIG.PAGINATION.PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  return handleQuery(
    supabase.from('recargas')
      .select('*, planes(nombre, tipo, precio_soles)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to)
  );
}

/**
 * Crea una solicitud de recarga.
 * @param {{ plan_id, monto_declarado, numero_operacion, banco_origen, voucher_url }} datos
 */
export async function crearRecarga(datos) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('No autenticado') };

  return handleQuery(
    supabase.from('recargas').insert({
      cliente_id: user.id,
      ...datos
    }).select().single()
  );
}

/**
 * Lista recargas pendientes (admin).
 * @param {{ page, estado }} opciones
 */
export async function listarRecargas({ page = 1, estado = 'pendiente' } = {}) {
  const pageSize = CONFIG.PAGINATION.PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from('recargas')
    .select(`
      *,
      planes(nombre, tipo, precio_soles),
      usuarios!recargas_cliente_id_fkey(nombre, email)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (estado) query = query.eq('estado', estado);

  const { data, error, count } = await query;
  return { data, error, count };
}

/**
 * Aprueba una recarga (llama a función SQL).
 */
export async function aprobarRecarga(recargaId, fechaInicio, fechaFin) {
  const { data: { user } } = await supabase.auth.getUser();
  return handleQuery(
    supabase.rpc('aprobar_recarga', {
      p_recarga_id:   recargaId,
      p_admin_id:     user.id,
      p_fecha_inicio: fechaInicio || new Date().toISOString(),
      p_fecha_fin:    fechaFin || null
    })
  );
}

/**
 * Rechaza una recarga con motivo.
 */
export async function rechazarRecarga(recargaId, motivo) {
  const { data: { user } } = await supabase.auth.getUser();
  return handleQuery(
    supabase.rpc('rechazar_recarga', {
      p_recarga_id: recargaId,
      p_admin_id:   user.id,
      p_motivo:     motivo
    })
  );
}

// ═══════════════════════════════════════════════════════
// CONTRATACIONES
// ═══════════════════════════════════════════════════════

/**
 * Lista las contrataciones del usuario actual.
 */
export async function misContrataciones({ page = 1, estado = '' } = {}) {
  const pageSize = CONFIG.PAGINATION.PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from('contrataciones')
    .select('*, planes(nombre, tipo, precio_soles, prioridad_garantizada)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (estado) query = query.eq('estado', estado);

  const { data, error, count } = await query;
  return { data, error, count };
}

/**
 * Obtiene la contratación activa actual del usuario.
 */
export async function contratacionActivaActual() {
  return handleQuery(
    supabase.from('contrataciones')
      .select('*, planes(*)')
      .eq('estado', 'activo')
      .lte('fecha_inicio', new Date().toISOString())
      .gte('fecha_fin', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
  );
}

/**
 * Verifica disponibilidad de slots en un rango de fechas.
 */
export async function verificarDisponibilidad(fechaInicio, fechaFin) {
  return handleQuery(
    supabase.rpc('obtener_disponibilidad_slots', {
      p_fecha_inicio: fechaInicio,
      p_fecha_fin:    fechaFin
    })
  );
}

/**
 * Listar contrataciones de admin.
 */
export async function listarContrataciones({ page = 1, estado = '', clienteId = '' } = {}) {
  const pageSize = CONFIG.PAGINATION.PAGE_SIZE;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase.from('contrataciones')
    .select(`
      *,
      planes(nombre, tipo, precio_soles),
      usuarios!contrataciones_cliente_id_fkey(nombre, email)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (estado) query = query.eq('estado', estado);
  if (clienteId) query = query.eq('cliente_id', clienteId);

  const { data, error, count } = await query;
  return { data, error, count };
}

// ═══════════════════════════════════════════════════════
// ANUNCIOS
// ═══════════════════════════════════════════════════════

/**
 * Lista los anuncios del usuario actual.
 */
export async function misAnuncios({ contratacionId = '' } = {}) {
  let query = supabase.from('anuncios')
    .select('*, contrataciones(estado, fecha_inicio, fecha_fin, planes(nombre, tipo))')
    .order('created_at', { ascending: false });

  if (contratacionId) query = query.eq('contratacion_id', contratacionId);

  return handleQuery(query);
}

/**
 * Crea un nuevo anuncio.
 * @param {{ contratacion_id, tipo, archivo_url, nombre_archivo }} datos
 */
export async function crearAnuncio(datos) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { data: null, error: new Error('No autenticado') };

  return handleQuery(
    supabase.from('anuncios').insert({
      cliente_id: user.id,
      duracion_seg: 10,
      ...datos
    }).select().single()
  );
}

/**
 * Activa un anuncio específico y desactiva los demás de la misma contratación.
 * (Usado en plan Mensual para cambiar el anuncio activo)
 */
export async function activarAnuncio(anuncioId, contratacionId) {
  // Primero desactivar todos de la contratación
  await supabase.from('anuncios')
    .update({ es_activo: false })
    .eq('contratacion_id', contratacionId);

  // Luego activar el seleccionado
  return handleQuery(
    supabase.from('anuncios')
      .update({ es_activo: true, updated_at: new Date().toISOString() })
      .eq('id', anuncioId)
      .select().single()
  );
}

/**
 * Elimina un anuncio (y su archivo en Storage).
 */
export async function eliminarAnuncio(anuncioId, archivoUrl) {
  // Extraer el path del archivo de Storage
  if (archivoUrl) {
    const urlObj = new URL(archivoUrl);
    const pathParts = urlObj.pathname.split('/storage/v1/object/public/anuncios/');
    if (pathParts[1]) {
      await supabase.storage.from(CONFIG.STORAGE.BUCKET_ANUNCIOS).remove([pathParts[1]]);
    }
  }

  return handleQuery(
    supabase.from('anuncios').delete().eq('id', anuncioId)
  );
}

/**
 * Obtiene los anuncios para el reproductor TV (vista pública).
 */
export async function obtenerCarruselActual() {
  return handleQuery(
    supabase.from('vista_carrusel_actual').select('*')
  );
}

// ═══════════════════════════════════════════════════════
// STORAGE: SUBIR ARCHIVOS
// ═══════════════════════════════════════════════════════

/**
 * Sube un archivo de anuncio (imagen o video) a Supabase Storage.
 * @param {File} file - Archivo a subir
 * @param {string} userId - ID del usuario
 * @returns {{ url: string, error }} URL pública del archivo
 */
export async function subirAnuncio(file, userId) {
  const ext = file.name.split('.').pop().toLowerCase();
  const filename = `${userId}/${Date.now()}.${ext}`;

  const { data, error } = await supabase.storage
    .from(CONFIG.STORAGE.BUCKET_ANUNCIOS)
    .upload(filename, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });

  if (error) return { url: null, error };

  const { data: { publicUrl } } = supabase.storage
    .from(CONFIG.STORAGE.BUCKET_ANUNCIOS)
    .getPublicUrl(filename);

  return { url: publicUrl, error: null };
}

/**
 * Sube una imagen de voucher a Supabase Storage.
 * @param {File} file - Imagen del voucher
 * @param {string} userId - ID del usuario
 * @returns {{ url: string, error }}
 */
export async function subirVoucher(file, userId) {
  const ext = file.name.split('.').pop().toLowerCase();
  const filename = `${userId}/${Date.now()}.${ext}`;

  const { data, error } = await supabase.storage
    .from(CONFIG.STORAGE.BUCKET_VOUCHERS)
    .upload(filename, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type
    });

  if (error) return { url: null, error };

  // Vouchers son privados; generar URL firmada válida por 1 hora
  const { data: { signedUrl }, error: signError } = await supabase.storage
    .from(CONFIG.STORAGE.BUCKET_VOUCHERS)
    .createSignedUrl(filename, 3600);

  if (signError) return { url: null, error: signError };
  return { url: signedUrl, path: filename, error: null };
}

/**
 * Genera URL firmada para un voucher privado (admin).
 */
export async function obtenerUrlVoucher(path) {
  const { data: { signedUrl }, error } = await supabase.storage
    .from(CONFIG.STORAGE.BUCKET_VOUCHERS)
    .createSignedUrl(path, 3600);
  return { url: signedUrl, error };
}

// ═══════════════════════════════════════════════════════
// PANTALLAS (TVs)
// ═══════════════════════════════════════════════════════

/**
 * Lista las pantallas registradas.
 */
export async function listarPantallas() {
  return handleQuery(
    supabase.from('pantallas').select('*').order('nombre')
  );
}

/**
 * Crea una nueva pantalla.
 */
export async function crearPantalla(datos) {
  return handleQuery(
    supabase.from('pantallas').insert(datos).select().single()
  );
}

/**
 * Actualiza una pantalla.
 */
export async function actualizarPantalla(id, datos) {
  return handleQuery(
    supabase.from('pantallas').update(datos).eq('id', id).select().single()
  );
}

/**
 * Actualiza heartbeat de una pantalla TV.
 */
export async function heartbeatPantalla(id) {
  return handleQuery(
    supabase.from('pantallas')
      .update({ ultima_conexion: new Date().toISOString() })
      .eq('id', id)
  );
}

// ═══════════════════════════════════════════════════════
// DASHBOARD ADMIN
// ═══════════════════════════════════════════════════════

/**
 * Obtiene métricas para el dashboard del admin.
 */
export async function resumenAdminDashboard() {
  return handleQuery(supabase.rpc('resumen_admin_dashboard'));
}

/**
 * Obtiene ingresos por período para reportes.
 */
export async function obtenerIngresosPorMes(meses = 6) {
  const fechaDesde = new Date();
  fechaDesde.setMonth(fechaDesde.getMonth() - meses);

  return handleQuery(
    supabase.from('recargas')
      .select('monto_declarado, validado_en, planes(nombre, tipo)')
      .eq('estado', 'aprobado')
      .gte('validado_en', fechaDesde.toISOString())
      .order('validado_en')
  );
}
