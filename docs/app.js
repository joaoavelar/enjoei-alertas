'use strict';
/* Alertas Enjoei — app (PWA). Dados em data/*.json; escreve via servidor local ou API do GitHub. */

// ---------- utilidades ----------
const $ = s => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const ICONS = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M19 6l-1 14H6L5 6M8 6V4h8v2"/>',
};
const ic = (n, s = 20) => {
  const w = document.createElement('span');
  w.style.display = 'inline-flex';
  w.innerHTML = `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
  return w;
};
const brl = v => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', {minimumFractionDigits: 0, maximumFractionDigits: 2});
const foto = id => id ? `https://photos.enjoei.com.br/public/300x300/${id}` : '';
const itemUrl = p => 'https://www.enjoei.com.br/p/' + encodeURI(p || '');
const num = v => { v = String(v ?? '').trim().replace(',', '.'); return v === '' || isNaN(v) ? null : Number(v); };
const ago = iso => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toast(msg, {erro = false, acao = null, ms = 5000} = {}) {
  const t = h('div', {class: 'toast' + (erro ? ' erro' : '')}, h('span', {}, msg),
    acao && h('button', {onclick: () => { acao.fn(); t.remove(); }}, acao.label));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

// ---------- armazenamento (servidor local ou GitHub) ----------
const GH_KEY = 'enjoei.gh';
const ghCfg = () => { try { return JSON.parse(localStorage.getItem(GH_KEY)) || null; } catch { return null; } };

// A conexão fica em dois lugares (localStorage e IndexedDB) e o app pede armazenamento persistente,
// para o navegador não apagar. Se um dos dois sumir, ela é restaurada do outro.
const idb = (modo, fn) => new Promise((ok, err) => {
  const r = indexedDB.open('enjoei', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('cfg');
  r.onerror = () => err(r.error);
  r.onsuccess = () => { const tx = r.result.transaction('cfg', modo), q = fn(tx.objectStore('cfg')); tx.oncomplete = () => ok(q && q.result); tx.onerror = () => err(tx.error); };
});
const persistir = async () => { try { return await navigator.storage?.persist?.(); } catch { return false; } };
async function salvarCfg(c) {
  try { localStorage.setItem(GH_KEY, JSON.stringify(c)); } catch {}
  try { await idb('readwrite', s => s.put(c, 'gh')); } catch {}
  await persistir();
}
async function apagarCfg() {
  try { localStorage.removeItem(GH_KEY); } catch {}
  try { await idb('readwrite', s => s.delete('gh')); } catch {}
}
const b64url = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64url = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0)));
const linkAcesso = c => `${location.origin}${location.pathname}#conectar=${b64url(JSON.stringify({repo: c.repo, branch: c.branch || 'main', token: c.token}))}`;
async function recuperarCfg() {
  // 1) link de acesso (#conectar=...): conecta este aparelho e tira o token da barra de endereço
  const m = location.hash.match(/conectar=([A-Za-z0-9_-]+)/);
  if (m) {
    try { const c = JSON.parse(deB64url(m[1])); if (c && c.repo && c.token) { await salvarCfg(c); toast('Aparelho conectado ao GitHub.'); } }
    catch { toast('Link de acesso inválido.', {erro: true}); }
    history.replaceState(null, '', location.pathname + location.search);
  }
  // 2) se o navegador apagou o localStorage, restaura da cópia no IndexedDB
  if (!ghCfg()) {
    try { const c = await idb('readonly', s => s.get('gh')); if (c && c.token) localStorage.setItem(GH_KEY, JSON.stringify(c)); } catch {}
  }
  if (ghCfg()) await persistir();
}
const guessRepo = () => {
  const m = location.hostname.match(/^(.+)\.github\.io$/), p = location.pathname.split('/')[1];
  return m && p ? `${m[1]}/${p}` : '';
};
const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
let fila = Promise.resolve();

