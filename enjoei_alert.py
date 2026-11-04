"""Alerta de anúncios do Enjoei.

Tudo fica em docs/data/ (JSON). Quem escreve cada arquivo:
  você (pelo app)   alerts.json     buscas monitoradas
                    watch.json      anúncios acompanhados (id, preço-alvo)
                    discarded.json  anúncios descartados
                    run.json        pedido de "verificar agora"
  este script       seen.json       histórico de anúncios já vistos por alerta
                    watchstate.json preço, histórico e situação dos acompanhados
                    results.json    resultado da última verificação + eventos

Uso:  python enjoei_alert.py [--simulate-new N] [--no-email] [--test-email]
"""
import hashlib
import html
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = Path(__file__).parent
DATA = BASE / "docs" / "data"
API_URL = "https://enjusearch.enjoei.com.br/graphql-search-x"
PRODUCT_URL = "https://pages.enjoei.com.br/products/{}/v2.json"
SITE = "https://www.enjoei.com.br"

# ID da consulta persistida usada pelo site (operação searchProducts).
# Pode mudar quando o Enjoei atualizar o site: se o script passar a dar erro,
# pegue o novo valor em DevTools > Network (requisição "graphql-search-x").
QUERY_ID = "c5faa5f85fb47bf0beaa97b67d8a9189"
PAGE = 50            # o servidor limita a 50 por página
MAX_PAGES = 6        # até 300 anúncios por busca
LOOKBACK_DAYS = 2    # janela de "publicados recentemente"
KEEP_SEEN = 1000
KEEP_EVENTS = 60
KEEP_HISTORY = 365
SOLD = {"sold"}      # estados do Enjoei tratados como "vendido"
BRT = timezone(timedelta(hours=-3))


# ---------- arquivos ----------
def load(name, default):
    f = DATA / name
    return json.loads(f.read_text(encoding="utf-8-sig")) if f.exists() else default


def save(name, data):
    DATA.mkdir(parents=True, exist_ok=True)
    (DATA / name).write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")


def now_iso():
    return datetime.now(BRT).isoformat(timespec="seconds")


# ---------- rede ----------
def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Origin": SITE})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def fix_text(s):
    """Corrige textos UTF-8 lidos como Latin-1 ('galÃ¡pagos') e entidades HTML."""
    s = html.unescape(s or "")
    if "Ã" in s or "Â" in s:
        try:
            s = s.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
    return s


def slim(node):
    size = node.get("size") or {}
    return {
        "id": str(node["id"]),
        "path": node["path"],
        "title": fix_text(node["title"]["name"]),
        "brand": fix_text((node.get("brand") or {}).get("displayable_name")),
        "price": (node.get("price") or {}).get("current"),
        "size": (size.get("names") or [""])[0] or size.get("name") or "",
        "photo": (node.get("photo") or {}).get("image_public_id") or "",
    }


# ---------- busca ----------
def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def alert_sig(a):
    campos = [a.get(k) for k in ("item", "marca", "cor", "tamanho", "preco_min", "preco_max")]
    return hashlib.md5(json.dumps(campos).encode()).hexdigest()[:12]


def matches(alert, p):
    """A busca do Enjoei é ampla; exigimos TODAS as palavras de item/marca/cor no título/marca
    (sem acento/maiúsculas) e, se houver, o tamanho (vários: "M, G" ou "38/39")."""
    texto = norm(p["title"] + " " + p["brand"])
    palavras = norm(" ".join(x for x in [alert.get("item"), alert.get("marca"), alert.get("cor")] if x)).split()
    if not all(w in texto for w in palavras):
        return False
    quer = {t.strip() for t in re.split(r"[,/;]", norm(alert.get("tamanho"))) if t.strip()}
    return not quer or norm(p.get("size")) in quer


