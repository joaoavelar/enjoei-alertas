"""Robô multiusuário: busca no Enjoei para todas as contas, grava no Supabase e envia os avisos.

Roda no GitHub Actions a cada 15 minutos (.github/workflows/robo.yml). Cada alerta é verificado
a cada INTERVALO_H horas, ou antes se a pessoa pedir pelo app (botão de atualizar) ou se o
alerta for criado/editado. Buscas iguais de pessoas diferentes viram uma consulta só.

Variáveis de ambiente:
  SUPABASE_URL          (padrão: o projeto do app)
  SUPABASE_SECRET_KEY   chave secreta do Supabase (secret do GitHub) — obrigatória
  VAPID_PRIVATE_KEY     chave privada das notificações push (secret)
  BREVO_API_KEY         chave do Brevo para e-mail (secret, opcional)
  EMAIL_FROM            remetente verificado no Brevo (secret, opcional)
  EMAIL_FROM_NAME       nome do remetente (opcional)
  APP_URL               endereço do app (para os links)
"""
import html
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

import enjoei_alert as motor

SUPABASE_URL = os.environ.get("SUPABASE_URL") or "https://rfhaghhpvpafuvjfnuju.supabase.co"
APP_URL = os.environ.get("APP_URL") or "https://joaoavelar.github.io/enjoei-alertas/"
INTERVALO_H = 3            # verificação automática de cada alerta / anúncio acompanhado
PEDIDO_MIN = 5             # intervalo mínimo entre verificações pedidas pelo app
KEEP_EVENTOS_DIAS = 60
KEEP_VISTOS_DIAS = 120


# ---------- acesso ao Supabase (REST) ----------
class Banco:
    def __init__(self, url, chave):
        self.base = url.rstrip("/") + "/rest/v1/"
        self.h = {"apikey": chave, "Content-Type": "application/json"}
        if not chave.startswith("sb_secret_"):          # chave antiga (JWT) também vai no Authorization
            self.h["Authorization"] = f"Bearer {chave}"

    def _req(self, metodo, caminho, params=None, corpo=None, prefer=None):
        url = self.base + caminho + ("?" + urllib.parse.urlencode(params) if params else "")
        h = dict(self.h)
        if prefer:
            h["Prefer"] = prefer
        dados = None if corpo is None else json.dumps(corpo, ensure_ascii=False).encode()
        req = urllib.request.Request(url, data=dados, headers=h, method=metodo)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                txt = r.read().decode() or "null"
                return json.loads(txt)
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"Supabase {metodo} {caminho}: HTTP {e.code} {e.read().decode()[:300]}") from None

    def get(self, tabela, **params):
        params.setdefault("select", "*")
        return self._req("GET", tabela, params) or []

    def post(self, tabela, linhas, conflito=None):
        if not linhas:
            return
        params = {"on_conflict": conflito} if conflito else None
        pref = "return=minimal" + (",resolution=merge-duplicates" if conflito else "")
        for i in range(0, len(linhas), 500):
            self._req("POST", tabela, params, linhas[i:i + 500], pref)

    def patch(self, tabela, filtros, dados):
        self._req("PATCH", tabela, filtros, dados, "return=minimal")

    def delete(self, tabela, filtros):
        self._req("DELETE", tabela, filtros, None, "return=minimal")

    def rpc(self, nome, args=None):
        return self._req("POST", "rpc/" + nome, None, args or {})


def iso(dt):
    return dt.isoformat(timespec="seconds")


