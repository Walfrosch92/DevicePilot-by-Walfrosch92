// Ulanzi Stream Deck Plugin SDK - Utilities
// Protocol Version: V1.2.2

const Utils = (() => {
  const getQueryParams = key => {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  };

  const getPluginPath = () => {
    const path = window.location.pathname;
    return path.substring(0, path.lastIndexOf('/'));
  };

  const getLanguage = () => (navigator.language || navigator.userLanguage || 'en').split('-')[0];

  const adaptLanguage = lang => {
    const map = { zh: 'zh_CN', ja: 'ja_JP', de: 'de_DE', ko: 'ko_KR' };
    return map[lang] || lang;
  };

  const readJson = url =>
    fetch(url).then(r => { if (!r.ok) throw new Error(r.statusText); return r.json(); });

  const getFormValue = form => {
    const data = {};
    const fd = new FormData(form);
    for (const [k, v] of fd.entries()) data[k] = v;
    return data;
  };

  const setFormValue = (values, form) => {
    if (!values || !form) return;
    Object.entries(values).forEach(([k, v]) => {
      const el = form.elements[k];
      if (!el) return;
      if (el.type === 'checkbox') el.checked = v === true || v === 'true';
      else el.value = v;
    });
  };

  const log   = (...a) => console.log(...a);
  const warn  = (...a) => console.warn(...a);
  const error = (...a) => console.error(...a);

  return { getQueryParams, getPluginPath, getLanguage, adaptLanguage, readJson, getFormValue, setFormValue, log, warn, error };
})();