def fetch_all(params):
    items = []
    for _ in range(MAX_PAGES):
        data = get_json(API_URL + "?" + urllib.parse.urlencode(params))
        if data.get("errors"):
            raise RuntimeError(data["errors"])
        edges = data["data"]["search"]["products"]["edges"]
        items += [slim(e["node"]) for e in edges]
        if len(edges) < PAGE:
            break
        params["after"] = edges[-1]["cursor"]
    return items


def price_key(p):
    return (p["price"] is None, p["price"] or 0)


def search(alert):
    term = " ".join(x for x in [alert.get("item"), alert.get("marca"), alert.get("cor")] if x)
    since = datetime.now(BRT) - timedelta(days=LOOKBACK_DAYS)
    params = {"operation_name": "searchProducts", "query_id": QUERY_ID,
              "search_context": "products_search_default", "term": term, "first": PAGE}
    if alert.get("preco_min") is not None:
        params["price_min"] = alert["preco_min"]
    if alert.get("preco_max") is not None:
        params["price_max"] = alert["preco_max"]
    # 1) publicados nos últimos dias (garante achar os novos em buscas amplas)
    # 2) lista geral por relevância (mostra também os que já existiam)
    recent = fetch_all({**params, "last_published_at": since.strftime("%Y-%m-%dT%H:%M:%S-03:00")})
    geral = fetch_all(dict(params))
    vistos, items = set(), []
    for p in recent + geral:
        if p["id"] not in vistos and matches(alert, p):
            vistos.add(p["id"])
            items.append(p)
    return sorted(items, key=price_key)


# ---------- anúncios acompanhados ----------
def product_info(pid):
    """Preço e situação atuais. HTTP 404/410 = anúncio removido."""
    j = get_json(PRODUCT_URL.format(pid))
    fp = j.get("fallback_pricing") or {}
    url = j.get("canonical_url") or ""
    return {"price": (fp.get("price") or {}).get("listed"), "state": fp.get("state") or "published",
            "title": fix_text(j.get("title")), "photo": (j.get("photos") or [""])[0],
            "path": url.rsplit("/p/", 1)[-1] if "/p/" in url else ""}


def refresh_watch(watch, wstate, previous_events):
    """Atualiza watchstate e devolve a lista de eventos novos."""
    events = []
    ts = now_iso()
    ids = {w["id"] for w in watch}
    for stale in [k for k in wstate if k not in ids]:
        del wstate[stale]
    for w in watch:
        s = wstate.setdefault(w["id"], {"history": [], "first_price": None, "price": None, "state": None,
                                         "alvo_notificado": False})
        s["path"] = s.get("path") or w.get("path") or ""
        s["title"] = s.get("title") or w.get("title") or ""
        s["photo"] = s.get("photo") or w.get("photo") or ""
        try:
            info = product_info(w["id"])
        except urllib.error.HTTPError as e:
            info = {"state": "removido"} if e.code in (404, 410) else None
            if info is None:
                s["erro"] = f"HTTP {e.code}"
                continue
        except Exception as e:
            s["erro"] = str(e)[:120]
            continue
        s["erro"] = None
        s["checked"] = ts
        antes_estado, antes_preco = s.get("state"), s.get("price")
        for k in ("title", "photo", "path"):
            if info.get(k):
                s[k] = info[k]
        novo_estado = info["state"]
        base = {"id": w["id"], "titulo": s["title"], "path": s["path"], "photo": s["photo"], "quando": ts}

        # situação: vendido / removido
        if novo_estado != antes_estado:
            if antes_estado is not None and antes_estado not in SOLD | {"removido"}:
                if novo_estado in SOLD:
                    events.append({**base, "tipo": "vendido", "detalhe": "O anúncio foi vendido."})
                elif novo_estado == "removido":
                    events.append({**base, "tipo": "removido", "detalhe": "O anúncio foi removido."})
            s["state"] = novo_estado
        if novo_estado == "removido":
            continue

        # preço
        preco = info.get("price")
        if preco is not None:
            if s["first_price"] is None:
                s["first_price"] = preco
            s["prev_price"] = antes_preco if antes_preco is not None else preco
            if antes_preco is None or preco != antes_preco:
                s["history"].append([ts, preco])
                s["history"] = s["history"][-KEEP_HISTORY:]
                if antes_preco is not None and novo_estado == "published":
                    tipo = "queda" if preco < antes_preco else "alta"
                    events.append({**base, "tipo": tipo,
                                   "detalhe": f"Preço de R$ {antes_preco:g} para R$ {preco:g}."})
            s["price"] = preco
            # preço-alvo: avisa uma vez ao chegar nele e rearma se o preço subir de novo
            alvo = w.get("alvo")
            if alvo is not None and novo_estado == "published":
                if preco <= alvo and not s["alvo_notificado"]:
                    s["alvo_notificado"] = True
                    events.append({**base, "tipo": "alvo", "detalhe": f"Chegou a R$ {preco:g} (alvo: R$ {alvo:g})."})
                elif preco > alvo:
                    s["alvo_notificado"] = False
    return events