def quando(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def lista_in(valores):
    return "in.(" + ",".join(f'"{v}"' for v in valores) + ")"


# ---------- buscas ----------
def chave_busca(a):
    """Alertas com o mesmo termo e faixa de preço fazem uma só consulta ao Enjoei."""
    p = motor.busca_params(a)
    return (p["term"], p.get("price_min"), p.get("price_max"))


def precisa_verificar(alerta, res, pedido, agora):
    if res is None or res.get("sig") != motor.alert_sig(alerta):
        return True
    ver = quando(res["verificado_em"])
    if agora - ver >= timedelta(hours=INTERVALO_H):
        return True
    p = quando(pedido)
    return bool(p and p > ver and agora - ver >= timedelta(minutes=PEDIDO_MIN))


def buscar_grupo(alerta, idades, agora):
    """Faz a consulta do grupo e devolve os anúncios brutos (com idade estimada)."""
    params = motor.busca_params(alerta)
    recent = motor.fetch_all({**params, "last_published_at": motor.desde(motor.LOOKBACK_DAYS)})
    ids_rec = {p["id"] for p in recent}
    vistos, brutos = set(), []
    for p in recent + motor.fetch_all(dict(params)):
        if p["id"] not in vistos:
            vistos.add(p["id"])
            p["_recente"] = p["id"] in ids_rec
            brutos.append(p)
    return brutos


def verificar_alertas(db, agora, settings, idades, eventos):
    alertas = db.get("alerts", ativo="eq.true")
    resultados = {r["alert_id"]: r for r in db.get("alert_results", select="alert_id,sig,seen_ids,verificado_em")}
    desc = defaultdict(set)
    for d in db.get("discarded", select="user_id,product_id"):
        desc[d["user_id"]].add(d["product_id"])
    devidos = [a for a in alertas if precisa_verificar(a, resultados.get(a["id"]),
                                                     (settings.get(a["user_id"]) or {}).get("pedido_verificacao"), agora)]
    grupos = defaultdict(list)
    for a in devidos:
        grupos[chave_busca(a)].append(a)
    print(f"alertas: {len(alertas)} ativos, {len(devidos)} para verificar em {len(grupos)} consultas")

    linhas, falhas = [], []
    for grupo in grupos.values():
        try:
            brutos = buscar_grupo(grupo[0], idades, agora)
            casados = [p for p in brutos if any(motor.matches(a, p) for a in grupo)]
            motor.aplicar_idades(grupo[0], casados, idades, agora)
        except Exception as e:
            print(f"ERRO na busca '{grupo[0]['nome']}': {e}")
            # só registra o erro: mantém os anúncios da última busca que deu certo
            falhas += [{"alert_id": a["id"], "user_id": a["user_id"], "erro": str(e)[:200], "verificado_em": iso(agora)} for a in grupo]
            continue
        for a in grupo:
            itens = sorted((p for p in casados if motor.matches(a, p) and p["id"] not in desc[a["user_id"]]), key=motor.price_key)
            ids = [p["id"] for p in itens]
            sig, ant = motor.alert_sig(a), resultados.get(a["id"])
            primeira = ant is None or ant.get("sig") != sig
            conhecidos = set() if primeira else set(ant.get("seen_ids") or [])
            novos = [] if primeira else [i for i in ids if i not in conhecidos]
            linhas.append({"alert_id": a["id"], "user_id": a["user_id"], "items": itens, "new_ids": novos,
                           "primeira_execucao": primeira, "erro": None, "sig": sig,
                           "seen_ids": list(dict.fromkeys(ids + list(conhecidos)))[:motor.KEEP_SEEN],
                           "verificado_em": iso(agora)})
            for p in itens:
                if p["id"] in novos:
                    eventos.append({"user_id": a["user_id"], "tipo": "novo", "product_id": p["id"], "titulo": p["title"],
                                    "path": p["path"], "photo": p["photo"], "quando": iso(agora),
                                    "detalhe": f"Novo em “{a['nome']}”" + (f": {motor_brl(p['price'])}" if p["price"] is not None else "")})
            print(f"  [{a['nome']}] {len(itens)} anúncios, {len(novos)} novos" + (" (primeira busca)" if primeira else ""))
    db.post("alert_results", linhas, conflito="alert_id")
    db.post("alert_results", falhas, conflito="alert_id")   # lote separado: chaves diferentes


def motor_brl(v):
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".").replace(",00", "")


