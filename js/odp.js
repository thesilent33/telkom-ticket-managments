/**
 * odp.js — Integrasi pencarian koordinat ODP & ODP terdekat via n8n webhook
 */

import CONFIG from './config.js?v=4.3';

/**
 * Membersihkan format ODP yang panjang menjadi kode unik ODP/ODC
 * Contoh: "ODP-UBN-FDC/54 FDC/D04/54.01" -> "ODP-UBN-FDC/54"
 */
export function cleanOdpName(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  // Tangkap pola format ODP-XXX-XXX/XX atau ODC-XXX-XXX
  const match = trimmed.match(/\b(OD[PC]-[A-Za-z0-9\-_]+(?:\/[A-Za-z0-9\-_]+)?)\b/i);
  if (match) {
    return match[1].toUpperCase();
  }
  // Fallback: ambil token pertama sebelum spasi
  return trimmed.split(/\s+/)[0];
}

/**
 * Mengambil koordinat dan kandidat ODP terdekat dari Webhook n8n
 * @param {string} rawOdp
 * @returns {Promise<{success: boolean, target: string, target_latitude?: number, target_longitude?: number, candidates: Array, message?: string}>}
 */
export async function fetchNearestOdp(rawOdp) {
  const odpCode = cleanOdpName(rawOdp);
  if (!odpCode) {
    return {
      success: false,
      message: 'Kode ODP kosong atau tidak valid',
      target: rawOdp,
      total: 0,
      candidates: []
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const url = new URL(CONFIG.ODP_WEBHOOK_URL);
    url.searchParams.set('odp', odpCode);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server merespons status ${response.status}`);
    }

    const data = await response.json();
    return {
      ...data,
      cleanTarget: odpCode
    };
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('Error fetching ODP coordinates:', err);
    return {
      success: false,
      message: err.name === 'AbortError'
        ? 'Permintaan koordinat timeout (lebih dari 15 detik)'
        : (err.message || 'Gagal menghubungi server ODP'),
      target: odpCode,
      total: 0,
      candidates: []
    };
  }
}

/**
 * Buat link Google Maps untuk pencarian koordinat / nama
 */
export function getGoogleMapsUrl(latOrQuery, lon) {
  if (latOrQuery && lon !== undefined) {
    return `https://www.google.com/maps/search/?api=1&query=${latOrQuery},${lon}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(latOrQuery)}`;
}

/**
 * Buat link navigasi / rute arah tujuan di Google Maps
 */
export function getGoogleMapsDirUrl(lat, lon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

/**
 * Buat link navigasi di aplikasi Waze
 */
export function getWazeDirUrl(lat, lon) {
  return `https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;
}
