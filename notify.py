"""Envio do resumo por e-mail (Outlook/Hotmail por padrão).

Variáveis de ambiente (no GitHub: Settings > Secrets and variables > Actions):
  SMTP_USER      seu e-mail Outlook/Hotmail (remetente)
  SMTP_PASSWORD  senha de app da conta Microsoft (NÃO a senha normal)
  EMAIL_TO       destinatário (opcional; padrão = SMTP_USER)
  SMTP_HOST      opcional, padrão smtp-mail.outlook.com
  SMTP_PORT      opcional, padrão 587
  APP_URL        opcional, link do app para o botão do e-mail
"""
import html
import os
import smtplib
from email.message import EmailMessage

SITE = "https://www.enjoei.com.br"
ROSA = "#e6007e"


def configured():
    return bool(os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASSWORD"))


def brl(v):
    return "—" if v is None else "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".").replace(",00", "")


def photo(pid):
    return f"https://photos.enjoei.com.br/public/300x300/{pid}" if pid else ""


def e(s):
    return html.escape(str(s or ""))


def row(titulo, linha2, path, pid, destaque=""):
    return (f'<tr><td style="padding:10px 0;border-bottom:1px solid #eee;width:76px">'
            f'<a href="{SITE}/p/{e(path)}"><img src="{photo(pid)}" width="68" height="68" '
            f'style="border-radius:8px;object-fit:cover;display:block" alt=""></a></td>'
            f'<td style="padding:10px 0 10px 10px;border-bottom:1px solid #eee;font:14px/1.35 Arial,sans-serif">'
            f'<a href="{SITE}/p/{e(path)}" style="color:#222;text-decoration:none"><b>{e(titulo)}</b></a><br>'
            f'<span style="color:#666">{linha2}</span>{destaque}</td></tr>')


def build(novos_por_alerta, eventos):
    """Devolve (assunto, texto, html)."""
    por_tipo = {t: [x for x in eventos if x["tipo"] == t] for t in ("alvo", "queda", "vendido", "removido")}
    partes, texto = [], []
    n_novos = sum(len(v) for v in novos_por_alerta.values())

    def secao(titulo, linhas):
        partes.append(f'<h2 style="font:700 16px Arial,sans-serif;margin:26px 0 4px;color:{ROSA}">{e(titulo)}</h2>'
                      f'<table width="100%" cellspacing="0" cellpadding="0">{"".join(linhas)}</table>')

    for tipo, titulo, cor in (("alvo", "🎯 Chegou no preço que você queria", "#118a3e"),
                              ("queda", "↓ Preço caiu", "#118a3e"),
                              ("vendido", "Vendido", "#555"), ("removido", "Removido", "#555")):
        evs = por_tipo[tipo]
        if evs:
            secao(titulo, [row(x["titulo"], e(x["detalhe"]), x["path"], x["photo"]) for x in evs])
            texto += [titulo] + [f"- {x['titulo']}: {x['detalhe']}  {SITE}/p/{x['path']}" for x in evs] + [""]
    for alerta, itens in novos_por_alerta.items():
        itens = sorted(itens, key=lambda p: (p["price"] is None, p["price"] or 0))
        secao(f"Novos em “{alerta}” ({len(itens)})",
              [row(p["title"], " · ".join(x for x in [e(p["brand"]), e(("tam. " + p["size"]) if p["size"] else "")] if x),
                   p["path"], p["photo"],
                   f'<br><b style="font-size:16px;color:#222">{brl(p["price"])}</b>') for p in itens])
        texto += [f"Novos em “{alerta}”"] + [f"- {p['title']} | {brl(p['price'])}  {SITE}/p/{p['path']}" for p in itens] + [""]

    resumo = []
    if n_novos:
        resumo.append(f"{n_novos} novo{'s' if n_novos > 1 else ''}")
    for tipo, nome in (("alvo", "no preço-alvo"), ("queda", "queda de preço"), ("vendido", "vendido"), ("removido", "removido")):
        if por_tipo[tipo]:
            resumo.append(f"{len(por_tipo[tipo])} {nome}")
    assunto = "Enjoei: " + ", ".join(resumo)
    app = os.environ.get("APP_URL")
    botao = (f'<p style="margin:24px 0 0"><a href="{e(app)}" style="background:{ROSA};color:#fff;text-decoration:none;'
             f'padding:10px 18px;border-radius:8px;font:700 14px Arial,sans-serif">Abrir o app</a></p>') if app else ""
    corpo = (f'<div style="max-width:560px;margin:auto;padding:16px;background:#fff">'
             f'<div style="font:700 20px Arial,sans-serif">Alertas Enjoei</div>'
             f'<div style="font:13px Arial,sans-serif;color:#666">{e(assunto[7:])}</div>{"".join(partes)}{botao}</div>')
    return assunto, "\n".join(texto), corpo


def send(assunto, texto, corpo):
    user = os.environ["SMTP_USER"]
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"] = assunto, user, os.environ.get("EMAIL_TO") or user
    msg.set_content(texto or assunto)
    msg.add_alternative(corpo, subtype="html")
    with smtplib.SMTP(os.environ.get("SMTP_HOST", "smtp-mail.outlook.com"), int(os.environ.get("SMTP_PORT", 587)),
                      timeout=30) as s:
        s.starttls()
        s.login(user, os.environ["SMTP_PASSWORD"])
        s.send_message(msg)


def send_digest(novos_por_alerta, eventos):
    if not configured():
        print("E-mail não configurado (SMTP_USER/SMTP_PASSWORD): pulando envio.")
        return
    assunto, texto, corpo = build(novos_por_alerta, eventos)
    try:
        send(assunto, texto, corpo)
        print("E-mail enviado:", assunto)
    except Exception as ex:  # não derruba a verificação
        print("Falha ao enviar e-mail:", ex)


def send_test():
    if not configured():
        raise SystemExit("Defina SMTP_USER e SMTP_PASSWORD.")
    send("Enjoei: teste de e-mail", "Funcionou! Os alertas vão chegar aqui.",
         "<p style='font:16px Arial'>Funcionou! Os alertas do Enjoei vão chegar neste e-mail.</p>")
    print("E-mail de teste enviado.")