# ---------- anúncios acompanhados ----------
def novo_estado(est, info, alvo, ts):
    """Mesma lógica do app de um usuário: devolve (estado, [(tipo, detalhe)])."""
    s = dict(est or {})
    s.setdefault("history", [])
    s.setdefault("first_price", None)
    s.setdefault("alvo_notificado", False)
    evs = []
    s["checked"] = ts
    if info is None:
        return s, evs
    for k in ("title", "photo", "path"):
        if info.get(k):
            s[k] = info[k]
    antes_estado, antes_preco, estado = s.get("state"), s.get("price"), info["state"]
    if estado != antes_estado:
        if antes_estado is not None and antes_estado not in motor.SOLD | {"removido"}:
            if estado in motor.SOLD:
                evs.append(("vendido", "O anúncio foi vendido."))
            elif estado == "removido":
                evs.append(("removido", "O anúncio foi removido."))
        s["state"] = estado
    if estado == "removido":
        return s, evs
    preco = info.get("price")
    if preco is not None:
        if s["first_price"] is None:
            s["first_price"] = preco
        s["prev_price"] = antes_preco if antes_preco is not None else preco
        if antes_preco is None or preco != antes_preco:
            s["history"] = (s["history"] + [[ts, preco]])[-motor.KEEP_HISTORY:]
            if antes_preco is not None and estado == "published":
                evs.append(("queda" if preco < antes_preco else "alta", f"Preço de {motor_brl(antes_preco)} para {motor_brl(preco)}."))
        s["price"] = preco
        if alvo is not None and estado == "published":
            if preco <= float(alvo) and not s["alvo_notificado"]:
                s["alvo_notificado"] = True
                evs.append(("alvo", f"Chegou a {motor_brl(preco)} (alvo: {motor_brl(float(alvo))})."))
            elif preco > float(alvo):
                s["alvo_notificado"] = False
    return s, evs


def verificar_acompanhados(db, agora, settings, eventos):
    linhas = db.get("watch", select="user_id,product_id,alvo,estado,path,title,photo")
    def devido(w):
        chk = quando((w.get("estado") or {}).get("checked"))
        if chk is None or agora - chk >= timedelta(hours=INTERVALO_H):
            return True
        p = quando((settings.get(w["user_id"]) or {}).get("pedido_verificacao"))
        return bool(p and p > chk and agora - chk >= timedelta(minutes=PEDIDO_MIN))
    devidos = [w for w in linhas if devido(w)]
    infos = {}
    for pid in {w["product_id"] for w in devidos}:
        try:
            infos[pid] = motor.product_info(pid)
        except urllib.error.HTTPError as e:
            infos[pid] = {"state": "removido"} if e.code in (404, 410) else None
        except Exception:
            infos[pid] = None
    print(f"acompanhados: {len(linhas)} no total, {len(devidos)} verificados ({len(infos)} anúncios distintos)")
    ts = iso(agora)
    for w in devidos:
        est, evs = novo_estado(w.get("estado"), infos.get(w["product_id"]), w.get("alvo"), ts)
        if infos.get(w["product_id"]) is None:
            est["erro"] = "falha ao consultar"
        else:
            est.pop("erro", None)
        db.patch("watch", {"user_id": f"eq.{w['user_id']}", "product_id": f"eq.{w['product_id']}"}, {"estado": est})
        for tipo, detalhe in evs:
            eventos.append({"user_id": w["user_id"], "tipo": tipo, "product_id": w["product_id"],
                            "titulo": est.get("title") or w.get("title"), "path": est.get("path") or w.get("path"),
                            "photo": est.get("photo") or w.get("photo"), "detalhe": detalhe, "quando": ts})


# ---------- avisos ----------
NOMES = {"novo": ("novo", "novos"), "queda": ("queda de preço", "quedas de preço"), "alvo": ("no preço-alvo", "no preço-alvo"),
         "vendido": ("vendido", "vendidos"), "removido": ("removido", "removidos"), "alta": ("preço subiu", "preços subiram")}


