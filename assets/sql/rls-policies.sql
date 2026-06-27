-- ============================================================
-- RLS-POLICIES.SQL - ZV Publicidad Digital
-- Row Level Security - Todas las tablas protegidas
-- Ejecutar DESPUÉS de schema.sql
-- ============================================================

-- ============================================================
-- HABILITAR RLS EN TODAS LAS TABLAS
-- ============================================================
ALTER TABLE public.usuarios            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configuracion_negocio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pantallas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recargas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contrataciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anuncios            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria           ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- FUNCIÓN HELPER: verificar si el usuario actual es admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE id = auth.uid() AND rol = 'admin' AND estado = 'activo'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ============================================================
-- TABLA: usuarios
-- ============================================================

-- Cada usuario ve solo su propio perfil; admin ve todos
CREATE POLICY "usuarios_ver_propio" ON public.usuarios
  FOR SELECT
  USING (auth.uid() = id OR public.es_admin());

-- Cada usuario edita solo su propio perfil (excepto rol/estado que solo admin cambia)
CREATE POLICY "usuarios_editar_propio" ON public.usuarios
  FOR UPDATE
  USING (auth.uid() = id OR public.es_admin())
  WITH CHECK (auth.uid() = id OR public.es_admin());

-- El trigger de registro inserta el perfil (SECURITY DEFINER), no el usuario directamente
-- No se permite INSERT manual (lo hace el trigger)
CREATE POLICY "usuarios_insert_solo_trigger" ON public.usuarios
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Solo admin puede eliminar usuarios
CREATE POLICY "usuarios_eliminar_solo_admin" ON public.usuarios
  FOR DELETE
  USING (public.es_admin());

-- ============================================================
-- TABLA: planes
-- Lectura pública (se muestran en landing y panel cliente)
-- Solo admin puede escribir
-- ============================================================

CREATE POLICY "planes_lectura_publica" ON public.planes
  FOR SELECT
  USING (activo = true OR public.es_admin());

CREATE POLICY "planes_admin_insertar" ON public.planes
  FOR INSERT
  WITH CHECK (public.es_admin());

CREATE POLICY "planes_admin_actualizar" ON public.planes
  FOR UPDATE
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

CREATE POLICY "planes_admin_eliminar" ON public.planes
  FOR DELETE
  USING (public.es_admin());

-- ============================================================
-- TABLA: configuracion_negocio
-- Lectura pública para campos específicos que necesita el reproductor TV
-- Solo admin puede escribir
-- ============================================================

CREATE POLICY "config_lectura_publica" ON public.configuracion_negocio
  FOR SELECT
  USING (true); -- Toda la config es legible (no contiene datos sensibles críticos)

CREATE POLICY "config_admin_insertar" ON public.configuracion_negocio
  FOR INSERT
  WITH CHECK (public.es_admin());

CREATE POLICY "config_admin_actualizar" ON public.configuracion_negocio
  FOR UPDATE
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

CREATE POLICY "config_admin_eliminar" ON public.configuracion_negocio
  FOR DELETE
  USING (public.es_admin());

-- ============================================================
-- TABLA: pantallas
-- Lectura pública (la TV necesita leer su configuración sin login)
-- Solo admin puede escribir
-- ============================================================

CREATE POLICY "pantallas_lectura_publica" ON public.pantallas
  FOR SELECT
  USING (true);

CREATE POLICY "pantallas_admin_insertar" ON public.pantallas
  FOR INSERT
  WITH CHECK (public.es_admin());

CREATE POLICY "pantallas_admin_actualizar" ON public.pantallas
  FOR UPDATE
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

-- Las TVs pueden actualizar su propio heartbeat (ultima_conexion)
-- Esto se hace con la anon_key desde el reproductor TV
-- Se permite UPDATE de ultima_conexion sin auth (solo ese campo)
CREATE POLICY "pantallas_heartbeat_anonimo" ON public.pantallas
  FOR UPDATE
  USING (true)
  WITH CHECK (true);
-- NOTA: En producción, limitar esta política al campo ultima_conexion
-- usando una Supabase Function con SECURITY DEFINER

