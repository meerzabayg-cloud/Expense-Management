// Lightweight SVG charts (no external library, works offline).
import { h } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return el;
}

export const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#ea580c', '#65a30d', '#dc2626', '#0d9488', '#8b5cf6', '#64748b'];

/**
 * Vertical bar chart with up to two series. Tapping a bar shows its values.
 * data: [{label, values:[n, n], title}], series: [{name, cls}]
 */
export function barChart(data, { series = [{ name: 'Value', cls: 'bar-a' }], format = String, height = 170, highlightLast = true } = {}) {
  const W = 320; const H = height; const padB = 22; const padT = 10;
  const max = Math.max(1, ...data.flatMap((d) => d.values.map((v) => Math.max(0, v || 0))));
  const n = data.length || 1;
  const groupW = W / n;
  const barW = Math.min(26, (groupW * 0.7) / series.length);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': data.map((d) => `${d.label}: ${d.values.map(format).join(', ')}`).join('; ') });
  for (let g = 0; g <= 3; g++) {
    const y = padT + ((H - padB - padT) * g) / 3;
    svg.appendChild(s('line', { x1: 0, x2: W, y1: y, y2: y, class: 'grid' }));
  }
  const caption = h('div', { class: 'chart-caption muted' }, 'Tap a bar to see its value');
  data.forEach((d, i) => {
    const gx = i * groupW + (groupW - barW * series.length) / 2;
    d.values.forEach((v, k) => {
      const val = Math.max(0, v || 0);
      const bh = ((H - padB - padT) * val) / max;
      const rect = s('rect', {
        x: gx + k * barW, y: H - padB - bh, width: barW - 2, height: Math.max(bh, val > 0 ? 1.5 : 0), rx: 3,
        class: `${series[k].cls}${highlightLast && i === n - 1 ? ' current' : ''}`, tabindex: 0,
      });
      rect.appendChild(s('title', {}, `${d.label} · ${series[k].name}: ${format(v)}`));
      const show = () => { caption.textContent = `${d.title || d.label}: ${series.map((se, j) => `${se.name} ${format(d.values[j])}`).join(' · ')}`; };
      rect.addEventListener('click', show);
      rect.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') show(); });
      svg.appendChild(rect);
    });
    svg.appendChild(s('text', { x: i * groupW + groupW / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis' }, d.label));
  });
  const legend = series.length > 1 ? h('div', { class: 'legend' }, series.map((se) => h('span', {}, h('i', { class: `swatch ${se.cls}` }), se.name))) : null;
  return h('div', { class: 'chart-wrap' }, svg, legend, caption);
}

/** Donut chart for category distribution. items: [{label, value, color}] */
export function donut(items, { format = String, centerLabel = '', centerValue = '' } = {}) {
  const total = items.reduce((a, b) => a + Math.max(0, b.value), 0);
  const R = 52; const r = 34; const C = 64;
  const svg = s('svg', { viewBox: '0 0 128 128', class: 'donut', role: 'img', 'aria-label': items.map((i) => `${i.label} ${format(i.value)}`).join(', ') });
  let a0 = -Math.PI / 2;
  if (total <= 0) {
    svg.appendChild(s('circle', { cx: C, cy: C, r: (R + r) / 2, fill: 'none', 'stroke-width': R - r, class: 'donut-empty' }));
  }
  for (const it of items) {
    if (it.value <= 0) continue;
    const frac = it.value / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => [C + rad * Math.cos(ang), C + rad * Math.sin(ang)];
    let d;
    if (frac >= 0.9999) {
      d = `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r} A ${r} ${r} 0 1 0 ${C} ${C - r} Z`;
    } else {
      const [x0, y0] = p(a0, R); const [x1, y1] = p(a1, R); const [x2, y2] = p(a1, r); const [x3, y3] = p(a0, r);
      d = `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r} ${r} 0 ${large} 0 ${x3} ${y3} Z`;
    }
    const path = s('path', { d, fill: it.color });
    path.appendChild(s('title', {}, `${it.label}: ${format(it.value)} (${Math.round(frac * 100)}%)`));
    svg.appendChild(path);
    a0 = a1;
  }
  svg.appendChild(s('text', { x: C, y: C - 2, 'text-anchor': 'middle', class: 'donut-label' }, centerLabel));
  svg.appendChild(s('text', { x: C, y: C + 13, 'text-anchor': 'middle', class: 'donut-value' }, centerValue));
  const legend = h('ul', { class: 'donut-legend' }, items.filter((i) => i.value > 0).map((it) =>
    h('li', {}, h('i', { class: 'swatch', style: { background: it.color } }), h('span', { class: 'grow' }, it.label), h('b', {}, format(it.value)), h('span', { class: 'muted small' }, ` ${Math.round((it.value / total) * 100)}%`))));
  return h('div', { class: 'donut-wrap' }, svg, legend);
}

/** Simple progress bar with tone. */
export function progress(pct, { tone } = {}) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const t = tone || (pct > 100 ? 'bad' : pct > 85 ? 'warn' : 'good');
  return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': Math.round(pct || 0), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('div', { class: `progress-fill ${t}`, style: { width: `${p}%` } }));
}

/** Price history line chart for one product. points: [{label, value}] */
export function lineChart(points, { format = String, height = 140 } = {}) {
  const W = 320; const H = height; const pad = 16;
  if (points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const min = Math.min(...vals); const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i) => pad + ((W - pad * 2) * i) / (points.length - 1);
  const y = (v) => H - pad - ((H - pad * 2) * (v - min)) / span;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': points.map((p) => `${p.label} ${format(p.value)}`).join(', ') });
  svg.appendChild(s('path', { d: points.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.value)}`).join(' '), class: 'line' }));
  const caption = h('div', { class: 'chart-caption muted' }, 'Tap a point to see the price');
  points.forEach((p, i) => {
    const c = s('circle', { cx: x(i), cy: y(p.value), r: 5, class: 'dot', tabindex: 0 });
    c.appendChild(s('title', {}, `${p.label}: ${format(p.value)}`));
    c.addEventListener('click', () => { caption.textContent = `${p.label}: ${format(p.value)}`; });
    svg.appendChild(c);
  });
  svg.appendChild(s('text', { x: pad, y: H - 2, class: 'axis' }, points[0].label));
  svg.appendChild(s('text', { x: W - pad, y: H - 2, 'text-anchor': 'end', class: 'axis' }, points[points.length - 1].label));
  return h('div', { class: 'chart-wrap' }, svg, caption);
}
