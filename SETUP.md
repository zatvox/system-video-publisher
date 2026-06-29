# Guía de Instalación — ZV Publicidad Digital

## Requisitos previos

- Cuenta gratuita en [supabase.com](https://supabase.com)
- Cuenta en [GitHub](https://github.com) para el hosting
- Navegador moderno (Chrome recomendado para el panel)
- Smart TV con navegador web integrado (para el carrusel)

---

## Paso 1 — Crear el proyecto en Supabase

1. Inicia sesión en [app.supabase.com](https://app.supabase.com)
2. Clic en **New Project**
3. Elige nombre, contraseña de DB y región más cercana
4. Espera ~2 minutos hasta que el proyecto esté listo

---

## Paso 2 — Ejecutar el SQL

Ir a **SQL Editor** en el panel de Supabase y ejecutar los archivos en este orden:

### 2.1 Schema (tablas y triggers)
```
assets/sql/schema.sql
```
Crea: `usuarios`, `planes`, `configuracion_negocio`, `pantallas`, `recargas`, `contrataciones`, `anuncios`, `auditoria`

### 2.2 Políticas RLS
```
assets/sql/rls-policies.sql
```
Activa RLS en todas las tablas y crea la función helper `es_admin()`.

### 2.3 Funciones y views
```
assets/sql/functions.sql
```
Crea: `vista_carrusel_actual`, `obtener_disponibilidad_slots()`, `aprobar_recarga()`, `rechazar_recarga()`, `resumen_admin_dashboard()`, `registrar_aparicion_basico()`.

---

## Paso 3 — Configurar Storage

En Supabase → **Storage** → **New Bucket**:

### Bucket `anuncios` (público)
- Name: `anuncios`
- Public bucket: ✅ ON
- Allowed MIME types: `image/jpeg, image/png, image/webp, video/mp4`
- Max file size: 15 MB

### Bucket `vouchers` (privado)
- Name: `vouchers`
- Public bucket: ❌ OFF
- Allowed MIME types: `image/jpeg, image/png, image/webp`
- Max file size: 5 MB

### Políticas de Storage para `anuncios`

```sql
-- Lectura pública
CREATE POLICY "Anuncios públicos lectura" ON storage.objects
FOR SELECT TO public USING (bucket_id = 'anuncios');

-- Solo usuarios autenticados pueden subir
CREATE POLICY "Clientes suben anuncios" ON storage.objects
FOR INSERT TO authenticated USING (bucket_id = 'anuncios');

-- Solo el dueño o admin puede eliminar
CREATE POLICY "Eliminar propio anuncio" ON storage.objects
FOR DELETE TO authenticated USING (
  bucket_id = 'anuncios' AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR public.es_admin()
  )
);
```

### Políticas de Storage para `vouchers`

```sql
-- Solo el dueño puede insertar
CREATE POLICY "Cliente sube voucher" ON storage.objects
FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'vouchers' AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Solo admin puede leer (para ver el comprobante)
CREATE POLICY "Admin lee vouchers" ON storage.objects
FOR SELECT TO authenticated USING (
  bucket_id = 'vouchers' AND public.es_admin()
);
```

---

## Paso 4 — Crear el usuario administrador

### Opción A — Desde Supabase (recomendado)

1. Ir a **Authentication → Users → Add user**
2. Email: tu email de admin
3. Password: contraseña segura
4. Confirmar

Luego en **SQL Editor**:
```sql
UPDATE public.usuarios
SET rol = 'admin', estado = 'activo'
WHERE email = 'tu-email@ejemplo.com';
```

### Opción B — Registrarse normalmente y luego elevar

1. Ir a `TU_SITIO/pages/registro.html` y registrarse
2. Ejecutar el UPDATE de arriba en SQL Editor

---

## Paso 5 — Configurar las credenciales del proyecto

Abrir `assets/js/config.js` y reemplazar:

```javascript
export const CONFIG = {
  SUPABASE_URL: 'https://TU_PROYECTO.supabase.co',   // ← Cambiar
  SUPABASE_ANON_KEY: 'eyJhbGci...',                   // ← Cambiar
  // ...resto sin cambios
};
```

Las credenciales están en Supabase → **Settings → API**:
- **Project URL** → `SUPABASE_URL`
- **anon public** key → `SUPABASE_ANON_KEY`

---

## Paso 6 — Desplegar en GitHub Pages

1. Subir todos los archivos a un repositorio de GitHub
2. Ir a **Settings → Pages**
3. Source: `Deploy from a branch` → branch `main` → folder `/ (root)`
4. Guardar y esperar ~1 minuto
5. La URL será: `https://TU_USUARIO.github.io/TU_REPO/`

> **Importante:** GitHub Pages solo sirve archivos estáticos. Todas las operaciones de base de datos van directo a Supabase desde el navegador del cliente.

---

## Paso 7 — Configurar los datos bancarios

1. Ingresar como admin a `TU_SITIO/pages/admin/planes.html`
2. Bajar hasta **Configuración del negocio**
3. Completar:
   - Nombre del banco
   - Número de cuenta / CCI
   - Titular de la cuenta
   - Teléfono WhatsApp
   - Horario de emisión (inicio y fin en formato HH:MM)

---

## Paso 8 — Configurar el Smart TV

1. Abrir el navegador del Smart TV
2. Navegar a: `https://TU_SITIO/tv.html`
3. Opcionalmente con nombre trackeable: `https://TU_SITIO/tv.html?pantalla=Sala-Principal`

> El carrusel funciona sin login. Todos los TVs se sincronizan automáticamente (algoritmo basado en el minuto del reloj del sistema).

---

## Verificación final

| Ítem | Cómo verificar |
|------|---------------|
| DB conectada | `index.html` carga los planes desde Supabase |
| Auth funciona | Registrar cliente de prueba |
| Storage OK | Subir imagen de prueba desde panel cliente |
| TV sincronizado | Abrir `tv.html` en dos ventanas distintas y verificar que muestran el mismo anuncio |
| Admin accede | Login con usuario admin → redirige a `pages/admin/dashboard.html` |

---

## Solución de problemas frecuentes

**"No aparecen los planes en la landing"**
→ Verificar `SUPABASE_URL` y `SUPABASE_ANON_KEY` en `config.js`
→ Verificar que `planes` tiene filas con `es_activo = true` y que la RLS permite lectura anónima

**"No puedo subir archivos"**
→ Verificar que los buckets están creados con los nombres exactos: `anuncios` y `vouchers`
→ Revisar las políticas de Storage

**"El video no se reproduce en el TV"**
→ El TV debe soportar H.264 (MP4). Probar con un video de menor resolución.
→ Verificar que el navegador del TV no bloquea contenido mixto (HTTP/HTTPS)

**"Error SecurityError: Failed to construct 'Worker'" al recortar video"**
→ Este error ocurre si el Worker de FFmpeg se crea desde una URL de CDN externo (cross-origin).
→ El proyecto ya está configurado correctamente: `assets/js/ffmpeg/ffmpeg.js` y `814.ffmpeg.js` están alojados localmente, así el Worker se crea desde el mismo origen. Si este error reaparece, verificar que ambos archivos estén en `assets/js/ffmpeg/` y que `mis-anuncios.html` / `video-editor.html` tengan el `<script src="../../assets/js/ffmpeg/ffmpeg.js">` antes del módulo principal.

**"El recorte de video se queda cargando sin avanzar"**
→ La primera vez carga `ffmpeg-core.js` + `ffmpeg-core.wasm` (~12MB) desde CDN (unpkg.com). Puede tardar 10-30 segundos según la conexión. Las siguientes veces el navegador lo cachea.
→ Si el problema persiste, verificar conectividad a `unpkg.com`.

**"El TV muestra contenido diferente al otro TV"**
→ Verificar que los relojes del sistema de ambos dispositivos están sincronizados (NTP)

**"Error 403 al aprobar un voucher"**
→ Verificar que el usuario admin tiene `rol = 'admin'` en la tabla `usuarios`