def resumo(evs):
    cont = defaultdict(int)
    for e in evs:
        cont[e["tipo"]] += 1
    partes = [f"{n} {NOMES[t][0 if n == 1 else 1]}" for t in ("novo", "alvo", "queda", "vendido", "removido", "alta") if (n := cont[t])]
    return "Enjoei: " + ", ".join(partes)


def enviar_push(db, subs, evs):
    chave = os.environ.get("VAPID_PRIVATE_KEY")
    if not chave or not subs:
        return 0
    from pywebpush import WebPushException, webpush
    corpo = "; ".join(e["titulo"] or "" for e in evs[:3]) + ("…" if len(evs) > 3 else "")
    dados = json.dumps({"title": resumo(evs), "body": corpo, "url": APP_URL + "#inicio", "tag": "enjoei-novidades"}, ensure_ascii=False)
    sub_claim = "mailto:" + os.environ["EMAIL_FROM"] if os.environ.get("EMAIL_FROM") else APP_URL
    enviados = 0
    for s in subs:
        try:
            webpush(subscription_info={"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}},
                    data=dados, vapid_private_key=chave, vapid_claims={"sub": sub_claim}, ttl=86400)
            enviados += 1
        except WebPushException as ex:
            cod = getattr(ex.response, "status_code", None)
            if cod in (404, 410):          # inscrição vencida ou cancelada no aparelho
                db.delete("push_subs", {"id": f"eq.{s['id']}"})
            else:
                print("  push falhou:", cod, str(ex)[:120])
    return enviados


def email_html(evs):
    secoes = []
    for tipo, titulo in (("alvo", "Chegou no preço que você queria"), ("queda", "Preço caiu"), ("novo", "Anúncios novos"),
                         ("vendido", "Vendidos"), ("removido", "Removidos"), ("alta", "Preço subiu")):
        lst = [e for e in evs if e["tipo"] == tipo]
        if not lst:
            continue
        linhas = "".join(
            f'<tr><td style="padding:10px 0;border-bottom:1px solid #eee;width:76px"><a href="https://www.enjoei.com.br/p/{html.escape(e["path"] or "")}">'
            f'<img src="https://photos.enjoei.com.br/public/300x300/{html.escape(e["photo"] or "")}" width="68" height="68" style="border-radius:8px;object-fit:cover;display:block" alt=""></a></td>'
            f'<td style="padding:10px 0 10px 10px;border-bottom:1px solid #eee;font:14px/1.35 Arial,sans-serif">'
            f'<a href="https://www.enjoei.com.br/p/{html.escape(e["path"] or "")}" style="color:#222;text-decoration:none"><b>{html.escape(e["titulo"] or "")}</b></a><br>'
            f'<span style="color:#666">{html.escape(e["detalhe"] or "")}</span></td></tr>' for e in lst)
        secoes.append(f'<h2 style="font:700 16px Arial,sans-serif;margin:24px 0 4px;color:#e6007e">{titulo} ({len(lst)})</h2>'
                      f'<table width="100%" cellspacing="0" cellpadding="0">{linhas}</table>')
    return (f'<div style="max-width:560px;margin:auto;padding:16px;background:#fff">'
            f'<div style="font:700 20px Arial,sans-serif">Alertas Enjoei</div>{"".join(secoes)}'
            f'<p style="margin:24px 0 0"><a href="{APP_URL}#inicio" style="background:#e6007e;color:#fff;text-decoration:none;'
            f'padding:10px 18px;border-radius:8px;font:700 14px Arial,sans-serif">Abrir o app</a></p>'
            f'<p style="font:12px Arial,sans-serif;color:#888;margin-top:24px">Para parar de receber, desative o e-mail em Ajustes no app.</p></div>')


def enviar_email(para, evs):
    chave, remetente = os.environ.get("BREVO_API_KEY"), os.environ.get("EMAIL_FROM")
    if not chave or not remetente:
        return False
    texto = "\n".join(f"- {e['titulo']}: {e['detalhe']}  https://www.enjoei.com.br/p/{e['path']}" for e in evs)
    corpo = {"sender": {"email": remetente, "name": os.environ.get("EMAIL_FROM_NAME") or "Alertas Enjoei"},
             "to": [{"email": para}], "subject": resumo(evs), "htmlContent": email_html(evs), "textContent": texto + f"\n\n{APP_URL}"}
    req = urllib.request.Request("https://api.brevo.com/v3/smtp/email", data=json.dumps(corpo).encode(),
                                 headers={"api-key": chave, "Content-Type": "application/json", "Accept": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30):
            return True
    except urllib.error.HTTPError as e:
        print("  e-mail falhou:", e.code, e.read().decode()[:200])
        return False


def avisar(db, agora, settings):
    pend = db.get("events", notificado="eq.false", quando=f"gte.{iso(agora - timedelta(days=2))}",
                  select="id,user_id,tipo,titulo,detalhe,path,photo", order="quando.desc")
    pend = [e for e in pend if e["tipo"] != "alta"] + [e for e in pend if e["tipo"] == "alta"]
    if not pend:
        print("avisos: nada pendente")
        return
    por_user = defaultdict(list)
    for e in pend:
        por_user[e["user_id"]].append(e)
    emails = {r["user_id"]: r["email"] for r in db.rpc("robo_emails")} if os.environ.get("BREVO_API_KEY") else {}
    subs = defaultdict(list)
    for s in db.get("push_subs", user_id=lista_in(por_user), select="id,user_id,endpoint,p256dh,auth"):
        subs[s["user_id"]].append(s)
    for u, evs in por_user.items():
        st = settings.get(u) or {}
        importantes = [e for e in evs if e["tipo"] != "alta"] or evs
        n_push = enviar_push(db, subs[u], importantes) if st.get("avisar_push", True) else 0
        ok_email = enviar_email(emails[u], importantes) if st.get("avisar_email", True) and u in emails else False
        print(f"avisos: usuário {u[:8]}… {len(evs)} novidades → push em {n_push} aparelho(s), e-mail {'enviado' if ok_email else 'não'}")
    for i in range(0, len(pend), 200):
        db.patch("events", {"id": lista_in([e["id"] for e in pend[i:i + 200]])}, {"notificado": True})


# ---------- execução ----------
def main():
    chave = os.environ.get("SUPABASE_SECRET_KEY")
    if not chave:
        print("Aguardando configuração: cadastre o secret SUPABASE_SECRET_KEY no GitHub.")
        return
    db = Banco(SUPABASE_URL, chave)
    agora = datetime.now(motor.BRT)
    settings = {s["user_id"]: s for s in db.get("settings")}
    idades = {r["product_id"]: {"desde": r["desde"], "min": r["min"], "max": r["max"]} for r in db.get("idades")}
    antes_idades = set(idades)
    eventos = []
    verificar_alertas(db, agora, settings, idades, eventos)
    verificar_acompanhados(db, agora, settings, eventos)
    db.post("events", eventos)
    print(f"novidades criadas: {len(eventos)}")
    avisar(db, agora, settings)
    novas = [{"product_id": k, **v} for k, v in idades.items() if k not in antes_idades]
    db.post("idades", novas, conflito="product_id")
    db.delete("events", {"quando": f"lt.{iso(agora - timedelta(days=KEEP_EVENTOS_DIAS))}"})
    db.delete("item_vistos", {"criado_em": f"lt.{iso(agora - timedelta(days=KEEP_VISTOS_DIAS))}"})
    db.delete("idades", {"desde": f"lt.{iso(agora - timedelta(days=180))}"})
    db.post("worker_state", [{"chave": "ultima_execucao", "valor": iso(agora)}], conflito="chave")


if __name__ == "__main__":
    main()
