-- ============================================================
-- FUNCTIONS.SQL - ZV Publicidad Digital
-- Vistas y funciones SQL del sistema
-- Ejecutar DESPUÉS de schema.sql y rls-policies.sql
-- ============================================================

-- ============================================================
-- VISTA: vista_carrusel_actual
-- Usada por el reproductor TV (sin login, anon_key)
-- Solo expone lo que la TV necesita, SIN datos de clientes
-- ============================================================
CREATE OR REPLACE VIEW public.vista_carrusel_actual AS
SELECT
  a.id,
  a.tipo,
  a.archivo_url,
  a.duracion_seg,
  c.id                    AS contratacion_id,
  c.plan_id,
  c.fecha_inicio,
  c.fecha_fin,
  c.publicaciones_basico_usadas,
  p.tipo                  AS plan_tipo,
  p.nombre                AS plan_nombre,
  p.prioridad_garantizada,
  p.permite_multiples_anuncios,
  p.max_publicaciones_puntuales
FROM public.anuncios a
JOIN public.contrataciones c ON c.id = a.contratacion_id
JOIN public.planes p ON p.id = c.plan_id
WHERE a.es_activo = true
  AND c.estado = 'activo'
  AND now() BETWEEN c.fecha_inicio AND c.fecha_fin;

-- Dar acceso público de lectura a la vista (para el reproductor TV sin auth)
GRANT SELECT ON public.vista_carrusel_actual TO anon, authenticated;

-- ============================================================
-- VISTA: vista_ocupacion_slots
-- Usada por admin para ver ocupación en tiempo real y para
-- el panel cliente al comprar (verificar disponibilidad)
-- ============================================================
CREATE OR REPLACE VIEW public.vista_ocupacion_slots AS
SELECT
  date_trunc('hour', generate_series) AS hora,
  (
    SELECT COUNT(*)
    FROM public.contrataciones c
    JOIN public.planes p ON p.id = c.plan_id
    WHERE c.estado = 'activo'
      AND p.prioridad_garantizada = true
      AND generate_series BETWEEN c.fecha_inicio AND c.fecha_fin
  ) AS slots_prioritarios_ocupados,
  (
    SELECT (valor::integer)
    FROM public.configuracion_negocio
    WHERE clave = 'slots_por_vuelta'
  ) AS slots_totales
FROM generate_series(
  now()::date,
  (now() + interval '30 days')::date,
  interval '1 hour'
) generate_series;

GRANT SELECT ON public.vista_ocupacion_slots TO authenticated;

-- ============================================================
-- FUNCIÓN: obtener_disponibilidad_slots
-- Verifica cuántos slots prioritarios están ocupados
-- en un rango de fechas. Usada antes de comprar un plan.
-- ============================================================
CREATE OR REPLACE FUNCTION public.obtener_disponibilidad_slots(
  p_fecha_inicio TIMESTAMPTZ,
  p_fecha_fin    TIMESTAMPTZ
)
RETURNS TABLE (
  hora_local          TEXT,
  slots_ocupados      INTEGER,
  slots_disponibles   INTEGER,
  hay_cupo            BOOLEAN
) AS $$
DECLARE
  v_slots_totales INTEGER;
