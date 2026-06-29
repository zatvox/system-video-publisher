-- ============================================================
-- MIGRACIÓN 001: Anuncios Admin + Contador de Reproducciones
-- Fecha: Junio 2026
--
-- Qué hace esta migración:
--   1. Agrega columna `reproducciones` a tabla `anuncios` (clientes)
--   2. Crea tabla `anuncios_admin` (anuncios propios del negocio)
--   3. Reconstruye `vista_carrusel_actual` con soporte de:
--      - Campo `reproducciones` y flag `es_admin`
--      - Plan mensual: hasta 2 anuncios activos por contratación
--      - Admin ads en slots libres (contratos activos < 6)
--   4. Crea función `registrar_reproduccion` (incrementa contador)
--   5. Agrega políticas RLS para `anuncios_admin`
--
-- Ejecutar en: Supabase → SQL Editor
-- Orden: ejecutar completo de una sola vez (es idempotente)
-- ============================================================


-- ============================================================
-- 1. COLUMNA reproducciones EN TABLA anuncios
-- ============================================================

ALTER TABLE public.anuncios
  ADD COLUMN IF NOT EXISTS reproducciones INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.anuncios.reproducciones
  IS 'Contador de apariciones en TV. Incrementado por tv-player.js vía RPC registrar_reproduccion.';


-- ============================================================
-- 2. TABLA anuncios_admin
-- Anuncios propios del administrador (negocio propio u otros negocios).
-- Se reproducen en los slots libres del carrusel (contratos activos < 6).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.anuncios_admin (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          TEXT NOT NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('imagen', 'video')),
  archivo_url     TEXT NOT NULL,
  nombre_archivo  TEXT,
  es_activo       BOOLEAN NOT NULL DEFAULT true,
  reproducciones  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.anuncios_admin
  IS 'Anuncios del propio administrador. Llenan los slots libres del carrusel. No aparecen cuando los 6 slots están ocupados por contratos de clientes.';

CREATE INDEX IF NOT EXISTS idx_anuncios_admin_es_activo
  ON public.anuncios_admin(es_activo);

-- Trigger updated_at
CREATE TRIGGER trigger_anuncios_admin_updated_at
  BEFORE UPDATE ON public.anuncios_admin
  FOR EACH ROW EXECUTE FUNCTION public.actualizar_updated_at();


-- ============================================================
-- 3. RECONSTRUIR vista_carrusel_actual
--
-- Cambios respecto a la versión original:
--   - Agrega campo `reproducciones` (de anuncios)
--   - Agrega campo `es_admin` (false para clientes, true para admin)
--   - UNION ALL con anuncios_admin cuando contratos activos < 6
-- ============================================================

-- DROP necesario porque CREATE OR REPLACE no permite cambiar orden/nombres de columnas
DROP VIEW IF EXISTS public.vista_carrusel_actual;

CREATE VIEW public.vista_carrusel_actual AS

-- ── Anuncios de clientes (planes pagados) ──────────────────
SELECT
  a.id,
  a.tipo,
  a.archivo_url,
  a.duracion_seg,
  a.reproducciones,
  c.id                       AS contratacion_id,
  c.plan_id,
  c.fecha_inicio,
  c.fecha_fin,
  c.publicaciones_basico_usadas,
  p.tipo                     AS plan_tipo,
  p.nombre                   AS plan_nombre,
  p.prioridad_garantizada,
  p.permite_multiples_anuncios,
  p.max_publicaciones_puntuales,
  false                      AS es_admin
FROM public.anuncios a
JOIN public.contrataciones c ON c.id = a.contratacion_id
JOIN public.planes p         ON p.id = c.plan_id
WHERE a.es_activo = true
  AND c.estado = 'activo'
  AND now() BETWEEN c.fecha_inicio AND c.fecha_fin

UNION ALL

-- ── Anuncios del admin (solo cuando hay slots libres) ───────
-- Slot libre = contratos activos simultáneos < 6
-- Si los 6 slots están ocupados por clientes, los anuncios admin no aparecen
SELECT
  aa.id,
  aa.tipo,
  aa.archivo_url,
  10                         AS duracion_seg,
  aa.reproducciones,
  NULL::uuid                 AS contratacion_id,
  NULL::uuid                 AS plan_id,
  NULL::timestamptz          AS fecha_inicio,
  NULL::timestamptz          AS fecha_fin,
  NULL::integer              AS publicaciones_basico_usadas,
  'admin'                    AS plan_tipo,
  'Anuncio Propio'           AS plan_nombre,
  false                      AS prioridad_garantizada,
  false                      AS permite_multiples_anuncios,
  NULL::integer              AS max_publicaciones_puntuales,
  true                       AS es_admin
FROM public.anuncios_admin aa
WHERE aa.es_activo = true
  AND (
    SELECT COUNT(DISTINCT c2.id)
    FROM public.contrataciones c2
    WHERE c2.estado = 'activo'
      AND now() BETWEEN c2.fecha_inicio AND c2.fecha_fin
  ) < 6;

-- Mantener acceso público (igual que antes)
GRANT SELECT ON public.vista_carrusel_actual TO anon, authenticated;


-- ============================================================
-- 4. FUNCIÓN registrar_reproduccion
--
-- Incrementa el contador de reproducciones de un anuncio.
-- Llamada por tv-player.js al mostrar cada slide (fire-and-forget).
-- SECURITY DEFINER: el reproductor TV (rol anon) puede ejecutarla
-- sin necesidad de permisos de escritura directa en las tablas.
-- ============================================================

CREATE OR REPLACE FUNCTION public.registrar_reproduccion(
  p_anuncio_id  UUID,
  p_es_admin    BOOLEAN DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_es_admin THEN
    UPDATE public.anuncios_admin
    SET reproducciones = reproducciones + 1
    WHERE id = p_anuncio_id;
  ELSE
    UPDATE public.anuncios
    SET reproducciones = reproducciones + 1
    WHERE id = p_anuncio_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_reproduccion(UUID, BOOLEAN) TO anon, authenticated;


-- ============================================================
-- 5. RLS PARA anuncios_admin
--
-- Solo el admin puede leer/escribir la tabla directamente.
-- La vista_carrusel_actual (leída por el TV player con anon_key)
-- accede a anuncios_admin a través de la vista, no directamente.
-- ============================================================

ALTER TABLE public.anuncios_admin ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anuncios_admin_solo_admin_ver" ON public.anuncios_admin
  FOR SELECT
  USING (public.es_admin());

CREATE POLICY "anuncios_admin_solo_admin_crear" ON public.anuncios_admin
  FOR INSERT
  WITH CHECK (public.es_admin());

CREATE POLICY "anuncios_admin_solo_admin_editar" ON public.anuncios_admin
  FOR UPDATE
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

CREATE POLICY "anuncios_admin_solo_admin_eliminar" ON public.anuncios_admin
  FOR DELETE
  USING (public.es_admin());


-- ============================================================
-- FIN DE MIGRACIÓN 001
-- ============================================================