const Store = {
  mode: 'readonly',
  async detect() {
    try {
      const r = await fetch('api/status', {cache: 'no-store'});
      if (r.ok && 'running' in await r.json()) return (this.mode = 'local');
    } catch { /* sem servidor local */ }
    return (this.mode = ghCfg()?.token ? 'github' : 'readonly');
  },
  gh(path, opts = {}) {
    const c = ghCfg();
    return fetch(`https://api.github.com/repos/${c.repo}/contents/docs/data/${path}`, {
      ...opts, cache: 'no-store',
      headers: {Authorization: `Bearer ${c.token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {})},
    });
  },
  async read(name, def) {
    if (this.mode === 'github') {
      const c = ghCfg();
      try {
        const r = await this.gh(`${name}?ref=${encodeURIComponent(c.branch || 'main')}`, {headers: {Accept: 'application/vnd.github.raw+json'}});
        this.ghFalhou = false;
        if (r.status === 404) return def;
        if (r.status === 401) throw new Error('Token do GitHub inválido ou expirado. Atualize em Ajustes.');
        if (!r.ok) throw new Error(`GitHub: ${r.status}`);
        return JSON.parse(await r.text());
      } catch (e) {
        if (!(e instanceof TypeError)) throw e;
        this.ghFalhou = true;       // falha de rede: segue para a cópia publicada no site
      }
    }
    const r = await fetch(`data/${name}?t=${Date.now()}`, {cache: 'no-store'});
    if (r.status === 404) return def;
    if (!r.ok) throw new Error(`Falha ao ler ${name}`);
    return r.json();
  },
  write(name, data) {   // serializa as gravações para não dar conflito de versão
    const op = fila.then(() => this._write(name, data));
    fila = op.catch(() => {});
    return op;
  },
  async _write(name, data) {
    if (this.mode === 'readonly') throw new Error('Somente leitura: configure o acesso em Ajustes.');
    if (this.mode === 'local') {
      const r = await fetch(`data/${name}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)});
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || 'Falha ao salvar');
      return;
    }
    const c = ghCfg(), branch = c.branch || 'main';
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const g = await this.gh(`${name}?ref=${encodeURIComponent(branch)}`);
      const sha = g.ok ? (await g.json()).sha : undefined;
      const r = await this.gh(name, {method: 'PUT', body: JSON.stringify({
        message: `app: atualiza ${name}`, branch, sha, content: b64(JSON.stringify(data, null, 1))})});
      if (r.ok) return;
      if (r.status !== 409 && r.status !== 422) {
        throw new Error(r.status === 401 || r.status === 403 ? 'Token sem permissão (precisa de Contents: Read and write).' : `GitHub: ${r.status}`);
      }
      await sleep(600);
    }
    throw new Error('Conflito ao salvar. Tente de novo.');
  },
  async run() {
    if (this.mode === 'local') {
      const r = await fetch('api/run', {method: 'POST'});
      if (!r.ok) throw new Error('Falha ao iniciar');
    } else await this.write('run.json', {ts: new Date().toISOString()});   // o push dispara o workflow
  },
};

// ---------- estado ----------
let S = {alerts: [], watch: [], discarded: [], wstate: {}, results: {alertas: {}, erros: {}, eventos: []}};
let carregado = false, tab = 'inicio', ultimoLoad = 0, esperando = false;
const expandidos = new Set();
const vistos = new Set(JSON.parse(localStorage.getItem('enjoei.vistos') || '[]'));
const salvarVistos = () => localStorage.setItem('enjoei.vistos', JSON.stringify([...vistos].slice(-3000)));
const descartadosIds = () => new Set(S.discarded.map(d => d.id));

async function carregar(silencioso = false) {
  try {
    const [alerts, watch, discarded, wstate, results] = await Promise.all([
      Store.read('alerts.json', []), Store.read('watch.json', []), Store.read('discarded.json', []),
      Store.read('watchstate.json', {}), Store.read('results.json', {alertas: {}, erros: {}, eventos: []})]);
    S = {alerts, watch, discarded, wstate, results};
    ultimoLoad = Date.now();
    carregado = true;
  } catch (e) {
    if (!silencioso) toast('Não consegui carregar os dados: ' + e.message, {erro: true});
  }
  desenhar();
}

// ---------- ações ----------
async function gravar(nome, dados, {esperar = true} = {}) {
  try {
    await Store.write(nome, dados);
    if (esperar) aguardarResultado();
    return true;
  } catch (e) {
    toast(Store.mode === 'readonly' ? 'Não salvou: este aparelho ainda não está conectado ao GitHub.' : e.message,
      {erro: true, ms: 12000, acao: Store.mode === 'readonly' ? {label: 'Conectar', fn: () => { location.hash = 'ajustes'; }} : null});
    await carregar(true);
    return false;
  }
}

async function aguardarResultado() {
  if (esperando) return;
  esperando = true;
  const base = S.results.atualizado;
  const faixa = $('#faixa');
  faixa.hidden = false;
  faixa.textContent = Store.mode === 'github' ? 'Buscando no Enjoei… leva cerca de 1 minuto.' : 'Buscando no Enjoei…';
  $('#btn-rodar').classList.add('gira');
  const limite = Date.now() + 4 * 60 * 1000;
  try {
    while (Date.now() < limite) {
      await sleep(Store.mode === 'local' ? 2500 : 6000);
      let r;
      try { r = await Store.read('results.json', null); } catch { continue; }
      if (r && r.atualizado !== base) {
        S.results = r;
        const [wstate] = await Promise.all([Store.read('watchstate.json', {})]);
        S.wstate = wstate;
        toast('Atualizado!');
        return;
      }
    }
    toast('A verificação está demorando. Atualize em instantes.', {erro: true});
  } finally {
    esperando = false;
    faixa.hidden = true;
    $('#btn-rodar').classList.remove('gira');
    desenhar();
  }
}

async function rodarAgora() {
  try { await Store.run(); aguardarResultado(); }
  catch (e) { toast(e.message, {erro: true}); }
}