BEGIN
  SELECT valor::integer INTO v_slots_totales
  FROM public.configuracion_negocio
  WHERE clave = 'slots_por_vuelta';

  RETURN QUERY
  SELECT
    to_char(h.hora, 'YYYY-MM-DD HH24:00') AS hora_local,
    COUNT(c.id)::INTEGER AS slots_ocupados,
    (v_slots_totales - COUNT(c.id))::INTEGER AS slots_disponibles,
    COUNT(c.id) < v_slots_totales AS hay_cupo
  FROM generate_series(
    date_trunc('hour', p_fecha_inicio),
    date_trunc('hour', p_fecha_fin),
    interval '1 hour'
  ) h(hora)
  LEFT JOIN public.contrataciones c ON (
    c.estado = 'activo'
    AND h.hora BETWEEN date_trunc('hour', c.fecha_inicio) AND date_trunc('hour', c.fecha_fin) - interval '1 second'
    AND EXISTS (
      SELECT 1 FROM public.planes p
      WHERE p.id = c.plan_id AND p.prioridad_garantizada = true
    )
  )
  GROUP BY h.hora
  ORDER BY h.hora;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.obtener_disponibilidad_slots(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, anon;

-- ============================================================
-- FUNCIÓN: aprobar_recarga
-- Aprueba una recarga y activa la contratación automáticamente
-- Solo puede ser ejecutada por admin (verificación interna)
-- ============================================================
CREATE OR REPLACE FUNCTION public.aprobar_recarga(
  p_recarga_id     UUID,
  p_admin_id       UUID,
  p_fecha_inicio   TIMESTAMPTZ DEFAULT now(),
  p_fecha_fin      TIMESTAMPTZ DEFAULT NULL -- Si NULL, se calcula según el plan
)
RETURNS JSONB AS $$
DECLARE
  v_recarga        RECORD;
  v_plan           RECORD;
  v_fecha_fin      TIMESTAMPTZ;
  v_contratacion   UUID;
BEGIN
  -- Verificar que quien ejecuta es admin
  IF NOT public.es_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acceso denegado: solo admin puede aprobar recargas');
  END IF;

  -- Obtener datos de la recarga
  SELECT r.*, u.email AS cliente_email
  INTO v_recarga
  FROM public.recargas r
  JOIN public.usuarios u ON u.id = r.cliente_id
  WHERE r.id = p_recarga_id AND r.estado = 'pendiente';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recarga no encontrada o ya procesada');
  END IF;

  -- Obtener datos del plan
  SELECT * INTO v_plan FROM public.planes WHERE id = v_recarga.plan_id;

  -- Calcular fecha_fin si no se proporcionó
  IF p_fecha_fin IS NULL THEN
    IF v_plan.duracion_horas IS NOT NULL THEN
      v_fecha_fin := p_fecha_inicio + (v_plan.duracion_horas || ' hours')::INTERVAL;
    ELSE
      -- Plan básico: 30 días por defecto si no se especifica
      v_fecha_fin := p_fecha_inicio + INTERVAL '30 days';
    END IF;
  ELSE
    v_fecha_fin := p_fecha_fin;
  END IF;

  -- Actualizar estado de la recarga
  UPDATE public.recargas
  SET estado = 'aprobado', validado_por = p_admin_id, validado_en = now()
  WHERE id = p_recarga_id;

  -- Crear la contratación activa
  INSERT INTO public.contrataciones (cliente_id, plan_id, recarga_id, fecha_inicio, fecha_fin, estado)
  VALUES (v_recarga.cliente_id, v_recarga.plan_id, p_recarga_id, p_fecha_inicio, v_fecha_fin, 'activo')
  RETURNING id INTO v_contratacion;

  -- Registrar en auditoría
  INSERT INTO public.auditoria (usuario_id, tabla, accion, registro_id, datos_nuevos)
  VALUES (p_admin_id, 'recargas', 'aprobacion', p_recarga_id,
    jsonb_build_object(
      'recarga_id', p_recarga_id,
      'cliente_id', v_recarga.cliente_id,
      'plan_id', v_recarga.plan_id,
      'contratacion_id', v_contratacion,
      'fecha_inicio', p_fecha_inicio,
      'fecha_fin', v_fecha_fin
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'contratacion_id', v_contratacion,
    'fecha_inicio', p_fecha_inicio,
    'fecha_fin', v_fecha_fin,
    'plan', v_plan.nombre
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.aprobar_recarga(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- ============================================================
-- FUNCIÓN: rechazar_recarga
-- Rechaza una recarga con motivo
-- ============================================================
CREATE OR REPLACE FUNCTION public.rechazar_recarga(
  p_recarga_id     UUID,
  p_admin_id       UUID,
  p_motivo         TEXT
)
RETURNS JSONB AS $$
BEGIN
  IF NOT public.es_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acceso denegado');
  END IF;

  IF p_motivo IS NULL OR trim(p_motivo) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El motivo de rechazo es requerido');
  END IF;

  UPDATE public.recargas
  SET estado = 'rechazado',
      motivo_rechazo = p_motivo,
      validado_por = p_admin_id,
      validado_en = now()
  WHERE id = p_recarga_id AND estado = 'pendiente';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Recarga no encontrada o ya procesada');
  END IF;

  -- Registrar en auditoría
  INSERT INTO public.auditoria (usuario_id, tabla, accion, registro_id, datos_nuevos)
  VALUES (p_admin_id, 'recargas', 'rechazo', p_recarga_id,
    jsonb_build_object('motivo', p_motivo)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.rechazar_recarga(UUID, UUID, TEXT) TO authenticated;

-- ============================================================
-- FUNCIÓN: resumen_admin_dashboard
-- Métricas para el dashboard de admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.resumen_admin_dashboard()
RETURNS JSONB AS $$
DECLARE
  v_slots_totales INTEGER;
BEGIN
  IF NOT public.es_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Acceso denegado');
  END IF;

  SELECT valor::integer INTO v_slots_totales
  FROM public.configuracion_negocio WHERE clave = 'slots_por_vuelta';

  RETURN jsonb_build_object(
    'ok', true,
    'clientes_activos',       (SELECT COUNT(*) FROM public.usuarios WHERE rol = 'cliente' AND estado = 'activo'),
    'recargas_pendientes',    (SELECT COUNT(*) FROM public.recargas WHERE estado = 'pendiente'),
    'contrataciones_activas', (SELECT COUNT(*) FROM public.contrataciones WHERE estado = 'activo' AND now() BETWEEN fecha_inicio AND fecha_fin),
    'slots_ocupados_ahora',   (
      SELECT COUNT(*) FROM public.contrataciones c
      JOIN public.planes p ON p.id = c.plan_id
      WHERE c.estado = 'activo' AND p.prioridad_garantizada = true
        AND now() BETWEEN c.fecha_inicio AND c.fecha_fin
    ),
    'slots_totales',          v_slots_totales,
    'ingresos_mes_actual',    (
      SELECT COALESCE(SUM(r.monto_declarado), 0)
      FROM public.recargas r
      WHERE r.estado = 'aprobado'
        AND r.validado_en >= date_trunc('month', now())
    ),
    'anuncios_en_aire',       (SELECT COUNT(*) FROM public.vista_carrusel_actual)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

GRANT EXECUTE ON FUNCTION public.resumen_admin_dashboard() TO authenticated;

-- ============================================================
-- FUNCIÓN: incrementar_publicaciones_basico
-- Incrementa el contador de publicaciones del plan básico
-- Llamada por el reproductor TV cuando muestra el anuncio básico
-- ============================================================
CREATE OR REPLACE FUNCTION public.registrar_aparicion_basico(
  p_contratacion_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_max INTEGER;
  v_usadas INTEGER;
BEGIN
  SELECT
    p.max_publicaciones_puntuales,
    c.publicaciones_basico_usadas
  INTO v_max, v_usadas
  FROM public.contrataciones c
  JOIN public.planes p ON p.id = c.plan_id
  WHERE c.id = p_contratacion_id AND p.tipo = 'basico';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Contratación básica no encontrada');
  END IF;

  IF v_usadas >= v_max THEN
    -- Ya agotó sus publicaciones, expirar la contratación
    UPDATE public.contrataciones
    SET estado = 'vencido', updated_at = now()
    WHERE id = p_contratacion_id;
    RETURN jsonb_build_object('ok', true, 'estado', 'vencido', 'usadas', v_usadas, 'max', v_max);
  END IF;

  UPDATE public.contrataciones
  SET publicaciones_basico_usadas = publicaciones_basico_usadas + 1,
      updated_at = now()
  WHERE id = p_contratacion_id;

  RETURN jsonb_build_object('ok', true, 'estado', 'activo', 'usadas', v_usadas + 1, 'max', v_max);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.registrar_aparicion_basico(UUID) TO anon, authenticated;

-- ============================================================
-- STORAGE BUCKETS (ejecutar en Supabase Dashboard > Storage)
-- ============================================================
-- Nota: Los buckets se crean desde el Dashboard o con la API de Management
-- No pueden crearse con SQL estándar en Supabase
--
-- Crear manualmente en Supabase Dashboard > Storage:
--
-- 1. Bucket: 'vouchers'
--    - Private: SI
--    - Max file size: 5MB
--    - Allowed MIME types: image/jpeg, image/png, image/webp
--    Política de acceso:
--    - INSERT: auth.uid() = (storage.foldername(name))[1]::uuid
--    - SELECT: auth.uid() = (storage.foldername(name))[1]::uuid OR es_admin()
--
-- 2. Bucket: 'anuncios'
--    - Private: NO (los archivos se sirven al reproductor TV)
--    - Max file size: 15MB
--    - Allowed MIME types: image/jpeg, image/png, image/webp, video/mp4
--    Política de acceso:
--    - INSERT: auth.uid() = (storage.foldername(name))[1]::uuid
--    - SELECT: true (público, para el reproductor TV)
--    - DELETE: auth.uid() = (storage.foldername(name))[1]::uuid OR es_admin()
-- ============================================================

-- ============================================================
-- FIN DE FUNCTIONS.SQL
-- ============================================================
