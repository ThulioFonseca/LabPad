# Homelab Monitor

Dashboard de monitoramento do homelab pensado para rodar num **iPad 2 (iOS 9.3.5)**
como monitor de parede sempre ligado.

Mostra, em tempo quase real, os recursos do **host Ubuntu** e dos **containers
Docker**, além de **agenda**, **notícias** e **clima**. Roda como um único
container e serve uma página feita sob medida para o Safari 9 — sem CSS Grid,
sem `fetch`, sem frameworks, sem build. Bonito, leve e fácil de alterar.

```
┌───────────────────────────────────────────────┐
│ Homelab        ☀ 24°C · 60%       ● online 14:22│
├───────────────────────────────────────────────┤
│ HOST   ubuntu · up 6d · load 0.4 · 8 nucleos    │
│ ┌ CPU ┐ ┌ Memoria ┐ ┌ Disco ┐ ┌ Temp ┐         │
│ ┌ Rede ──────────┐ ┌ Docker ─────────┐         │
│ AGENDA              NOTICIAS                    │
│ Hoje 14:00 Reuniao  ▦ Titulo da noticia 1       │
│ CONTAINERS  (3 / 4 ativos)                      │
│ ● nginx     CPU 0.4%  RAM 28 MB   up            │
│ ● postgres  CPU 2.1%  RAM 310 MB  up            │
└───────────────────────────────────────────────┘
```

## Como subir

No host (onde o Docker roda), primeiro crie o `.env` com suas URLs:

```bash
cp .env.example .env      # depois edite o .env (calendario, RSS, fuso)
```

Em seguida suba o serviço:

```bash
docker compose up -d --build      # Docker moderno
# ou:  docker-compose up -d --build   (versao antiga)
```

Acesse de qualquer aparelho na rede local, **inclusive do iPad 2**:

```
http://IP-DO-HOST:8723
```

Para descobrir o IP do host: `ip addr` (procure algo como `192.168.x.x`).

Parar / atualizar:

```bash
docker compose down
docker compose up -d --build      # apos editar qualquer arquivo
```

> Editou apenas `static/` (HTML/CSS/JS)? Não precisa rebuildar a imagem se você
> montar a pasta como volume — veja "Desenvolvimento" abaixo. Por padrão, os
> estáticos vão para dentro da imagem, então rode `up -d --build` de novo.

## Configurar o iPad como monitor de parede

1. Abra `http://IP-DO-HOST:8723` no Safari.
2. **Compartilhar → Adicionar à Tela de Início** — abre em tela cheia, sem barras.
3. **Ajustes → Tela e Brilho → Bloqueio Automático → Nunca.**
4. (Opcional) **Ajustes → Geral → Acessibilidade → Acesso Guiado** para travar o
   iPad nessa tela (modo quiosque).

## Como funciona

```
Host Ubuntu ── Docker
                └─ container "homelab-monitor"  (Flask + Python)
                     GET /            -> dashboard (static/)
                     GET /api/metrics -> hardware + containers (5 s)
                     GET /api/feeds   -> agenda + noticias + clima (10 min)
```

- O container roda com `pid: host` + `network_mode: host` para o `psutil` ler o
  hardware **real do host** (e não o do container).
- Todos os volumes são **somente leitura** (`:ro`). O container nunca escreve no host.
- O dashboard faz polling de `/api/metrics` a cada 5 s via `XMLHttpRequest`.
- A agenda, as notícias e o clima vêm de `/api/feeds`, atualizado a cada 10 min —
  o backend busca os feeds externos e os mantém em cache (não sobrecarrega os
  provedores).

### Segurança

A dashboard **não tem autenticação** — pensada para uso só na **rede local**.
Não exponha a porta 8723 para a internet. O socket do Docker é montado como
somente leitura, mas ainda assim dá visibilidade dos containers; mantenha na LAN.

## Agenda, notícias e clima

As seções **Agenda**, **Notícias** e **Clima** são configuradas pelo arquivo
`.env` (carregado automaticamente pelo `docker compose`). Veja
[`.env.example`](.env.example).

| Variável           | Para quê serve                                          |
|--------------------|---------------------------------------------------------|
| `TZ`               | Fuso horário (ex.: `America/Sao_Paulo`)                 |
| `CALENDAR_ICS_URL` | URL `.ics` de um calendário Outlook publicado           |
| `CALENDAR_DAYS`    | Quantos dias à frente exibir (padrão `3`)               |
| `NEWS_RSS_URL`     | URL de um feed RSS/Atom                                 |
| `NEWS_LIMIT`       | Quantas notícias exibir (padrão `5`)                    |
| `WEATHER_CITY`     | Cidade do widget de clima (ex.: `Sao Paulo`)            |

