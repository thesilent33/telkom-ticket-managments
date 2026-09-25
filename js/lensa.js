/**
 * lensa.js — Ukur redaman via n8n webhook
 */

import CONFIG from './config.js';

/**
 * ukurRedaman(inet) → hasil ukur dari LENSA
 *
 * @param {string} inet - Nomor iNetID pelanggan (172xxxxxxxxx)
 * @returns {Promise<{success, onu_sn, onu_status, onu_rx, olt_rx, onu_rx_status, olt_rx_status, result_text, error?}>}
 */
async function ukurRedaman(inet) {
  if (!inet) throw new Error('inet diperlukan');

  const response = await fetch(CONFIG.N8N_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inet }),
  });

  if (!response.ok) {
    return {
      success:    false,
      error:      `HTTP ${response.status}`,
      message:    `Gagal menghubungi server n8n (HTTP ${response.status})`,
      onu_sn:     null,
      onu_status: null,
      onu_rx:     null,
      olt_rx:     null,
    };
  }

  const rawText = await response.text();
  if (!rawText || !rawText.trim()) {
    return {
      success:    false,
      error:      'empty_response',
      message:    'n8n mengembalikan respon kosong. Periksa workflow di n8n.',
      onu_sn:     null,
      onu_status: null,
      onu_rx:     null,
      olt_rx:     null,
    };
  }

  try {
    const data = JSON.parse(rawText);
    return data;
  } catch (e) {
    return {
      success:    false,
      error:      'invalid_json',
      message:    `Respon dari n8n bukan JSON yang valid: ${rawText.slice(0, 80)}`,
      onu_sn:     null,
      onu_status: null,
      onu_rx:     null,
      olt_rx:     null,
    };
  }
}

/**
 * Bangun ringkasan redaman untuk ditampilkan di kartu
 * Contoh output: "St: ONLINE ✅ | ONU: -20.5 dBm ✅ | OLT: -19.8 dBm ✅"
 */
function formatRedamanSummary(ticket) {
  if (!ticket.onu_status && !ticket.onu_rx && !ticket.olt_rx) return null;

  const statusEmoji = (s) => {
    const t = (s ?? '').toUpperCase();
    if (t.includes('ONLINE')) return '✅';
    if (t.includes('LOS'))    return '❌';
    return '⚠️';
  };

  const rxEmoji = (status) => {
    if (status === 'ok')    return '✅';
    if (status === 'warn')  return '⚠️';
    return '❌';
  };

  const parts = [];
  if (ticket.onu_status) parts.push(`St: <b>${ticket.onu_status}</b> ${statusEmoji(ticket.onu_status)}`);
  if (ticket.onu_rx)     parts.push(`ONU: <b>${ticket.onu_rx} dBm</b> ${rxEmoji(ticket.onu_rx_status)}`);
  if (ticket.olt_rx)     parts.push(`OLT: <b>${ticket.olt_rx} dBm</b> ${rxEmoji(ticket.olt_rx_status)}`);

  return parts.join(' | ');
}

export { ukurRedaman, formatRedamanSummary };
