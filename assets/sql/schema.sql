-- ============================================================
-- SCHEMA.SQL - ZV Publicidad Digital
-- Sistema de Publicidad Digital para Smart TV
-- Versión: 1.0 | Junio 2026
-- ============================================================
-- INSTRUCCIONES: Ejecutar en Supabase SQL Editor en este orden:
-- 1. schema.sql (este archivo)
-- 2. rls-policies.sql
-- 3. functions.sql
-- ============================================================

-- ============================================================
-- EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- Para búsqueda full-text

-- ============================================================
-- TABLA: usuarios
-- Extiende auth.users de Supabase
-- ============================================================
CREATE TABLE IF NOT EXISTS public.usuarios (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT UNIQUE NOT NULL,
  nombre      TEXT NOT NULL,
  telefono    TEXT,
  rol         TEXT NOT NULL DEFAULT 'cliente' CHECK (rol IN ('admin', 'cliente')),
  estado      TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'suspendido', 'eliminado')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.usuarios IS 'Perfiles de usuario que extienden auth.users de Supabase';

-- ============================================================
-- TABLA: planes
-- Catálogo editable de planes publicitarios (admin edita sin tocar código)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.planes (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                      TEXT NOT NULL,
  tipo                        TEXT NOT NULL CHECK (tipo IN ('mensual','semanal','diario','hora','basico')),
  precio_soles                DECIMAL(10,2) NOT NULL CHECK (precio_soles > 0),
  duracion_horas              INTEGER,        -- NULL para 'basico' (usa fechas libres)
  repeticiones_totales        INTEGER,        -- Repeticiones garantizadas del anuncio
  permite_multiples_anuncios  BOOLEAN NOT NULL DEFAULT false,  -- true solo para mensual
  max_publicaciones_puntuales INTEGER,        -- Solo para 'basico' (max 5)
  prioridad_garantizada       BOOLEAN NOT NULL DEFAULT true,   -- false para 'basico'
  descripcion                 TEXT,           -- Texto marketing visible al cliente
  activo                      BOOLEAN NOT NULL DEFAULT true,
  orden_display               INTEGER DEFAULT 0, -- Para ordenar en la UI
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.planes IS 'Catálogo de planes publicitarios - editable por admin desde el panel';

-- Datos iniciales de planes (los precios de las especificaciones)
INSERT INTO public.planes (nombre, tipo, precio_soles, duracion_horas, repeticiones_totales, permite_multiples_anuncios, max_publicaciones_puntuales, prioridad_garantizada, descripcion, orden_display) VALUES
('Mensual',   'mensual',  500.00, 720,  19800, true,  NULL, true,  'Tu anuncio 1 vez por minuto durante 30 días. Puedes cambiar el anuncio cuando quieras.', 1),
('Semanal',   'semanal',  150.00, 168,  4620,  false, NULL, true,  'Tu anuncio 1 vez por minuto durante 7 días.', 2),
('Diario',    'diario',   30.00,  24,   660,   false, NULL, true,  'Tu anuncio 1 vez por minuto durante 1 día completo.', 3),
('Por Hora',  'hora',     5.00,   1,    60,    false, NULL, true,  'Tu anuncio 1 vez por minuto durante 1 hora.', 4),
('Básico',    'basico',   1.00,   NULL, NULL,  false, 5,    false, 'Hasta 5 publicaciones puntuales en los horarios disponibles. Sin slot garantizado.', 5);

-- ============================================================
-- TABLA: configuracion_negocio
-- Parámetros del negocio editables por admin (sin tocar código)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.configuracion_negocio (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clave       TEXT UNIQUE NOT NULL,
  valor       TEXT NOT NULL,
  descripcion TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.configuracion_negocio IS 'Parámetros del negocio editables por admin - cuenta bancaria, horarios, slots, etc.';

-- Configuración inicial del negocio
INSERT INTO public.configuracion_negocio (clave, valor, descripcion) VALUES
('horario_inicio',          '08:00', 'Hora de inicio de transmisión (formato HH:MM)'),
('horario_fin',             '19:00', 'Hora de fin de transmisión (formato HH:MM)'),
('slots_por_vuelta',        '6',     'Cantidad de anuncios por vuelta del bucle (60 segundos)'),
('duracion_anuncio_seg',    '10',    'Duración de cada anuncio en pantalla (segundos)'),
('max_size_video_mb',       '15',    'Tamaño máximo de video en MB'),
('max_size_imagen_mb',      '5',     'Tamaño máximo de imagen en MB'),
('cuenta_banco_nombre',     'BCP',   'Nombre del banco para recibir depósitos'),
('cuenta_numero',           'XXXXXXXXXX', 'Número de cuenta bancaria'),
('cuenta_cci',              'XXXXXXXXXXXXXXXXXX', 'Código CCI de la cuenta'),
('cuenta_titular',          'Jhiro Peru S.A.C.', 'Titular de la cuenta bancaria'),
('nombre_negocio',          'ZV Publicidad Digital', 'Nombre comercial del negocio'),
('contacto_whatsapp',       '+51 XXX XXX XXX', 'WhatsApp de contacto para clientes');

-- ============================================================
-- TABLA: pantallas
-- Smart TVs físicas registradas (v1: todas muestran el mismo contenido)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pantallas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre           TEXT NOT NULL,
  ubicacion        TEXT,
  ultima_conexion  TIMESTAMPTZ,  -- Heartbeat: la TV actualiza esto cada minuto
  activa           BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.pantallas IS 'Smart TVs físicas registradas. En v1 todas muestran el mismo contenido.';

-- ============================================================
-- TABLA: recargas
-- Solicitudes de pago (vouchers de depósito bancario)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.recargas (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id         UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  plan_id            UUID NOT NULL REFERENCES public.planes(id),
  monto_declarado    DECIMAL(10,2) NOT NULL CHECK (monto_declarado > 0),
  numero_operacion   TEXT NOT NULL,
  banco_origen       TEXT,
  voucher_url        TEXT NOT NULL,   -- URL del archivo en Supabase Storage
  estado             TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobado','rechazado')),
  motivo_rechazo     TEXT,            -- Requerido si estado = 'rechazado'
  validado_por       UUID REFERENCES public.usuarios(id),
  validado_en        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.recargas IS 'Vouchers de pago subidos por clientes, pendientes de validación manual por admin';

-- ============================================================
-- TABLA: contrataciones
-- Activación de un plan por un cliente (una vez aprobada la recarga)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.contrataciones (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id                  UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  plan_id                     UUID NOT NULL REFERENCES public.planes(id),
  recarga_id                  UUID REFERENCES public.recargas(id),
  fecha_inicio                TIMESTAMPTZ NOT NULL,
  fecha_fin                   TIMESTAMPTZ NOT NULL,
  estado                      TEXT NOT NULL DEFAULT 'pendiente_pago' CHECK (estado IN ('pendiente_pago','activo','vencido','cancelado')),
  publicaciones_basico_usadas INTEGER DEFAULT 0, -- Solo para plan básico
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fecha_fin_mayor_inicio CHECK (fecha_fin > fecha_inicio)
);

COMMENT ON TABLE public.contrataciones IS 'Cada contratación es un plan comprado por un cliente para un rango de fechas';

-- ============================================================
-- TABLA: anuncios
-- Contenido (foto/video) subido por el cliente para su contratación
-- ============================================================
CREATE TABLE IF NOT EXISTS public.anuncios (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id       UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  contratacion_id  UUID NOT NULL REFERENCES public.contrataciones(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL CHECK (tipo IN ('imagen','video')),
  archivo_url      TEXT NOT NULL,    -- URL del archivo en Supabase Storage
  nombre_archivo   TEXT,             -- Nombre original del archivo
  duracion_seg     INTEGER NOT NULL DEFAULT 10,
  es_activo        BOOLEAN NOT NULL DEFAULT true, -- cuál está "al aire" (para plan mensual con varios anuncios)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.anuncios IS 'Archivos de anuncios (imagen/video) subidos por clientes. es_activo = cuál está en el bucle.';

-- ============================================================
-- TABLA: auditoria
-- Log de acciones importantes del sistema
-- ============================================================
CREATE TABLE IF NOT EXISTS public.auditoria (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id   UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  tabla        TEXT NOT NULL,
  accion       TEXT NOT NULL CHECK (accion IN ('insert','update','delete','login','logout','aprobacion','rechazo')),
  registro_id  UUID,
  datos_nuevos JSONB,
  ip_address   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.auditoria IS 'Log de auditoría de acciones importantes del sistema';

-- ============================================================
-- ÍNDICES para performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_contrataciones_cliente_id   ON public.contrataciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_contrataciones_estado       ON public.contrataciones(estado);
CREATE INDEX IF NOT EXISTS idx_contrataciones_fechas       ON public.contrataciones(fecha_inicio, fecha_fin);
CREATE INDEX IF NOT EXISTS idx_anuncios_cliente_id         ON public.anuncios(cliente_id);
CREATE INDEX IF NOT EXISTS idx_anuncios_contratacion_id    ON public.anuncios(contratacion_id);
CREATE INDEX IF NOT EXISTS idx_anuncios_es_activo          ON public.anuncios(es_activo);
CREATE INDEX IF NOT EXISTS idx_recargas_cliente_id         ON public.recargas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_recargas_estado             ON public.recargas(estado);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol                ON public.usuarios(rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_estado             ON public.usuarios(estado);
CREATE INDEX IF NOT EXISTS idx_auditoria_usuario_id        ON public.auditoria(usuario_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_created_at        ON public.auditoria(created_at);

-- ============================================================
-- TRIGGERS: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION public.actualizar_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_usuarios_updated_at
  BEFORE UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.actualizar_updated_at();

CREATE TRIGGER trigger_planes_updated_at
  BEFORE UPDATE ON public.planes
  FOR EACH ROW EXECUTE FUNCTION public.actualizar_updated_at();

CREATE TRIGGER trigger_contrataciones_updated_at
  BEFORE UPDATE ON public.contrataciones
  FOR EACH ROW EXECUTE FUNCTION public.actualizar_updated_at();

CREATE TRIGGER trigger_anuncios_updated_at
  BEFORE UPDATE ON public.anuncios
  FOR EACH ROW EXECUTE FUNCTION public.actualizar_updated_at();

CREATE TRIGGER trigger_configuracion_updated_at
  BEFORE UPDATE ON public.configuracion_negocio
  FOR EACH ROW EXECUTE FUNCTION public.actualizar_updated_at();

-- ============================================================
-- TRIGGER: crear perfil de usuario automáticamente al registrarse
-- ============================================================
CREATE OR REPLACE FUNCTION public.crear_perfil_usuario()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.usuarios (id, email, nombre, rol)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'rol', 'cliente')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_crear_perfil_nuevo_usuario
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.crear_perfil_usuario();

-- ============================================================
-- TRIGGER: expirar contrataciones automáticamente
-- ============================================================
CREATE OR REPLACE FUNCTION public.expirar_contrataciones()
RETURNS void AS $$
BEGIN
  UPDATE public.contrataciones
  SET estado = 'vencido', updated_at = now()
  WHERE estado = 'activo'
    AND fecha_fin < now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FIN DE SCHEMA.SQL
-- Continuar con rls-policies.sql
-- ============================================================