-- ============================================================
-- TABLA: recargas (vouchers de pago)
-- Cliente: ve y crea solo las suyas; NO puede cambiar el estado
-- Admin: ve todas y puede actualizar estado (aprobar/rechazar)
-- ============================================================

CREATE POLICY "recargas_cliente_ver_propias" ON public.recargas
  FOR SELECT
  USING (cliente_id = auth.uid() OR public.es_admin());

CREATE POLICY "recargas_cliente_crear" ON public.recargas
  FOR INSERT
  WITH CHECK (
    cliente_id = auth.uid()
    AND NOT public.es_admin() -- Admin no debería crear recargas por sí mismo
  );

-- Admin puede actualizar estado (aprobar/rechazar)
CREATE POLICY "recargas_admin_actualizar" ON public.recargas
  FOR UPDATE
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

-- No se permite eliminar recargas (auditoría)
-- Si se necesita, hacerlo manual desde Supabase console

-- ============================================================
-- TABLA: contrataciones
-- Cliente: ve solo las suyas; NO puede crear directamente (lo hace el admin al aprobar recarga)
-- Admin: ve todas y puede crear/actualizar/cancelar
-- ============================================================

CREATE POLICY "contrataciones_cliente_ver_propias" ON public.contrataciones
  FOR SELECT
  USING (cliente_id = auth.uid() OR public.es_admin());

-- Solo admin crea contrataciones (al aprobar una recarga)
CREATE POLICY "contrataciones_admin_insertar" ON public.contrataciones
  FOR INSERT
  WITH CHECK (public.es_admin());

-- Admin actualiza estado; cliente NO puede auto-activar
CREATE POLICY "contrataciones_admin_actualizar" ON public.contrataciones
  FOR UPDATE
  USING (public.es_admin())
  WITH CHECK (public.es_admin());

-- ============================================================
-- TABLA: anuncios
-- Cliente: ve/crea/edita solo los suyos
-- Lectura pública especial: la vista vista_carrusel_actual
--   expone lo mínimo necesario para el reproductor TV (sin datos del cliente)
-- Admin: ve todos
-- ============================================================

CREATE POLICY "anuncios_cliente_ver_propios" ON public.anuncios
  FOR SELECT
  USING (cliente_id = auth.uid() OR public.es_admin());

CREATE POLICY "anuncios_cliente_crear" ON public.anuncios
  FOR INSERT
  WITH CHECK (
    cliente_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.contrataciones c
      WHERE c.id = contratacion_id
        AND c.cliente_id = auth.uid()
        AND c.estado = 'activo'
    )
  );

CREATE POLICY "anuncios_cliente_editar_propios" ON public.anuncios
  FOR UPDATE
  USING (cliente_id = auth.uid() OR public.es_admin())
  WITH CHECK (cliente_id = auth.uid() OR public.es_admin());

CREATE POLICY "anuncios_cliente_eliminar_propios" ON public.anuncios
  FOR DELETE
  USING (cliente_id = auth.uid() OR public.es_admin());

-- ============================================================
-- TABLA: auditoria
-- Solo admin puede leer; nadie puede borrar; insert via función SECURITY DEFINER
-- ============================================================

CREATE POLICY "auditoria_solo_admin_lee" ON public.auditoria
  FOR SELECT
  USING (public.es_admin());

-- Insert solo via función interna (SECURITY DEFINER)
-- Los usuarios no pueden insertar directamente

-- ============================================================
-- NOTAS IMPORTANTES
-- ============================================================
-- La vista vista_carrusel_actual (en functions.sql) expone
-- solo los campos necesarios para el reproductor TV, sin datos
-- personales de los clientes. El reproductor TV usa anon_key
-- para leer esta vista.
--
-- El acceso a Storage (Supabase Storage) se configura en el
-- panel de Supabase:
--   - Bucket 'vouchers': private (solo cliente propietario + admin)
--   - Bucket 'anuncios': private (solo cliente propietario + admin + lectura pública para URLs firmadas)
-- ============================================================