function limparAlerta(a) {
  const nome = (a.nome || a.item || '').trim();
  if (!nome) throw new Error('Informe o nome ou o item.');
  const o = {nome, item: (a.item || '').trim() || null, marca: (a.marca || '').trim() || null, cor: (a.cor || '').trim() || null,
    tamanho: (a.tamanho || '').trim() || null, preco_min: num(a.preco_min), preco_max: num(a.preco_max), ativo: a.ativo !== false};
  if (!o.item && !o.marca && !o.cor) o.item = nome;
  return o;
}

async function salvarAlerta(dados, original) {
  const novo = limparAlerta(dados);
  if (S.alerts.some(a => a.nome === novo.nome && a.nome !== original)) throw new Error('Já existe um alerta com esse nome.');
  const lista = original ? S.alerts.map(a => a.nome === original ? novo : a) : [...S.alerts, novo];
  S.alerts = lista;
  delete S.results.alertas[original || novo.nome];
  desenhar();
  if (await gravar('alerts.json', lista)) toast(original ? 'Alerta atualizado.' : 'Alerta criado — buscando anúncios…');
}

async function alternarAlerta(nome) {
  S.alerts = S.alerts.map(a => a.nome === nome ? {...a, ativo: a.ativo === false} : a);
  desenhar();
  await gravar('alerts.json', S.alerts);
}

async function excluirAlerta(nome) {
  if (!confirm(`Excluir o alerta "${nome}"?`)) return;
  S.alerts = S.alerts.filter(a => a.nome !== nome);
  delete S.results.alertas[nome];
  desenhar();
  await gravar('alerts.json', S.alerts, {esperar: false});
}

