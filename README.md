# Alertas Enjoei

Monitora o Enjoei e avisa de: **anúncios novos**, **queda de preço / preço-alvo**, **vendido** e **removido**.
Funciona sem computador ligado (GitHub Actions + GitHub Pages) e instala como app no celular (PWA).

```
docs/            o app (GitHub Pages) + docs/data/*.json (os dados)
enjoei_alert.py  motor: busca, compara, grava os dados
notify.py        e-mail (Outlook/Hotmail)
server.py        opcional: modo local no seu PC (python server.py)
.github/workflows/enjoei.yml   roda todo dia 8h e quando você edita algo
```

## Publicar (uma vez)

1. Crie um repositório no GitHub e envie estes arquivos.
   - **Privacidade:** GitHub Pages grátis exige repositório **público**. Seus alertas e anúncios
     acompanhados ficam visíveis a quem tiver o link do repositório. Sua senha e e-mail **não**
     ficam no repositório (ficam em *Secrets*).
2. **Settings → Pages**: Source = *Deploy from a branch*, branch `main`, pasta `/docs`.
   O endereço será `https://SEU-USUARIO.github.io/NOME-DO-REPO/`.
3. **Settings → Actions → General → Workflow permissions**: *Read and write permissions*.

## E-mail pelo Outlook (uma vez)

1. Conta Microsoft → Segurança → ative a **verificação em duas etapas** e crie uma **senha de app**.
2. No repositório, **Settings → Secrets and variables → Actions → Secrets**:
   - `SMTP_USER` = seu e-mail Outlook/Hotmail
   - `SMTP_PASSWORD` = a senha de app (não a senha normal)
   - `EMAIL_TO` = (opcional) outro destinatário
3. (Opcional) **Variables → `APP_URL`** = endereço do app, para o botão “Abrir o app” no e-mail.
4. Teste: Actions → *Verificar Enjoei* → *Run workflow*. Só chega e-mail se houver novidade.

## Usar pelo celular / editar fora de casa

Abra o endereço do Pages no celular e vá em **Ajustes → Conexão**. Para criar/editar alertas
é preciso um token do GitHub (só neste aparelho):

- GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate.
- *Only select repositories* → o repositório do app. *Repository permissions → Contents: Read and write*.

Depois: Android (Chrome) menu ⋮ → **Instalar app**; iPhone (Safari) Compartilhar → **Adicionar à Tela de Início**.

## Como funciona

- O GitHub roda `enjoei_alert.py` todo dia às 8h (Brasília) e sempre que você edita algo pelo app.
- Cada rodada grava `docs/data/results.json`; o app lê e mostra, sempre do menor para o maior preço.
- Alertas de preço: defina um **preço-alvo** em *Acompanhando*. Avisa uma vez ao chegar nele.
- Vendido = estado `sold` do Enjoei; removido = anúncio não existe mais (HTTP 404).
- O Enjoei não tem API pública: o `QUERY_ID` em `enjoei_alert.py` é copiado do site e pode mudar.
  Se as buscas passarem a dar erro, pegue o novo valor em DevTools → Network (`graphql-search-x`).
- O GitHub pausa agendamentos de repositórios sem atividade por 60 dias; as atualizações diárias
  de dados contam como atividade, mas confira se o alerta parar de chegar.

## Modo local (opcional)

```bash
python server.py
```
Abra `http://127.0.0.1:8765`. Edita os mesmos arquivos em `docs/data/`; depois é só enviar ao GitHub.