**Como obter o link `.ics` do calendário:** no Outlook web, *Configurações →
Calendário → Calendários compartilhados → Publicar calendário* — copie o link
**ICS** (termina em `.ics`), **não** o link HTML.

> A URL do calendário é um *link-capacidade*: quem tiver o link vê sua agenda.
> Por isso ela fica no `.env` (lado servidor) e não no `config.js` da página.
> O `.env` está no `.dockerignore`; não o compartilhe.

Deixar uma URL em branco **desativa** a seção correspondente — a dashboard segue
funcionando normalmente. Eventos recorrentes (reuniões semanais etc.) são
expandidos automaticamente.

O **clima** aparece no centro do cabeçalho e alterna entre temperatura/umidade,
previsão de 5 dias e fase da lua. Os dados vêm da
[Open-Meteo](https://open-meteo.com) (gratuita, sem chave de API); basta
informar `WEATHER_CITY`. Vazio desativa o widget.

## Como expandir (o ponto forte do projeto)

### Adicionar uma métrica nova

1. **Backend** — devolva o valor em `/api/metrics`. Edite o coletor adequado em
   [`backend/collectors/`](backend/collectors/) (ex.: adicione um campo em
   `host.py`) ou crie um coletor novo e encaixe-o em
   [`backend/app.py`](backend/app.py).
2. **Frontend** — abra [`static/config.js`](static/config.js) e adicione **uma
   linha** ao array `widgets`. Pronto: o card aparece. Não se mexe em HTML/CSS/JS.

Exemplo — mostrar contagem de processos:

```js
{ id:'procs', title:'Processos', kind:'info', section:'system',
  path:'host.proc_count', fmt:'text' }
```

### Mudar a aparência

Toda a paleta de cores está em [`static/css/theme.css`](static/css/theme.css).
Edite lá e recarregue. A estrutura/layout fica em `base.css` (normalmente intocado).

### Tipos de widget disponíveis

| `kind`  | Uso                                            |
|---------|------------------------------------------------|
| `gauge` | número + barra 0..max (CPU, RAM, disco, temp)  |
| `info`  | linha de texto (uptime, SO, load average)      |

Cada campo de widget está documentado dentro do próprio `config.js`.

## Estrutura do projeto

```
backend/
  app.py                 servidor Flask: rotas + /api/metrics + /api/feeds
  config.py              porta, caminhos de disco, feeds, TTL de cache
  collectors/
    host.py              CPU, memoria, disco, rede, load, uptime, SO
    sensors.py           temperatura (degrada se indisponivel)
    containers.py        status, CPU%, RAM e rede por container
    calendar_feed.py     agenda: le o .ics do Outlook publicado
    news.py              noticias: le um feed RSS/Atom
    weather.py           clima e fase da lua (Open-Meteo, sem chave)
static/
  index.html             esqueleto da pagina
  config.js          ★   widgets e intervalos — edite aqui
  css/base.css           layout (Flexbox, sem Grid)
  css/theme.css      ★   cores — edite aqui para re-tematizar
  js/xhr.js              requisicoes (XMLHttpRequest, substitui fetch)
  js/format.js           utilitarios de DOM e formatacao
  js/icons.js            icones SVG (cards, clima, lua)
  js/sparkline.js        mini-grafico em <canvas>
  js/widgets.js          componentes: cards, agenda, noticias, clima
  js/dashboard.js        polling + render
.env               ★   URLs do calendario/RSS, cidade do clima e fuso
Dockerfile · docker-compose.yml · requirements.txt
```

## Desenvolvimento / testar fora do Docker

Para rodar direto na máquina (sem container), apontando para a raiz real:

```bash
pip install -r requirements.txt
HOST_ROOT=/ HOST_HOSTNAME_FILE=/etc/hostname python backend/app.py
```

Abra `http://localhost:8723`. Sensores e stats de containers dependem de o
processo ter acesso a `/sys` e ao socket do Docker.

Para iterar no frontend sem rebuildar a imagem, monte `static/` como volume
adicionando ao serviço em `docker-compose.yml`:

```yaml
    volumes:
      - ./static:/app/static:ro
      # ... (mantenha os demais volumes)
```

Os estáticos são servidos com `Cache-Control: no-store`, então basta editar e
recarregar no navegador.

## Compatibilidade

Testado para o alvo **Safari 9 / iOS 9.3.5**: layout só com Flexbox, JavaScript
ES5, `XMLHttpRequest`, `<canvas>` 2D. Nada de CSS Grid, `fetch`, ES6 ou frameworks.
