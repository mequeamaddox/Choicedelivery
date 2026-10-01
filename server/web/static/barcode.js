// Code 128 (set B) barcodes as SVG, for shipping-form labels. Phone cameras and handheld scanners
// (including the driver app's scanner) read Code 128.
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

// Bar/space widths (in modules) for `text`, quiet zones not included.
export function code128Widths(text) {
  const values = [START_B];
  for (const ch of String(text)) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error('Barcodes can only hold plain letters, numbers and symbols');
    values.push(c - 32);
  }
  const check = values.reduce((sum, v, i) => sum + v * (i || 1), 0) % 103;
  values.push(check, STOP);
  return values.flatMap((v) => [...PATTERNS[v]].map(Number));
}

// An <svg> string. height and moduleWidth are in SVG units; scales to whatever box it's put in.
export function code128Svg(text, { height = 60, moduleWidth = 2, quiet = 10 } = {}) {
  const widths = code128Widths(text);
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const bars = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) bars.push(`<rect x="${x * moduleWidth}" y="0" width="${w * moduleWidth}" height="${height}"/>`);
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total * moduleWidth} ${height}" preserveAspectRatio="none" role="img" aria-label="Barcode ${text}"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${bars.join('')}</g></svg>`;
}
