'use strict';
/* Alertas Enjoei — app (PWA) com login. Dados de cada pessoa no Supabase; um robô no GitHub faz as buscas. */

const SUPA_URL = 'https://rfhaghhpvpafuvjfnuju.supabase.co';
const SUPA_KEY = 'sb_publishable_Ahf0vPqdV2NQRpQQ9p_8xA_xf4BiQ0V';   // chave pública (vai no app por natureza)
const VAPID_PUBLICA = 'BJW_JpFid6g-76elJ7GlrZU9ZXHBZJ3U2eInkvJydHxqj6wqFmbB9EbQ2dHU_EDInh5-CBQwku-aHW2lC0s0CG4';
const APP_VERSAO = '12';

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
  down: '<path d="M6 9l6 6 6-6"/>',
  up: '<path d="M18 15l-6-6-6 6"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
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
const txt = v => { v = String(v ?? '').trim(); return v === '' ? null : v; };
const ago = iso => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return 'agora há pouco';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
};

function toast(msg, {erro = false, acao = null, ms = 5000} = {}) {
  const t = h('div', {class: 'toast' + (erro ? ' erro' : '')}, h('span', {}, msg),
    acao && h('button', {onclick: () => { acao.fn(); t.remove(); }}, acao.label));
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

// mensagens do banco em português simples
function msgErro(e) {
  const m = (e && (e.message || e.error_description || e.msg)) || String(e);
  if (/Limite atingido/.test(m)) return m;
  if (/duplicate key|unique/i.test(m)) return 'Já existe um item com esse nome.';
  if (/coalesce|check constraint.*alerts/i.test(m)) return 'Informe ao menos item, marca ou cor.';
  if (/Cadastros temporariamente encerrados|saving new user/i.test(m)) return 'Novos cadastros estão temporariamente encerrados.';
  if (/rate limit|too many|security purposes/i.test(m)) return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  if (/Token has expired|invalid/i.test(m) && /otp|token/i.test(m)) return 'Código inválido ou vencido. Peça um novo.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Sem conexão com o servidor. Verifique a internet.';
  return m;
}

// ---------- Supabase ----------
const sb = window.supabase.createClient(SUPA_URL, SUPA_KEY, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'enjoei.sessao'},
});
async function q(promessa) {   // executa e lança erro legível
  const {data, error} = await promessa;
  if (error) throw new Error(msgErro(error));
  return data;
}

// ---------- estado ----------
let usuario = null, carregado = false, tab = 'inicio', ultimoLoad = 0, canal = null;
let S = {alerts: [], results: {}, watch: [], discarded: [], events: [], vistos: new Set(), settings: null};
const expandidos = new Set();
const descartadosIds = () => new Set(S.discarded.map(d => d.product_id));

async function carregar(silencioso = false) {
  try {
    const [alerts, results, watch, discarded, events, vistos, settings] = await Promise.all([
      q(sb.from('alerts').select('*').order('criado_em')),
      q(sb.from('alert_results').select('alert_id,items,new_ids,primeira_execucao,erro,verificado_em')),
      q(sb.from('watch').select('*').order('criado_em')),
      q(sb.from('discarded').select('*').order('criado_em', {ascending: false})),
      q(sb.from('events').select('*').order('quando', {ascending: false}).limit(100)),
      q(sb.from('item_vistos').select('product_id')),
      q(sb.from('settings').select('*').maybeSingle()),
    ]);
    S = {alerts, results: Object.fromEntries(results.map(r => [r.alert_id, r])), watch, discarded, events,
      vistos: new Set(vistos.map(v => v.product_id)), settings};
    ultimoLoad = Date.now();
    carregado = true;
  } catch (e) {
    if (!silencioso) toast('Não consegui carregar os dados: ' + e.message, {erro: true});
  }
  desenhar();
}

// atualiza sozinho quando o robô grava algo novo para este usuário
function ouvirMudancas() {
  if (canal) sb.removeChannel(canal);
  let pendente = null;
  const recarregar = () => { clearTimeout(pendente); pendente = setTimeout(() => carregar(true), 800); };
  canal = sb.channel('mudancas-' + usuario.id);
  for (const t of ['alert_results', 'events', 'watch']) {
    canal.on('postgres_changes', {event: '*', schema: 'public', table: t, filter: `user_id=eq.${usuario.id}`}, recarregar);
  }
  canal.subscribe();
}

