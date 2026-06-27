/**
 * supabase-client.js - ZV Publicidad Digital
 * Inicialización del cliente Supabase (singleton)
 * Capa CLIENT_LAYER del patrón Three-Layer
 */

import { CONFIG } from './config.js';

// Importar Supabase desde CDN (ESM)
// Compatible con GitHub Pages sin bundler
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

/**
 * Instancia singleton de Supabase.
 * Importar { supabase } desde este módulo en todo el sistema.
 */
let _supabaseInstance = null;

function getSupabaseClient() {
  if (_supabaseInstance) return _supabaseInstance;

  if (!CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('TU_PROYECTO')) {
    console.error(
      '[ZV] ⚠️  Configura SUPABASE_URL y SUPABASE_ANON_KEY en assets/js/config.js'
    );
  }

  _supabaseInstance = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: CONFIG.SESSION.STORAGE_KEY,
    }
  });

  return _supabaseInstance;
}

export const supabase = getSupabaseClient();
export default supabase;
