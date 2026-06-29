# ZV Publicidad Digital — Sistema de Anuncios en TV

Sistema de carrusel publicitario digital para Smart TVs. Los clientes contratan planes, suben sus anuncios (foto o video) y aparecen en pantalla de forma automática y sincronizada.

## Tecnologías

- **Frontend:** HTML5 + CSS3 modular + JavaScript ES6 Modules (sin frameworks)
- **Backend:** [Supabase](https://supabase.com) — PostgreSQL, Auth, Storage, RLS, Realtime
- **Hosting:** GitHub Pages (estático)
- **Procesamiento de video:** ffmpeg.wasm (browser-side, single-thread, sin servidor ni headers especiales)

## Estructura del proyecto

```
/
├── index.html                    # Landing pública (planes, cómo funciona, contacto)
├── tv.html                       # Reproductor de carrusel para Smart TV
├── favicon.ico
├── site.webmanifest
│
├── pages/
│   ├── login.html
│   ├── registro.html
│   ├── cliente/
│   │   ├── dashboard.html        # Panel del anunciante
│   │   ├── mis-anuncios.html     # Subir y activar anuncios
│   │   ├── recargar.html         # Contratar un plan
│   │   └── historial.html        # Historial de pagos y contratos
│   └── admin/
│       ├── dashboard.html        # KPIs, slots en uso, alertas
│       ├── validaciones.html     # Aprobar/rechazar vouchers
│       ├── clientes.html         # Gestionar cuentas de clientes
│       ├── planes.html           # CRUD de planes + config del negocio
│       ├── pantallas.html        # Registrar y monitorear TVs
│       └── reportes.html         # Ingresos, ocupación, export CSV
│
├── assets/
│   ├── css/
│   │   ├── variables.css         # Design tokens y dark mode
│   │   ├── styles.css            # Layout global, sidebar, landing
│   │   ├── components.css        # Buttons, cards, modals, forms, badges
│   │   └── responsive.css        # Mobile-first breakpoints
│   ├── js/
│   │   ├── config.js             # Credenciales Supabase y constantes
│   │   ├── supabase-client.js    # Singleton del cliente Supabase
│   │   ├── supabase-data.js      # Data layer (todas las queries)
│   │   ├── auth.js               # Auth helpers y guards
│   │   ├── utils.js              # Toast, formateo, paginación, etc.
│   │   ├── main.js               # Init panel, sidebar, logout
│   │   ├── tv-player.js          # Reproductor determinístico del carrusel
│   │   ├── cliente-anuncios.js   # Subida + trim de video (ffmpeg.wasm)
│   │   ├── cliente-recargas.js   # Flujo de contratación y pago
│   │   ├── admin-validaciones.js # Aprobación/rechazo de vouchers (Realtime)
│   │   ├── admin-planes.js       # CRUD planes y configuración negocio
│   │   └── ffmpeg/               # FFmpeg.wasm UMD local (evita cross-origin Worker)
│   │       ├── ffmpeg.js         # Bundle principal UMD (@ffmpeg/ffmpeg@0.12.10)
│   │       └── 814.ffmpeg.js     # Chunk del Worker (webpack, cargado automáticamente)
│   ├── images/
│   │   └── logo.png              # Logo de la empresa
│   └── sql/
│       ├── schema.sql            # Tablas, triggers, índices
│       ├── rls-policies.sql      # RLS + función es_admin()
│       └── functions.sql         # Views, RPCs, funciones auxiliares
```

## Inicio rápido

Ver [SETUP.md](SETUP.md) para instrucciones completas de configuración.

1. Crear proyecto en Supabase
2. Ejecutar los 3 archivos SQL en orden: `schema.sql` → `rls-policies.sql` → `functions.sql`
3. Configurar buckets de Storage
4. Editar `assets/js/config.js` con tus credenciales
5. Desplegar en GitHub Pages

## Roles de usuario

| Rol | Acceso |
|-----|--------|
| `anon` | Solo lectura del carrusel (tv.html) |
| `cliente` | Panel cliente: subir anuncios, contratar planes, ver historial |
| `admin` | Panel admin completo: validar pagos, gestionar todo |

## Modelo de negocio

1. El cliente elige un plan y realiza un depósito/transferencia bancaria
2. Sube la foto del voucher con el número de operación
3. El admin verifica y aprueba manualmente
4. El anuncio entra automáticamente al carrusel

## Planes disponibles (configurables desde el panel admin)

| Plan | Tipo | Descripción |
|------|------|-------------|
| Plan Puntual | `puntual` | Publicación por horas, slot garantizado |
| Plan Semanal | `semanal` | 7 días continuos, slot garantizado |
| Plan Quincenal | `quincenal` | 15 días, slot garantizado |
| Plan Mensual | `mensual` | 30 días, múltiples anuncios activos |
| Plan Básico | `basico` | Por publicaciones puntuales, sin slot fijo |
