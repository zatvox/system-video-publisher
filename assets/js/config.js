/**
 * config.js - ZV Publicidad Digital
 * Configuración global del sistema
 *
 * ⚠️  IMPORTANTE: Antes de desplegar, reemplaza las variables
 *     SUPABASE_URL y SUPABASE_ANON_KEY con las tuyas.
 *     Estas variables son seguras para estar en código público
 *     (son la clave anónima, no la de servicio).
 *     NUNCA pongas la SERVICE_ROLE_KEY aquí.
 */

export const CONFIG = {
  // ── SUPABASE ──────────────────────────────────
  SUPABASE_URL:      'https://lepzvqrtkoichsxyjtse.supabase.co',   // ← Reemplazar
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxlcHp2cXJ0a29pY2hzeHlqdHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1MjcwMTEsImV4cCI6MjA5ODEwMzAxMX0.rHBoVArG6smT2x8YW5C3oG19w_t7F6gEXKsOkILaSik', // ← Reemplazar

  // ── APLICACIÓN ───────────────────────────────
  APP_NAME:          'ZV Publicidad Digital',
  APP_VERSION:       '1.0.0',

  // ── RUTAS (relativas a la raíz del proyecto) ──
  ROUTES: {
    HOME:              '../index.html',
    LOGIN:             'login.html',
    REGISTRO:          'registro.html',
    TV_PLAYER:         '../tv.html',
    CLIENTE: {
      DASHBOARD:       'cliente/dashboard.html',
      MIS_ANUNCIOS:    'cliente/mis-anuncios.html',
      RECARGAR:        'cliente/recargar.html',
      HISTORIAL:       'cliente/historial.html',
    },
    ADMIN: {
      DASHBOARD:       'admin/dashboard.html',
      VALIDACIONES:    'admin/validaciones.html',
      CLIENTES:        'admin/clientes.html',
      PLANES:          'admin/planes.html',
      PANTALLAS:       'admin/pantallas.html',
      REPORTES:        'admin/reportes.html',
    }
  },

  // ── STORAGE ──────────────────────────────────
  STORAGE: {
    BUCKET_VOUCHERS:   'vouchers',     // Imágenes de comprobantes de pago
    BUCKET_ANUNCIOS:   'anuncios',     // Archivos de anuncios (imagen/video)
    MAX_SIZE_VIDEO_MB: 15,
    MAX_SIZE_IMG_MB:   5,
    TIPOS_VIDEO:       ['video/mp4'],
    TIPOS_IMAGEN:      ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
  },

  // ── REPRODUCTOR TV ───────────────────────────
  TV: {
    DURACION_ANUNCIO_SEG: 10,          // Duración fija de cada anuncio
    SLOTS_POR_VUELTA:     6,           // Anuncios por vuelta del bucle (60 seg)
    POLLING_INTERVAL_MS:  60000,       // Refrescar la cola cada 60 segundos
    HORARIO_INICIO:       '08:00',     // Estos valores se sobreescriben desde DB
    HORARIO_FIN:          '19:00',
  },

  // ── PAGINACIÓN ───────────────────────────────
  PAGINATION: {
    PAGE_SIZE: 20,
  },

  // ── SESIÓN ───────────────────────────────────
  SESSION: {
    STORAGE_KEY: 'zv_session',
  }
};

export default CONFIG;
