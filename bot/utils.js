/**
 * Convert milliseconds → "M:SS" or "H:MM:SS"
 * @param {number} ms
 * @returns {string}
 */
function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * ASCII seek-bar  ▬▬▬▬🔘▬▬▬▬
 * @param {number} current  ms
 * @param {number} total    ms
 * @param {number} [len=20]
 * @returns {string}
 */
function progressBar(current, total, len = 20) {
  const filled = Math.min(Math.round((current / total) * len), len - 1);
  return `${'▬'.repeat(filled)}🔘${'▬'.repeat(len - filled - 1)}`;
}

/**
 * Volume bar  ██████░░░░░░
 * @param {number} vol  1-150
 * @param {number} [len=15]
 * @returns {string}
 */
function volumeBar(vol, len = 15) {
  const filled = Math.round((vol / 150) * len);
  return `${'█'.repeat(filled)}${'░'.repeat(len - filled)}`;
}

module.exports = { msToTime, progressBar, volumeBar };