// ---------- ações ----------
async function agir(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r ?? true; }
  catch (e) { toast(msgErro(e), {erro: true, ms: 8000}); await carregar(true); return false; }
}
async function pedirVerificacao(silencioso = false) {
  await q(sb.from('settings').update({pedido_verificacao: new Date().toISOString()}).eq('user_id', usuario.id));
  if (!silencioso) toast('Pedido enviado. A busca roda em alguns minutos e o app atualiza sozinho.', {ms: 7000});
}
const rodarAgora = () => agir(() => pedirVerificacao());

function limparAlerta(a) {
  const nome = (a.nome || a.item || '').trim();
  if (!nome) throw new Error('Informe o nome ou o item.');
  const o = {nome, item: txt(a.item), marca: txt(a.marca), cor: txt(a.cor), tamanho: txt(a.tamanho),
    preco_min: num(a.preco_min), preco_max: num(a.preco_max), excluir: txt(a.excluir)};
  if (!o.item && !o.marca && !o.cor) o.item = nome;
  return o;
}
async function salvarAlerta(dados, original) {
  const a = limparAlerta(dados);
  if (original) await q(sb.from('alerts').update(a).eq('id', original.id));
  else await q(sb.from('alerts').insert(a));
  await pedirVerificacao(true);
  await carregar(true);
  toast(original ? 'Alerta atualizado. A busca roda em alguns minutos.' : 'Alerta criado. A primeira busca roda em alguns minutos.', {ms: 7000});
}
const alternarAlerta = a => agir(async () => {
  await q(sb.from('alerts').update({ativo: !a.ativo}).eq('id', a.id));
  if (!a.ativo) await pedirVerificacao(true);
  await carregar(true);
});
async function excluirAlerta(a) {
  if (!confirm(`Excluir o alerta "${a.nome}"?`)) return;
  await agir(async () => { await q(sb.from('alerts').delete().eq('id', a.id)); await carregar(true); });
}
function alternarRecolhido(a) {
  a.recolhido = !a.recolhido;
  desenhar();
  sb.from('alerts').update({recolhido: a.recolhido}).eq('id', a.id).then(({error}) => error && toast(msgErro(error), {erro: true}));
}
function recolherTodos(fechar) {
  S.alerts.forEach(a => { a.recolhido = fechar; });
  desenhar();
  sb.from('alerts').update({recolhido: fechar}).eq('user_id', usuario.id).then(({error}) => error && toast(msgErro(error), {erro: true}));
}