function idDoLink(txt) {
  const m = String(txt).trim().match(/(\d{5,})\s*(?:[?#].*)?$/);
  return m ? m[1] : null;
}

async function acompanhar(p) {
  if (S.watch.some(w => w.id === p.id)) return;
  S.watch = [...S.watch, {id: p.id, path: p.path || '', title: p.title || '', photo: p.photo || '', alvo: null, added: new Date().toISOString()}];
  if (p.price != null && !S.wstate[p.id]) {
    S.wstate[p.id] = {price: p.price, first_price: p.price, state: 'published', history: [], title: p.title, photo: p.photo, path: p.path, alvo_notificado: false};
  }
  desenhar();
  if (await gravar('watch.json', S.watch)) toast('Acompanhando preço e disponibilidade.');
}

async function acompanharLink(txt) {
  const id = idDoLink(txt);
  if (!id) throw new Error('Não achei o número do anúncio nesse link.');
  const m = String(txt).match(/\/p\/([^?#\s]+)/);
  const path = m ? m[1] : '';
  const title = path ? path.replace(/-?\d{5,}$/, '').replace(/-/g, ' ') : `anúncio ${id}`;
  await acompanhar({id, path, title, photo: '', price: null});
}

async function pararAcompanhar(id) {
  S.watch = S.watch.filter(w => w.id !== id);
  desenhar();
  await gravar('watch.json', S.watch, {esperar: false});
}

async function definirAlvo(id, valor) {
  S.watch = S.watch.map(w => w.id === id ? {...w, alvo: valor} : w);
  desenhar();
  if (await gravar('watch.json', S.watch) && valor != null) toast(`Aviso quando chegar a ${brl(valor)} ou menos.`);
}

async function descartar(p) {
  if (descartadosIds().has(p.id)) return;
  S.discarded = [...S.discarded, {id: p.id, title: p.title, photo: p.photo, price: p.price, path: p.path}];
  desenhar();
  if (await gravar('discarded.json', S.discarded, {esperar: false})) {
    toast('Anúncio descartado.', {acao: {label: 'Desfazer', fn: () => restaurar(p.id)}});
  }
}

async function restaurar(id) {
  S.discarded = S.discarded.filter(d => d.id !== id);
  desenhar();
  await gravar('discarded.json', S.discarded, {esperar: false});
}

function marcarVistos(nome) {
  const nomes = nome ? [nome] : S.alerts.map(a => a.nome);
  for (const n of nomes) for (const id of S.results.alertas[n]?.new_ids || []) vistos.add(id);
  salvarVistos();
  desenhar();
}

// ---------- folha (formulário em diálogo) ----------
function folha(titulo, campos, {ok = 'Salvar', valores = {}, onOk}) {
  const f = $('#folha-form'), d = $('#folha');
  f.replaceChildren();
  const erro = h('div', {class: 'sub', style: 'color:var(--verm);min-height:1.2em;margin-top:8px'});
  const inputs = {};
  const grade = h('div', {class: 'campos'});
  for (const c of campos) {
    const i = h('input', {name: c.nome, placeholder: c.dica || '', inputmode: c.num ? 'decimal' : null, autocomplete: 'off', value: valores[c.nome] ?? ''});
    inputs[c.nome] = i;
    grade.append(h('label', {class: c.cheio ? 'cheio' : ''}, c.rotulo, i));
  }
  f.append(h('h2', {}, titulo), grade, erro, h('div', {class: 'folha-bt'},
    h('button', {type: 'button', class: 'btn fantasma', onclick: () => d.close()}, 'Cancelar'),
    h('button', {type: 'submit', class: 'btn pri'}, ok)));
  f.onsubmit = async ev => {
    ev.preventDefault();
    try {
      await onOk(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])));
      d.close();
    } catch (e) { erro.textContent = e.message; }
  };
  d.addEventListener('click', e => { if (e.target === d) d.close(); }, {once: true});
  d.showModal();
  Object.values(inputs)[0]?.focus();
}

const CAMPOS_ALERTA = [
  {nome: 'nome', rotulo: 'Nome do alerta', dica: 'ex.: tênis nike 39', cheio: true},
  {nome: 'item', rotulo: 'Item', dica: 'tênis'}, {nome: 'marca', rotulo: 'Marca', dica: 'opcional'},
  {nome: 'cor', rotulo: 'Cor', dica: 'opcional'}, {nome: 'tamanho', rotulo: 'Tamanho', dica: 'M ou 38, 39'},
  {nome: 'preco_min', rotulo: 'Preço mínimo (R$)', num: true}, {nome: 'preco_max', rotulo: 'Preço máximo (R$)', num: true},
];
const novoAlerta = () => folha('Novo alerta', CAMPOS_ALERTA, {ok: 'Criar alerta', onOk: v => salvarAlerta(v, null)});
const editarAlerta = a => folha('Editar alerta', CAMPOS_ALERTA, {valores: a, onOk: v => salvarAlerta({...v, ativo: a.ativo}, a.nome)});
const pedirAlvo = w => folha('Preço-alvo', [{nome: 'alvo', rotulo: 'Avisar quando o preço chegar a (R$) ou menos', num: true, cheio: true, dica: 'deixe vazio para remover'}],
  {valores: {alvo: w.alvo ?? ''}, onOk: v => definirAlvo(w.id, num(v.alvo))});

// ---------- componentes ----------
function cartaoItem(p, {novo = false, seguindo = false} = {}) {
  const meta = [p.brand, p.size && 'tam. ' + p.size].filter(Boolean).join(' · ');
  return h('div', {class: 'item' + (novo ? ' novo' : '')},
    novo && h('span', {class: 'selo'}, 'NOVO'),
    h('a', {class: 'corpo', href: itemUrl(p.path), target: '_blank', rel: 'noopener'},
      p.photo ? h('img', {class: 'foto', loading: 'lazy', alt: '', src: foto(p.photo)}) : h('div', {class: 'foto'}),
      h('div', {class: 'info'}, h('div', {class: 'titulo'}, p.title), meta && h('div', {class: 'meta'}, meta),
        h('div', {class: 'preco'}, brl(p.price)))),
    h('div', {class: 'item-acoes'},
      h('button', {class: 'ib' + (seguindo ? ' on' : ''), title: seguindo ? 'Acompanhando' : 'Acompanhar preço', 'aria-label': 'Acompanhar',
        disabled: seguindo, onclick: () => acompanhar(p)}, ic(seguindo ? 'check' : 'eye', 18)),
      h('button', {class: 'ib x', title: 'Descartar', 'aria-label': 'Descartar', onclick: () => descartar(p)}, ic('x', 18))));
}

function spark(hist) {
  if (!hist || hist.length < 2) return null;
  const W = 300, H = 46, pad = 5, vals = hist.map(x => x[1]), t = hist.map(x => +new Date(x[0]));
  const mn = Math.min(...vals), mx = Math.max(...vals), t0 = t[0], t1 = t[t.length - 1] || t0 + 1;
  const X = i => pad + (t1 === t0 ? 0 : (t[i] - t0) / (t1 - t0)) * (W - 2 * pad), Y = v => mx === mn ? H / 2 : H - pad - (v - mn) / (mx - mn) * (H - 2 * pad);
  const pts = hist.map((x, i) => `${X(i).toFixed(1)},${Y(x[1]).toFixed(1)}`);
  const el = document.createElement('div');
  el.className = 'spark';
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Histórico de preço">
    <polygon points="${pad},${H} ${pts.join(' ')} ${X(hist.length - 1)},${H}" fill="var(--rosa)" opacity=".12"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--rosa)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
  return el;
}

function cartaoAcomp(w) {
  const s = S.wstate[w.id] || {};
  const titulo = s.title || w.title || `Anúncio ${w.id}`, path = s.path || w.path, ph = s.photo || w.photo;
  const vendido = s.state === 'sold', removido = s.state === 'removido', fora = vendido || removido || (s.state && s.state !== 'published');
  const atual = s.price, ini = s.first_price;
  const dif = atual != null && ini != null ? atual - ini : 0;
  const noAlvo = !fora && w.alvo != null && atual != null && atual <= w.alvo;
  const hist = s.history || [], precos = hist.map(x => x[1]);
  const c = h('div', {class: 'wcard'},
    h('div', {class: 'wtopo'},
      h('div', {class: 'foto', style: ph ? `background-image:url(${foto(ph)})` : ''}),
      h('div', {style: 'min-width:0;flex:1'},
        h('a', {href: itemUrl(path), target: '_blank', rel: 'noopener', class: 'titulo', style: 'font-weight:600;display:block'}, titulo),
        h('div', {class: 'preco', style: 'font-size:22px'}, atual == null ? '…' : brl(atual)),
        dif !== 0 && h('div', {class: 'delta ' + (dif < 0 ? 'queda' : 'alta')},
          `${dif < 0 ? '↓' : '↑'} ${brl(Math.abs(dif))} (${Math.abs(Math.round(dif / ini * 100))}%) desde que acompanha`),
        !s.state && h('div', {class: 'sub'}, 'Buscando dados do anúncio…'),
        s.erro && h('div', {class: 'sub'}, 'Não consegui atualizar agora.'))),
    spark(hist),
    precos.length > 1 && h('div', {class: 'sub', style: 'padding:2px 12px 0'},
      `menor ${brl(Math.min(...precos))} · maior ${brl(Math.max(...precos))} · ${hist.length} registros`),
    h('div', {class: 'wrod'},
      h('span', {class: 'chip' + (noAlvo ? ' novo' : '')}, w.alvo != null ? `Alvo: ${brl(w.alvo)}` : 'Sem preço-alvo'),
      h('button', {class: 'btn mini', onclick: () => pedirAlvo(w)}, ic('edit', 14), w.alvo != null ? 'Alterar alvo' : 'Definir alvo'),
      h('span', {style: 'flex:1'}),
      h('button', {class: 'btn mini fantasma perigo', onclick: () => pararAcompanhar(w.id)}, 'Parar')));
  if (vendido) c.prepend(h('span', {class: 'selo cinza'}, 'VENDIDO'));
  else if (removido) c.prepend(h('span', {class: 'selo cinza'}, 'REMOVIDO'));
  else if (fora) c.prepend(h('span', {class: 'selo cinza'}, 'INDISPONÍVEL'));
  else if (noAlvo) c.prepend(h('span', {class: 'selo verde'}, 'NO ALVO'));
  else if (dif < 0) c.prepend(h('span', {class: 'selo verde'}, 'PREÇO CAIU'));
  if (fora) c.style.opacity = '.78';
  return c;
}

const TAGS = {novo: 'NOVO', queda: 'PREÇO CAIU', alvo: 'NO PREÇO-ALVO', alta: 'PREÇO SUBIU', vendido: 'VENDIDO', removido: 'REMOVIDO'};

// ---------- telas ----------
function tudoNovo() {
  const desc = descartadosIds(), out = {};
  for (const a of S.alerts) {
    if (a.ativo === false) continue;
    const r = S.results.alertas[a.nome];
    out[a.nome] = (r?.new_ids || []).filter(id => !vistos.has(id) && !desc.has(id));
  }
  return out;
}

function telaInicio() {
  const novos = Object.values(tudoNovo()).reduce((n, l) => n + l.length, 0);
  const ativos = S.alerts.filter(a => a.ativo !== false).length;
  const desc = descartadosIds();
  const eventos = (S.results.eventos || []).filter(e => !(e.tipo === 'novo' && desc.has(e.id))).slice(0, 30);
  return h('div', {},
    h('div', {class: 'stats'},
      h('div', {class: 'stat'}, h('b', {}, novos), h('span', {}, 'novos para ver')),
      h('div', {class: 'stat'}, h('b', {}, ativos), h('span', {}, ativos === 1 ? 'busca ativa' : 'buscas ativas')),
      h('div', {class: 'stat'}, h('b', {}, S.watch.length), h('span', {}, 'acompanhando'))),
    h('div', {class: 'tit-sec'}, h('h2', {}, 'Novidades'), novos > 0 && h('button', {class: 'btn mini', onclick: () => marcarVistos()}, ic('check', 14), 'Marcar tudo como visto')),
    eventos.length ? eventos.map(e => h('a', {class: 'evento', href: itemUrl(e.path), target: '_blank', rel: 'noopener'},
      h('div', {class: 'foto', style: e.photo ? `background-image:url(${foto(e.photo)})` : ''}),
      h('div', {class: 'tx'}, h('span', {class: 'tag ' + e.tipo}, TAGS[e.tipo] || e.tipo.toUpperCase()),
        h('div', {class: 'tt'}, e.titulo), h('div', {class: 'sub'}, `${e.detalhe} · ${ago(e.quando)}`))))
      : h('div', {class: 'vazio'}, h('b', {}, 'Nada de novo por enquanto'),
        S.alerts.length ? 'Quando aparecer anúncio novo, queda de preço, venda ou remoção, ele aparece aqui.' : 'Crie seu primeiro alerta na aba Buscas.'));
}

function secaoAlerta(a) {
  const ativo = a.ativo !== false, r = S.results.alertas[a.nome], erro = S.results.erros?.[a.nome];
  const desc = descartadosIds(), seguindo = new Set(S.watch.map(w => w.id));
  const filtros = [a.item, a.marca, a.cor, a.tamanho && 'tam. ' + a.tamanho,
    (a.preco_min != null || a.preco_max != null) && [a.preco_min != null && 'de ' + brl(a.preco_min), a.preco_max != null && 'até ' + brl(a.preco_max)].filter(Boolean).join(' ')].filter(Boolean);
  let itens = [], novosSet = new Set();
  if (r && ativo) {
    itens = r.items.filter(p => !desc.has(p.id)).sort((x, y) => (x.price ?? 1e12) - (y.price ?? 1e12));
    novosSet = new Set(r.new_ids.filter(id => !vistos.has(id)));
  }
  const nNovos = itens.filter(p => novosSet.has(p.id)).length;
  const aberto = expandidos.has(a.nome), visiveis = aberto ? itens : itens.slice(0, 12);
  return h('section', {class: 'alerta' + (ativo ? '' : ' pausado')},
    h('div', {class: 'alerta-cab'},
      h('div', {}, h('h3', {}, a.nome),
        h('div', {class: 'chips'}, filtros.map(f => h('span', {class: 'chip'}, f)),
          ativo && r && h('span', {class: 'chip'}, `${itens.length} anúncios`),
          nNovos > 0 && h('span', {class: 'chip novo'}, `${nNovos} novos`),
          !ativo && h('span', {class: 'chip'}, 'pausado'))),
      h('div', {class: 'acoes'},
        nNovos > 0 && h('button', {class: 'btn mini', onclick: () => marcarVistos(a.nome)}, ic('check', 14), 'Vistos'),
        h('button', {class: 'btn mini', onclick: () => alternarAlerta(a.nome)}, ativo ? 'Pausar' : 'Retomar'),
        h('button', {class: 'btn mini', onclick: () => editarAlerta(a)}, ic('edit', 14), 'Editar'),
        h('button', {class: 'btn mini perigo', onclick: () => excluirAlerta(a.nome)}, ic('trash', 14)))),
    ativo && !r && h('div', {class: 'vazio', style: 'margin:0 14px 14px'},
      erro ? h('span', {}, h('b', {}, 'Erro na busca'), erro) : h('span', {}, h('b', {}, 'Aguardando a primeira busca…'), 'Ela roda sozinha em instantes.')),
    ativo && r && !itens.length && h('div', {class: 'vazio', style: 'margin:0 14px 14px'}, h('b', {}, 'Nenhum anúncio encontrado'), 'Tente relaxar os filtros.'),
    visiveis.length > 0 && h('div', {class: 'grade'}, visiveis.map(p => cartaoItem(p, {novo: novosSet.has(p.id), seguindo: seguindo.has(p.id)}))),
    itens.length > 12 && h('div', {class: 'mais'}, h('button', {class: 'btn', onclick: () => { aberto ? expandidos.delete(a.nome) : expandidos.add(a.nome); desenhar(); }},
      aberto ? 'Mostrar menos' : `Ver todos (${itens.length})`)));
}

function telaBuscas() {
  return h('div', {},
    h('div', {class: 'tit-sec'}, h('div', {}, h('h2', {}, 'Buscas'), h('div', {class: 'sub'}, 'Sempre do menor para o maior preço')),
      h('button', {class: 'btn pri', onclick: novoAlerta}, ic('plus', 16), 'Novo alerta')),
    S.alerts.length ? S.alerts.map(secaoAlerta)
      : h('div', {class: 'vazio'}, h('b', {}, 'Nenhum alerta ainda'), 'Toque em “Novo alerta” e diga o que você procura.'),
    S.discarded.length > 0 && h('details', {class: 'cartao'}, h('summary', {style: 'cursor:pointer;font-weight:700'}, `Descartados (${S.discarded.length})`),
      S.discarded.map(d => h('div', {class: 'evento', style: 'box-shadow:none;border:1px solid var(--linha);margin-top:10px'},
        h('div', {class: 'foto', style: d.photo ? `background-image:url(${foto(d.photo)})` : ''}),
        h('div', {class: 'tx'}, h('div', {class: 'tt'}, d.title), h('div', {class: 'sub'}, brl(d.price))),
        h('button', {class: 'btn mini', onclick: () => restaurar(d.id)}, 'Restaurar')))));
}

function telaAcomp() {
  const campo = h('input', {placeholder: 'Cole o link do anúncio (enjoei.com.br/p/...)', 'aria-label': 'Link do anúncio', autocomplete: 'off'});
  const lista = [...S.watch].sort((a, b) => (S.wstate[a.id]?.price ?? 1e12) - (S.wstate[b.id]?.price ?? 1e12));
  return h('div', {},
    h('div', {class: 'tit-sec'}, h('div', {}, h('h2', {}, 'Acompanhando'), h('div', {class: 'sub'}, 'Preço, histórico e vendido/removido')) ),
    h('form', {class: 'form-linha', onsubmit: async ev => {
      ev.preventDefault();
      try { await acompanharLink(campo.value); campo.value = ''; } catch (e) { toast(e.message, {erro: true}); }
    }}, campo, h('button', {class: 'btn pri'}, 'Acompanhar')),
    lista.length ? h('div', {class: 'lista'}, lista.map(cartaoAcomp))
      : h('div', {class: 'vazio'}, h('b', {}, 'Nenhum anúncio acompanhado'), 'Cole um link acima ou toque no olho em um anúncio das buscas.'));
}

const APP_VERSAO = '6';

async function diagnostico(box) {
  const c = ghCfg(), linhas = [
    `Versão do app: ${APP_VERSAO}`, `Modo: ${Store.mode}`, `Endereço: ${location.href}`,
    `Repositório: ${c?.repo || '(não configurado)'}`,
    `Token salvo: ${c?.token ? `sim, ${c.token.length} caracteres${/^[\x21-\x7e]+$/.test(c.token) ? '' : ', COM CARACTERES INVÁLIDOS'}` : 'não'}`];
  let copia = 'não'; try { copia = (await idb('readonly', s => s.get('gh')))?.token ? 'sim' : 'não'; } catch { copia = 'indisponível'; }
  let persist = 'desconhecido'; try { persist = (await navigator.storage?.persisted?.()) ? 'sim' : 'não'; } catch {}
  linhas.push(`Cópia de segurança: ${copia}`, `Armazenamento persistente: ${persist}`);
  const mostra = () => { box.textContent = linhas.join('\n'); };
  mostra();
  const testa = async (nome, url, opts = {}) => {
    try { const r = await fetch(url, {cache: 'no-store', ...opts}); linhas.push(`${nome}: HTTP ${r.status}`); }
    catch (e) { linhas.push(`${nome}: FALHOU (${e.message})`); }
    mostra();
  };
  await testa('Site', `data/results.json?t=${Date.now()}`);
  await testa('GitHub sem token', 'https://api.github.com/zen');
  if (c?.token) await testa('GitHub com token', `https://api.github.com/repos/${c.repo}/contents/docs/data/alerts.json?ref=${encodeURIComponent(c.branch || 'main')}`,
    {headers: {Authorization: `Bearer ${c.token}`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github.raw+json'}});
  linhas.push('Fim do teste.'); mostra();
}

let conviteInstalar = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); conviteInstalar = e; if (tab === 'ajustes') desenhar(); });

function telaAjustes() {
  const c = ghCfg() || {repo: guessRepo(), branch: 'main', token: ''};
  const modo = {local: ['Servidor local (este computador)', 'Edição liberada. Os dados são salvos nesta máquina.'],
    github: ['GitHub conectado', 'Edição liberada. Cada alteração é salva no repositório e a busca roda no GitHub.'],
    readonly: ['Somente leitura', 'Você pode ver os resultados, mas para criar alertas é preciso conectar o GitHub abaixo.']}[Store.mode];
  const repo = h('input', {value: c.repo, placeholder: 'seu-usuario/enjoei-alertas', autocomplete: 'off', 'aria-label': 'Repositório'});
  const branch = h('input', {value: c.branch || 'main', autocomplete: 'off', 'aria-label': 'Branch'});
  const token = h('input', {type: 'password', value: c.token || '', placeholder: 'github_pat_…', autocomplete: 'off', 'aria-label': 'Token'});
  return h('div', {},
    h('div', {class: 'tit-sec'}, h('h2', {}, 'Ajustes')),
    h('div', {class: 'cartao'}, h('h3', {}, 'Conexão'), h('p', {}, h('b', {style: 'color:var(--txt)'}, modo[0]), ' — ', modo[1]),
      Store.mode !== 'local' && h('form', {onsubmit: async ev => {
        ev.preventDefault();
        await salvarCfg({repo: repo.value.trim(), branch: branch.value.trim() || 'main', token: token.value.trim()});
        await Store.detect(); await carregar();
        toast(Store.mode === 'github' ? 'Conectado ao GitHub.' : 'Preencha o repositório e o token.', {erro: Store.mode !== 'github'});
      }},
        h('div', {class: 'campos'}, h('label', {class: 'cheio'}, 'Repositório (usuário/nome)', repo), h('label', {}, 'Branch', branch), h('label', {}, 'Token de acesso', token)),
        h('div', {class: 'folha-bt', style: 'justify-content:flex-start'},
          h('button', {class: 'btn pri'}, 'Salvar e conectar'),
          ghCfg() && h('button', {type: 'button', class: 'btn perigo', onclick: async () => { if (!confirm('Desconectar este aparelho do GitHub?')) return; await apagarCfg(); await Store.detect(); await carregar(); }}, 'Desconectar'))),
      Store.mode !== 'local' && h('details', {style: 'margin-top:12px'}, h('summary', {style: 'cursor:pointer;font-weight:600'}, 'Como criar o token'),
        h('ol', {}, h('li', {}, 'GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.'),
          h('li', {}, 'Em “Repository access”, escolha “Only select repositories” e marque só o repositório do app.'),
          h('li', {}, 'Em Permissions → Repository permissions, deixe ', h('b', {}, 'Contents: Read and write'), '.'),
          h('li', {}, 'Copie o token e cole acima. Ele fica salvo neste aparelho.'))),
      Store.mode === 'github' && h('div', {style: 'margin-top:16px;padding-top:14px;border-top:1px solid var(--linha)'},
        h('b', {}, 'Conectar outro aparelho ou navegador'),
        h('p', {}, 'Abra este link no outro aparelho e ele já fica conectado, sem digitar nada. Também serve para criar um favorito ou atalho que sempre abre conectado.'),
        h('p', {style: 'color:var(--verm)'}, 'O link contém seu token: não compartilhe com ninguém.'),
        h('button', {class: 'btn', onclick: async () => {
          const l = linkAcesso(ghCfg());
          try { await navigator.clipboard.writeText(l); toast('Link copiado. Mande só para você mesmo.'); }
          catch { prompt('Copie o link:', l); }
        }}, 'Copiar link de acesso'))),
    h('div', {class: 'cartao'}, h('h3', {}, 'Aviso por e-mail'),
      h('p', {}, 'A verificação roda uma vez por dia no GitHub (o horário costuma atrasar). Com o e-mail configurado, ela envia um resumo das novidades; sem ele, as novidades aparecem só aqui no app.'),
      h('p', {}, 'Configuração (uma vez): no repositório, Settings → Secrets and variables → Actions, crie ', h('code', {}, 'SMTP_USER'), ' (seu e-mail Outlook/Hotmail) e ',
        h('code', {}, 'SMTP_PASSWORD'), ' (senha de app da conta Microsoft).')),
    h('div', {class: 'cartao'}, h('h3', {}, 'Instalar no celular'),
      h('p', {}, 'Android (Chrome): menu ⋮ → “Instalar app”. iPhone (Safari): Compartilhar → “Adicionar à Tela de Início”.'),
      conviteInstalar && h('button', {class: 'btn pri', onclick: async () => { conviteInstalar.prompt(); conviteInstalar = null; desenhar(); }}, 'Instalar agora')),
    h('div', {class: 'cartao'}, h('h3', {}, 'Dados'),
      h('div', {class: 'folha-bt', style: 'justify-content:flex-start;margin:0'},
        h('button', {class: 'btn', onclick: () => { marcarVistos(); toast('Tudo marcado como visto.'); }}, 'Marcar tudo como visto'),
        h('button', {class: 'btn', onclick: () => carregar()}, 'Recarregar dados'),
        h('button', {class: 'btn', onclick: () => diagnostico($('#diag'))}, 'Testar conexão')),
      h('pre', {id: 'diag', style: 'white-space:pre-wrap;word-break:break-word;font-size:13px;margin:12px 0 0;color:var(--mut)'})));
}

// ---------- desenho ----------
const ABAS = [['inicio', 'Início', 'home'], ['buscas', 'Buscas', 'search'], ['acompanhando', 'Acompanhando', 'eye'], ['ajustes', 'Ajustes', 'sliders']];

function desenhar() {
  const totalNovos = Object.values(tudoNovo()).reduce((n, l) => n + l.length, 0);
  $('#abas').replaceChildren(...ABAS.map(([id, nome, icone]) => h('button', {class: 'aba' + (tab === id ? ' ativa' : ''), onclick: () => { location.hash = id; }},
    ic(icone, 22), nome, id === 'buscas' && totalNovos > 0 && h('span', {class: 'pt'}, totalNovos > 99 ? '99+' : totalNovos))));
  const main = $('#conteudo');
  if (!carregado) { main.replaceChildren(h('div', {class: 'esq'}), h('div', {class: 'esq'})); }
  else {
    const y = window.scrollY;
    main.replaceChildren({inicio: telaInicio, buscas: telaBuscas, acompanhando: telaAcomp, ajustes: telaAjustes}[tab]());
    window.scrollTo(0, y);
  }
  const at = S.results.atualizado;
  $('#status').textContent = textoStatus();
}

function textoStatus() {
  const at = S.results.atualizado;
  return (at ? `Atualizado ${ago(at)}` : (carregado ? 'Sem verificação ainda' : '')) +
    (carregado && Store.mode === 'readonly' ? ' · só leitura' : '') + (Store.ghFalhou ? ' · GitHub inacessível' : '');
}

function rota() {
  if (location.hash.includes('conectar=')) { recuperarCfg().then(() => Store.detect()).then(() => carregar()); return; }
  const t = location.hash.slice(1);
  tab = ABAS.some(a => a[0] === t) ? t : 'inicio';
  desenhar();
  window.scrollTo(0, 0);
}

// ---------- início ----------
$('#btn-rodar').append(ic('refresh', 20));
$('#btn-rodar').addEventListener('click', rodarAgora);
window.addEventListener('hashchange', rota);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - ultimoLoad > 60_000) carregar(true);
});
setInterval(() => { if (!document.hidden) $('#status').textContent = textoStatus(); }, 60_000);

// Só registra no site publicado: em endereços locais o service worker ocuparia a porta de outros apps.
if ('serviceWorker' in navigator) {
  if (location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  else navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
}

(async () => {
  tab = ABAS.some(a => a[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'inicio';
  desenhar();
  await recuperarCfg();
  await Store.detect();
  await carregar();
})();