# ---------- verificação ----------
def check(simulate=0, send=True):
    alerts = load("alerts.json", [])
    discarded = {d["id"] for d in load("discarded.json", [])}
    seen = load("seen.json", {})
    watch = load("watch.json", [])
    wstate = load("watchstate.json", {})
    antes = load("results.json", {})
    results = {"atualizado": now_iso(), "alertas": {}, "erros": {}, "eventos": []}
    novos_por_alerta = {}

    for a in alerts:
        if a.get("ativo", True) is False:
            continue
        key, sig = a["nome"], alert_sig(a)
        try:
            items = [p for p in search(a) if p["id"] not in discarded]
        except Exception as e:
            results["erros"][key] = str(e)[:200]
            print(f"[{key}] ERRO: {e}")
            continue
        ids = [p["id"] for p in items]
        entrada = seen.get(key)
        if isinstance(entrada, list):               # formato antigo
            entrada = {"sig": sig, "ids": entrada}
        first_run = entrada is None or entrada.get("sig") != sig
        known = set() if first_run else set(entrada["ids"])
        new_ids = set() if first_run else {i for i in ids if i not in known}
        new_ids |= set(ids[:simulate])
        print(f"[{key}] {len(ids)} anúncios, {len(new_ids)} novos" + (" (primeira execução)" if first_run else ""))
        results["alertas"][key] = {"items": items, "new_ids": sorted(new_ids), "primeira_execucao": first_run}
        if new_ids and not first_run:
            novos_por_alerta[key] = [p for p in items if p["id"] in new_ids]
        seen[key] = {"sig": sig, "ids": list(dict.fromkeys(ids + list(known)))[:KEEP_SEEN]}
    for k in [k for k in seen if k not in {a["nome"] for a in alerts}]:
        del seen[k]

    eventos = refresh_watch(watch, wstate, antes.get("eventos", []))
    for key, lst in novos_por_alerta.items():
        for p in lst:
            eventos.append({"id": p["id"], "tipo": "novo", "titulo": p["title"], "path": p["path"],
                            "photo": p["photo"], "quando": results["atualizado"],
                            "detalhe": f"Novo em “{key}”: R$ {p['price']:g}" if p["price"] is not None else f"Novo em “{key}”"})
    results["eventos"] = (eventos + antes.get("eventos", []))[:KEEP_EVENTS]

    save("seen.json", seen)
    save("watchstate.json", wstate)
    save("results.json", results)

    if send and (novos_por_alerta or [e for e in eventos if e["tipo"] in ("queda", "alvo", "vendido", "removido")]):
        import notify
        notify.send_digest(novos_por_alerta, eventos)
    return results


if __name__ == "__main__":
    if "--test-email" in sys.argv:
        import notify
        notify.send_test()
        sys.exit()
    n = int(sys.argv[sys.argv.index("--simulate-new") + 1]) if "--simulate-new" in sys.argv else 0
    check(n, send="--no-email" not in sys.argv)