const idDoLink = t => { const m = String(t).trim().match(/(\d{5,})\s*(?:[?#].*)?$/); return m ? m[1] : null; };
async function acompanhar(p) {
  if (S.watch.some(w => w.product_id === p.id)) return;
  await agir(async () => {
    await q(sb.from('watch').insert({product_id: p.id, path: p.path || null, title: p.title || null, photo: p.photo || null}));
    await pedirVerificacao(true);
    await carregar(true);
  }, 'Acompanhando preço e disponibilidade.');
}
async function acompanharLink(t) {
  const id = idDoLink(t);
  if (!id) throw new Error('Não achei o número do anúncio nesse link.');
  const m = String(t).match(/\/p\/([^?#\s]+)/), path = m ? m[1] : '';
  await acompanhar({id, path, title: path ? path.replace(/-?\d{5,}$/, '').replace(/-/g, ' ') : `anúncio ${id}`, photo: ''});
}
const pararAcompanhar = w => agir(async () => { await q(sb.from('watch').delete().eq('product_id', w.product_id).eq('user_id', usuario.id)); await carregar(true); });
async function definirAlvo(w, valor) {
  await q(sb.from('watch').update({alvo: valor}).eq('product_id', w.product_id).eq('user_id', usuario.id));
  await pedirVerificacao(true);
  await carregar(true);
  if (valor != null) toast(`Aviso quando chegar a ${brl(valor)} ou menos.`);
}
async function descartar(p) {
  if (descartadosIds().has(p.id)) return;
  S.discarded.unshift({product_id: p.id, title: p.title, photo: p.photo, price: p.price, path: p.path});
  desenhar();
  const ok = await agir(() => q(sb.from('discarded').insert({product_id: p.id, title: p.title, photo: p.photo, price: p.price, path: p.path})));
  if (ok) toast('Anúncio descartado.', {acao: {label: 'Desfazer', fn: () => restaurar(p.id)}});
}
async function restaurar(id) {
  S.discarded = S.discarded.filter(d => d.product_id !== id);
  desenhar();
  await agir(() => q(sb.from('discarded').delete().eq('product_id', id).eq('user_id', usuario.id)));
}

// "visto" sincronizado entre aparelhos
async function marcarItensVistos(ids) {
  const novos = [...new Set(ids)].filter(id => !S.vistos.has(id));
  if (!novos.length) return;
  novos.forEach(id => S.vistos.add(id));
  await q(sb.from('item_vistos').upsert(novos.map(product_id => ({product_id})), {onConflict: 'user_id,product_id', ignoreDuplicates: true}));
}
async function marcarEvento(e) {
  e.visto = true;
  desenhar();
  await agir(async () => {
    await q(sb.from('events').update({visto: true}).eq('id', e.id));
    if (e.tipo === 'novo') await marcarItensVistos([e.product_id]);
  });
}
async function marcarVistos(alerta) {
  const lista = alerta ? [alerta] : S.alerts;
  const ids = lista.flatMap(a => S.results[a.id]?.new_ids || []);
  if (!alerta) S.events.forEach(e => { e.visto = true; });
  desenhar();
  await agir(async () => {
    await marcarItensVistos(ids);
    if (!alerta) await q(sb.from('events').update({visto: true}).eq('user_id', usuario.id).eq('visto', false));
  });
  desenhar();
}

// ---------- notificações push ----------
const pushSuportado = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:';
const b64ParaBytes = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
async function inscricaoAtual() {
  if (!pushSuportado()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function ativarPush() {
  if (!pushSuportado()) throw new Error(/iPhone|iPad/.test(navigator.userAgent)
    ? 'No iPhone, instale o app na tela inicial (Compartilhar → Adicionar à Tela de Início) e ative por ele.'
    : 'Este navegador não aceita notificações.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Permissão de notificação negada. Libere nas configurações do navegador.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ||
    await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64ParaBytes(VAPID_PUBLICA)});
  const j = sub.toJSON();
  await q(sb.from('push_subs').upsert({endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, aparelho: navigator.userAgent.slice(0, 200)}, {onConflict: 'endpoint'}));
  if (!S.settings?.avisar_push) await q(sb.from('settings').update({avisar_push: true}).eq('user_id', usuario.id));
}
async function desativarPush() {
  const sub = await inscricaoAtual();
  if (sub) { await q(sb.from('push_subs').delete().eq('endpoint', sub.endpoint)); await sub.unsubscribe(); }
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
  const bt = h('button', {type: 'submit', class: 'btn pri'}, ok);
  f.append(h('h2', {}, titulo), grade, erro, h('div', {class: 'folha-bt'},
    h('button', {type: 'button', class: 'btn fantasma', onclick: () => d.close()}, 'Cancelar'), bt));
  f.onsubmit = async ev => {
    ev.preventDefault();
    bt.disabled = true;
    try { await onOk(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]))); d.close(); }
    catch (e) { erro.textContent = msgErro(e); }
    finally { bt.disabled = false; }
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
  {nome: 'excluir', rotulo: 'Excluir anúncios com as palavras', dica: 'ex.: infantil, kit, réplica', cheio: true},
];
const novoAlerta = () => folha('Novo alerta', CAMPOS_ALERTA, {ok: 'Criar alerta', onOk: v => salvarAlerta(v, null)});
const editarAlerta = a => folha('Editar alerta', CAMPOS_ALERTA, {valores: a, onOk: v => salvarAlerta(v, a)});
const pedirAlvo = w => folha('Preço-alvo', [{nome: 'alvo', rotulo: 'Avisar quando o preço chegar a (R$) ou menos', num: true, cheio: true, dica: 'deixe vazio para remover'}],
  {valores: {alvo: w.alvo ?? ''}, onOk: v => definirAlvo(w, num(v.alvo))});

// ---------- componentes ----------
function textoIdade(i) {   // estimativa: o Enjoei não informa a data exata de publicação
  if (!Array.isArray(i)) return '';
  const [a, b] = i;
  if (b == null) return `no ar há mais de ${a} dias`;
  if (b <= 2) return 'no ar há até 2 dias';
  if (a === b) return `no ar há ${a} dias`;
  return `no ar há ${a}–${b} dias`;
}

function cartaoItem(p, {novo = false, seguindo = false} = {}) {
  const meta = [p.brand, p.size && 'tam. ' + p.size].filter(Boolean).join(' · '), idade = textoIdade(p.idade);
  return h('div', {class: 'item' + (novo ? ' novo' : '')},
    novo && h('span', {class: 'selo'}, 'NOVO'),
    h('a', {class: 'corpo', href: itemUrl(p.path), target: '_blank', rel: 'noopener', onclick: () => novo && marcarItensVistos([p.id]).catch(() => {})},
      p.photo ? h('img', {class: 'foto', loading: 'lazy', alt: '', src: foto(p.photo)}) : h('div', {class: 'foto'}),
      h('div', {class: 'info'}, h('div', {class: 'titulo'}, p.title), meta && h('div', {class: 'meta'}, meta),
        idade && h('div', {class: 'meta idade', title: 'Estimativa: o Enjoei não informa a data exata de publicação'}, idade),
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
  const s = w.estado || {};
  const titulo = s.title || w.title || `Anúncio ${w.product_id}`, path = s.path || w.path, ph = s.photo || w.photo;
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
      h('button', {class: 'btn mini fantasma perigo', onclick: () => pararAcompanhar(w)}, 'Parar')));
  if (vendido) c.prepend(h('span', {class: 'selo cinza'}, 'VENDIDO'));
  else if (removido) c.prepend(h('span', {class: 'selo cinza'}, 'REMOVIDO'));
  else if (fora) c.prepend(h('span', {class: 'selo cinza'}, 'INDISPONÍVEL'));
  else if (noAlvo) c.prepend(h('span', {class: 'selo verde'}, 'NO ALVO'));
  else if (dif < 0) c.prepend(h('span', {class: 'selo verde'}, 'PREÇO CAIU'));
  if (fora) c.style.opacity = '.78';
  return c;
}

const TAGS = {novo: 'NOVO', queda: 'PREÇO CAIU', alvo: 'NO PREÇO-ALVO', alta: 'PREÇO SUBIU', vendido: 'VENDIDO', removido: 'REMOVIDO'};
const evVisto = e => e.visto || (e.tipo === 'novo' && S.vistos.has(e.product_id));
const eventosValidos = () => { const d = descartadosIds(); return S.events.filter(e => !(e.tipo === 'novo' && d.has(e.product_id))); };

function tudoNovo() {
  const desc = descartadosIds(), out = {};
  for (const a of S.alerts) {
    if (!a.ativo) continue;
    out[a.id] = (S.results[a.id]?.new_ids || []).filter(id => !S.vistos.has(id) && !desc.has(id));
  }
  return out;
}

// ---------- telas ----------
function telaInicio() {
  const novos = Object.values(tudoNovo()).reduce((n, l) => n + l.length, 0);
  const ativos = S.alerts.filter(a => a.ativo).length;
  const todos = eventosValidos(), pendentes = todos.filter(e => !evVisto(e)), jaVistos = todos.filter(evVisto).slice(0, 30);
  const linha = (e, comBotao) => h('div', {class: 'evento' + (comBotao ? '' : ' visto')},
    h('a', {class: 'lk', href: itemUrl(e.path), target: '_blank', rel: 'noopener', onclick: () => comBotao && setTimeout(() => marcarEvento(e), 400)},
      h('div', {class: 'foto', style: e.photo ? `background-image:url(${foto(e.photo)})` : ''}),
      h('div', {class: 'tx'}, h('span', {class: 'tag ' + e.tipo}, TAGS[e.tipo] || e.tipo.toUpperCase()),
        h('div', {class: 'tt'}, e.titulo), h('div', {class: 'sub'}, `${e.detalhe || ''} · ${ago(e.quando)}`))),
    comBotao && h('button', {class: 'ib', title: 'Marcar como visto', 'aria-label': 'Marcar como visto', style: 'flex:none;width:40px', onclick: () => marcarEvento(e)}, ic('check', 18)));
  return h('div', {},
    h('div', {class: 'stats'},
      h('div', {class: 'stat'}, h('b', {}, novos), h('span', {}, 'novos para ver')),
      h('div', {class: 'stat'}, h('b', {}, ativos), h('span', {}, ativos === 1 ? 'busca ativa' : 'buscas ativas')),
      h('div', {class: 'stat'}, h('b', {}, S.watch.length), h('span', {}, 'acompanhando'))),
    h('div', {class: 'tit-sec'}, h('h2', {}, pendentes.length ? `Novidades (${pendentes.length})` : 'Novidades'),
      (pendentes.length > 0 || novos > 0) && h('button', {class: 'btn mini', onclick: () => marcarVistos()}, ic('check', 14), 'Marcar tudo como visto')),
    pendentes.length ? pendentes.map(e => linha(e, true))
      : h('div', {class: 'vazio'}, h('b', {}, todos.length ? 'Tudo em dia' : 'Nada de novo por enquanto'),
        S.alerts.length ? 'Quando aparecer anúncio novo, queda de preço, venda ou remoção, ele aparece aqui.' : 'Crie seu primeiro alerta na aba Buscas.'),
    jaVistos.length > 0 && h('details', {style: 'margin-top:18px'}, h('summary', {style: 'cursor:pointer;font-weight:600;color:var(--mut)'}, `Já vistos (${jaVistos.length})`),
      h('div', {style: 'margin-top:10px'}, jaVistos.map(e => linha(e, false)))));
}

function secaoAlerta(a) {
  const r = S.results[a.id], ativo = a.ativo, fechado = a.recolhido;
  const desc = descartadosIds(), seguindo = new Set(S.watch.map(w => w.product_id));
  const filtros = [a.item, a.marca, a.cor, a.tamanho && 'tam. ' + a.tamanho, a.excluir && 'sem: ' + a.excluir,
    (a.preco_min != null || a.preco_max != null) && [a.preco_min != null && 'de ' + brl(a.preco_min), a.preco_max != null && 'até ' + brl(a.preco_max)].filter(Boolean).join(' ')].filter(Boolean);
  let itens = [], novosSet = new Set();
  if (r && ativo) {
    itens = (r.items || []).filter(p => !desc.has(p.id)).sort((x, y) => (x.price ?? 1e12) - (y.price ?? 1e12));
    novosSet = new Set((r.new_ids || []).filter(id => !S.vistos.has(id)));
  }
  const nNovos = itens.filter(p => novosSet.has(p.id)).length;
  const aberto = expandidos.has(a.id), visiveis = aberto ? itens : itens.slice(0, 12);
  return h('section', {class: 'alerta' + (ativo ? '' : ' pausado') + (fechado ? ' fechado' : '')},
    h('div', {class: 'alerta-cab'},
      h('div', {class: 'alerta-tit', role: 'button', tabindex: '0', 'aria-expanded': String(!fechado), title: fechado ? 'Abrir' : 'Minimizar',
        onclick: () => alternarRecolhido(a), onkeydown: ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); alternarRecolhido(a); } }},
        h('h3', {}, ic(fechado ? 'down' : 'up', 18), a.nome),
        h('div', {class: 'chips'}, !fechado && filtros.map(f => h('span', {class: 'chip'}, f)),
          ativo && r && h('span', {class: 'chip'}, `${itens.length} anúncios`),
          nNovos > 0 && h('span', {class: 'chip novo'}, `${nNovos} novos`),
          !ativo && h('span', {class: 'chip'}, 'pausado'))),
      !fechado && h('div', {class: 'acoes'},
        h('button', {class: 'btn mini', 'aria-expanded': 'true', onclick: () => alternarRecolhido(a)}, ic('up', 14), 'Minimizar'),
        nNovos > 0 && h('button', {class: 'btn mini', onclick: () => marcarVistos(a)}, ic('check', 14), 'Vistos'),
        h('button', {class: 'btn mini', onclick: () => alternarAlerta(a)}, ativo ? 'Pausar' : 'Retomar'),
        h('button', {class: 'btn mini', onclick: () => editarAlerta(a)}, ic('edit', 14), 'Editar'),
        h('button', {class: 'btn mini perigo', 'aria-label': 'Excluir alerta', onclick: () => excluirAlerta(a)}, ic('trash', 14)))),
    !fechado && ativo && !r && h('div', {class: 'vazio', style: 'margin:0 14px 14px'},
      h('span', {}, h('b', {}, 'Aguardando a primeira busca…'), 'Ela roda sozinha em alguns minutos.')),
    !fechado && ativo && r?.erro && h('div', {class: 'vazio', style: 'margin:0 14px 14px'}, h('b', {}, 'Erro na busca'), r.erro),
    !fechado && ativo && r && !r.erro && !itens.length && h('div', {class: 'vazio', style: 'margin:0 14px 14px'}, h('b', {}, 'Nenhum anúncio encontrado'), 'Tente relaxar os filtros.'),
    !fechado && visiveis.length > 0 && h('div', {class: 'grade'}, visiveis.map(p => cartaoItem(p, {novo: novosSet.has(p.id), seguindo: seguindo.has(p.id)}))),
    !fechado && itens.length > 12 && h('div', {class: 'mais'}, h('button', {class: 'btn', onclick: () => { aberto ? expandidos.delete(a.id) : expandidos.add(a.id); desenhar(); }},
      aberto ? 'Mostrar menos' : `Ver todos (${itens.length})`)));
}

function telaBuscas() {
  return h('div', {},
    h('div', {class: 'tit-sec'}, h('div', {}, h('h2', {}, 'Buscas'), h('div', {class: 'sub'}, 'Sempre do menor para o maior preço')),
      h('button', {class: 'btn pri', onclick: novoAlerta}, ic('plus', 16), 'Novo alerta')),
    S.alerts.length > 1 && h('div', {style: 'display:flex;justify-content:flex-end;margin:-4px 0 10px'},
      S.alerts.every(a => a.recolhido)
        ? h('button', {class: 'btn mini fantasma', onclick: () => recolherTodos(false)}, ic('down', 14), 'Abrir todos')
        : h('button', {class: 'btn mini fantasma', onclick: () => recolherTodos(true)}, ic('up', 14), 'Minimizar todos')),
    S.alerts.length ? S.alerts.map(secaoAlerta)
      : h('div', {class: 'vazio'}, h('b', {}, 'Nenhum alerta ainda'), 'Toque em “Novo alerta” e diga o que você procura.'),
    S.discarded.length > 0 && h('details', {class: 'cartao'}, h('summary', {style: 'cursor:pointer;font-weight:700'}, `Descartados (${S.discarded.length})`),
      S.discarded.map(d => h('div', {class: 'evento', style: 'box-shadow:none;border:1px solid var(--linha);margin-top:10px'},
        h('div', {class: 'foto', style: d.photo ? `background-image:url(${foto(d.photo)})` : ''}),
        h('div', {class: 'tx'}, h('div', {class: 'tt'}, d.title), h('div', {class: 'sub'}, brl(d.price))),
        h('button', {class: 'btn mini', onclick: () => restaurar(d.product_id)}, 'Restaurar')))));
}

function telaAcomp() {
  const campo = h('input', {placeholder: 'Cole o link do anúncio (enjoei.com.br/p/...)', 'aria-label': 'Link do anúncio', autocomplete: 'off'});
  const lista = [...S.watch].sort((a, b) => (a.estado?.price ?? 1e12) - (b.estado?.price ?? 1e12));
  return h('div', {},
    h('div', {class: 'tit-sec'}, h('div', {}, h('h2', {}, 'Acompanhando'), h('div', {class: 'sub'}, 'Preço, histórico e vendido/removido'))),
    h('form', {class: 'form-linha', onsubmit: async ev => {
      ev.preventDefault();
      try { await acompanharLink(campo.value); campo.value = ''; } catch (e) { toast(msgErro(e), {erro: true}); }
    }}, campo, h('button', {class: 'btn pri'}, 'Acompanhar')),
    lista.length ? h('div', {class: 'lista'}, lista.map(cartaoAcomp))
      : h('div', {class: 'vazio'}, h('b', {}, 'Nenhum anúncio acompanhado'), 'Cole um link acima ou toque no olho em um anúncio das buscas.'));
}

let conviteInstalar = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); conviteInstalar = e; if (tab === 'ajustes') desenhar(); });

function telaAjustes() {
  const st = S.settings || {};
  const pushBox = h('div', {class: 'sub', id: 'push-estado'}, 'Verificando…');
  const pushBt = h('button', {class: 'btn pri'}, 'Ativar notificações neste aparelho');
  (async () => {
    const sub = await inscricaoAtual().catch(() => null);
    if (!pushSuportado()) { pushBox.textContent = /iPhone|iPad/.test(navigator.userAgent) ? 'No iPhone, as notificações funcionam com o app instalado na tela inicial (Compartilhar → Adicionar à Tela de Início).' : 'Este navegador não aceita notificações.'; pushBt.hidden = true; return; }
    if (sub && Notification.permission === 'granted') {
      pushBox.textContent = 'Notificações ativas neste aparelho.';
      pushBt.textContent = 'Desativar neste aparelho'; pushBt.className = 'btn';
      pushBt.onclick = async () => { pushBt.disabled = true; await agir(desativarPush, 'Notificações desativadas neste aparelho.'); desenhar(); };
    } else {
      pushBox.textContent = Notification.permission === 'denied' ? 'As notificações estão bloqueadas no navegador. Libere nas configurações do site.' : 'Desativadas neste aparelho.';
      pushBt.onclick = async () => { pushBt.disabled = true; const ok = await agir(ativarPush, 'Notificações ativadas!'); pushBt.disabled = false; if (ok) { await carregar(true); } };
    }
  })();
  const alterna = (campo, rotulo) => h('label', {style: 'flex-direction:row;align-items:center;gap:10px;font-size:15px;color:var(--txt);font-weight:500;margin-top:8px'},
    h('input', {type: 'checkbox', style: 'width:auto', checked: st[campo] ? true : null, onchange: async ev => {
      const v = ev.target.checked;
      await agir(async () => { await q(sb.from('settings').update({[campo]: v}).eq('user_id', usuario.id)); S.settings[campo] = v; }, v ? 'Ativado.' : 'Desativado.');
    }}), rotulo);
  return h('div', {},
    h('div', {class: 'tit-sec'}, h('h2', {}, 'Ajustes'), h('span', {class: 'sub'}, `versão ${APP_VERSAO}`)),
    h('div', {class: 'cartao'}, h('h3', {}, 'Avisos'),
      h('p', {}, 'Quando aparecer anúncio novo, queda de preço, preço-alvo, venda ou remoção, você recebe um aviso.'),
      alterna('avisar_push', 'Notificação no celular ou computador'),
      alterna('avisar_email', 'E-mail com o resumo'),
      h('div', {style: 'margin-top:12px'}, pushBox, h('div', {style: 'margin-top:8px'}, pushBt)),
      h('p', {}, 'A notificação precisa ser ativada em cada aparelho. A verificação roda a cada poucas horas, e você pode pedir uma agora pelo botão ', ic('refresh', 14), ' no topo.')),
    h('div', {class: 'cartao'}, h('h3', {}, 'Instalar no celular'),
      h('p', {}, 'Android (Chrome): menu ⋮ → “Instalar app”. iPhone (Safari): Compartilhar → “Adicionar à Tela de Início”.'),
      conviteInstalar && h('button', {class: 'btn pri', onclick: async () => { conviteInstalar.prompt(); conviteInstalar = null; desenhar(); }}, 'Instalar agora')),
    h('div', {class: 'cartao'}, h('h3', {}, 'Conta'),
      h('p', {}, 'Conectado como ', h('b', {style: 'color:var(--txt)'}, usuario?.email || '')),
      h('div', {class: 'folha-bt', style: 'justify-content:flex-start;margin:0;flex-wrap:wrap'},
        h('button', {class: 'btn', onclick: () => carregar()}, 'Recarregar dados'),
        h('button', {class: 'btn', onclick: sair}, 'Sair'),
        h('a', {class: 'btn fantasma', href: 'privacidade.html'}, 'Privacidade'),
        h('button', {class: 'btn perigo', onclick: excluirConta}, 'Excluir minha conta'))));
}

// ---------- login ----------
function telaLogin(etapa = 'email', email = '') {
  const main = $('#conteudo');
  $('#abas').hidden = true; $('#btn-rodar').hidden = true; $('#status').textContent = '';
  const erro = h('div', {class: 'sub', style: 'color:var(--verm);min-height:1.3em;margin-top:8px'});
  if (etapa === 'email') {
    const campo = h('input', {type: 'email', placeholder: 'seu@email.com', autocomplete: 'email', required: true, value: email, 'aria-label': 'E-mail'});
    const aceite = h('input', {type: 'checkbox', style: 'width:auto', required: true});
    const bt = h('button', {class: 'btn pri', style: 'width:100%;justify-content:center;margin-top:14px'}, 'Receber código por e-mail');
    main.replaceChildren(h('div', {class: 'login'},
      h('div', {class: 'logo-grande', 'aria-hidden': 'true'}),
      h('h2', {}, 'Alertas para o seu garimpo'),
      h('p', {class: 'sub'}, 'Diga o que procura e seja avisado quando aparecer anúncio novo, queda de preço ou peça vendida no Enjoei.'),
      h('form', {onsubmit: async ev => {
        ev.preventDefault(); erro.textContent = ''; bt.disabled = true;
        const em = campo.value.trim().toLowerCase();
        const {error} = await sb.auth.signInWithOtp({email: em, options: {shouldCreateUser: true, emailRedirectTo: location.origin + location.pathname}});
        bt.disabled = false;
        if (error) { erro.textContent = msgErro(error); return; }
        telaLogin('codigo', em);
      }},
        h('label', {}, 'E-mail', campo),
        h('label', {style: 'flex-direction:row;align-items:flex-start;gap:8px;margin-top:12px;font-weight:500'}, aceite,
          h('span', {}, 'Li e aceito a ', h('a', {href: 'privacidade.html', target: '_blank'}, 'política de privacidade'), '.')),
        bt, erro),
      h('p', {class: 'sub', style: 'margin-top:18px'}, 'Projeto independente, sem vínculo com o Enjoei.')));
    campo.focus();
  } else {
    const campo = h('input', {inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '000000', maxlength: '10', 'aria-label': 'Código', style: 'font-size:24px;letter-spacing:.3em;text-align:center'});
    const bt = h('button', {class: 'btn pri', style: 'width:100%;justify-content:center;margin-top:14px'}, 'Entrar');
    main.replaceChildren(h('div', {class: 'login'},
      h('div', {class: 'logo-grande', 'aria-hidden': 'true'}),
      h('h2', {}, 'Confira seu e-mail'),
      h('p', {class: 'sub'}, `Enviamos um código para ${email}. Digite abaixo, ou toque no link do e-mail neste mesmo aparelho.`),
      h('form', {onsubmit: async ev => {
        ev.preventDefault(); erro.textContent = ''; bt.disabled = true;
        const {error} = await sb.auth.verifyOtp({email, token: campo.value.replace(/\D/g, ''), type: 'email'});
        bt.disabled = false;
        if (error) erro.textContent = msgErro(error);
      }}, h('label', {}, 'Código', campo), bt, erro),
      h('button', {class: 'btn fantasma', style: 'margin-top:10px', onclick: () => telaLogin('email', email)}, 'Usar outro e-mail')));
    campo.focus();
  }
}
async function sair() {
  await desativarPush().catch(() => {});
  await sb.auth.signOut();
}
async function excluirConta() {
  if (!confirm('Excluir sua conta apaga todos os seus alertas, anúncios acompanhados e avisos. Não dá para desfazer. Continuar?')) return;
  if (prompt('Para confirmar, digite EXCLUIR') !== 'EXCLUIR') return;
  await agir(async () => {
    await desativarPush().catch(() => {});
    await q(sb.rpc('excluir_minha_conta'));
    await sb.auth.signOut();
  }, 'Conta excluída.');
}

// ---------- desenho ----------
const ABAS = [['inicio', 'Início', 'home'], ['buscas', 'Buscas', 'search'], ['acompanhando', 'Acompanhando', 'eye'], ['ajustes', 'Ajustes', 'sliders']];
const ultimaVerif = () => Object.values(S.results).map(r => r.verificado_em).sort().pop();
const textoStatus = () => carregado ? (ultimaVerif() ? `Atualizado ${ago(ultimaVerif())}` : 'Aguardando a primeira busca') : '';

function desenhar() {
  if (!usuario) return;
  $('#abas').hidden = false; $('#btn-rodar').hidden = false;
  const totalNovos = Object.values(tudoNovo()).reduce((n, l) => n + l.length, 0);
  const nEv = eventosValidos().filter(e => !evVisto(e)).length;
  $('#abas').replaceChildren(...ABAS.map(([id, nome, icone]) => h('button', {class: 'aba' + (tab === id ? ' ativa' : ''), onclick: () => { location.hash = id; }},
    ic(icone, 22), nome, id === 'buscas' && totalNovos > 0 && h('span', {class: 'pt'}, totalNovos > 99 ? '99+' : totalNovos),
    id === 'inicio' && nEv > 0 && h('span', {class: 'pt'}, nEv > 99 ? '99+' : nEv))));
  const main = $('#conteudo');
  if (!carregado) main.replaceChildren(h('div', {class: 'esq'}), h('div', {class: 'esq'}));
  else {
    const y = window.scrollY;
    main.replaceChildren({inicio: telaInicio, buscas: telaBuscas, acompanhando: telaAcomp, ajustes: telaAjustes}[tab]());
    window.scrollTo(0, y);
  }
  $('#status').textContent = textoStatus();
}

function rota() {
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
  if (usuario && !document.hidden && Date.now() - ultimoLoad > 60_000) carregar(true);
});
setInterval(() => { if (usuario && !document.hidden) $('#status').textContent = textoStatus(); }, 60_000);

if ('serviceWorker' in navigator) {
  if (location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  else navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
}

sb.auth.onAuthStateChange((evento, sessao) => {
  const novo = sessao?.user || null;
  if (novo && novo.id === usuario?.id) { usuario = novo; return; }   // só renovação do token
  usuario = novo;
  carregado = false;
  if (!usuario) { if (canal) sb.removeChannel(canal); canal = null; telaLogin(); return; }
  if (location.hash.includes('access_token')) history.replaceState(null, '', location.pathname);
  tab = ABAS.some(a => a[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'inicio';
  desenhar();
  setTimeout(async () => { await carregar(); ouvirMudancas(); }, 0);
});
