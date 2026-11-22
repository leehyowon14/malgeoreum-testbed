import { clock } from './model.js';
export const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ],
  );
export const btn = (action, label, cls = 'btn', arg = '', disabled = false) =>
  '<button type="button" class="' +
  cls +
  '" data-action="' +
  action +
  '" data-arg="' +
  esc(arg) +
  '"' +
  (disabled ? ' disabled' : '') +
  '>' +
  esc(label) +
  '</button>';
export const field = (key, label, value, options = '') =>
  '<label class="field">' +
  esc(label) +
  '<input name="' +
  key +
  '" value="' +
  esc(value) +
  '" ' +
  options +
  '></label>';
export const timeField = (key, label, ms, disabled = false) =>
  field(
    key,
    label,
    ms == null ? '' : clock(ms, true),
    'placeholder="분:초" maxlength="8" ' + (disabled ? 'readonly' : ''),
  );
export const head = (title, back = '') =>
  '<div class="heading"><h1>' +
  esc(title) +
  '</h1>' +
  (back ? btn('back', back, 'link') : '') +
  '</div>';
export const num = (i) => String(i + 1).padStart(2, '0');
export const pair = (a, b) =>
  '<div class="between small"><span>' +
  esc(a) +
  '</span><b>' +
  esc(b) +
  '</b></div>';
export const choose = (key, label, options, selected, disabled = false) =>
  '<label class="field">' +
  esc(label) +
  '<select name="' +
  key +
  '" ' +
  (disabled ? 'disabled' : '') +
  '>' +
  options
    .map(
      ([v, t]) =>
        '<option value="' +
        esc(v) +
        '" ' +
        (v === selected ? 'selected' : '') +
        '>' +
        esc(t) +
        '</option>',
    )
    .join('') +
  '</select></label>';
export const groupKey = (l) => l.group || l.id;
