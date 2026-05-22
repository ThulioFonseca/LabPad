/* =============================================================================
 * config.js  —  AJUSTE O DASHBOARD AQUI.
 *
 * Este e o unico arquivo que voce precisa editar no dia a dia. Nada de build:
 * salve e recarregue a pagina no iPad.
 * ===========================================================================*/

var CONFIG = {

  /* Origem da API. Vazio = mesmo servidor que serve esta pagina. */
  apiBase: '',

  /* Intervalo de atualizacao das metricas, em milissegundos. */
  refreshMs: 5000,

  /* Intervalo da Agenda e Noticias. Feeds externos mudam pouco: 10 minutos.
     (As URLs ficam no .env do servidor, nao aqui.) */
  feedsRefreshMs: 600000,

  /* Amostras guardadas por mini-grafico (sparkline). 60 x 5s = ~5 minutos. */
  sparkSamples: 60,

  /* ---------------------------------------------------------------------------
   * WIDGETS — cada item e um card. Para ADICIONAR uma metrica nova:
   *   1) garanta que o backend a devolve em /api/metrics
   *   2) copie uma linha abaixo e ajuste os campos
   *
   * Campos:
   *   id       identificador unico
   *   title    titulo exibido
   *   kind     'gauge'  card com numero + barra (0..max)
   *            'rate'   card de taxa de dados (download/upload)
   *            'info'   linha de texto (sem barra)
   *   section  'host' ou 'system' (em qual painel entra)
   *   path     caminho do valor no JSON  (ex: 'host.cpu_percent')
   *   spark    true para desenhar o mini-grafico
   *
   * Especificos de 'gauge':
   *   unit     sufixo do numero  (ex: '%', '°')
   *   max      valor cheio da barra (padrao 100)
   *   warn     a partir deste valor o card fica amarelo
   *   crit     a partir deste valor o card fica vermelho
   *   sub      {used:'...', total:'...'} linha extra "usado / total"
   *
   * Especificos de 'rate':
   *   path     caminho do download (bytes/s)
   *   path2    caminho do upload   (bytes/s)
   *
   * Especificos de 'info':
   *   fmt      'text' | 'duration' (segundos -> "6d 4h") | 'load' (vetor)
   * -------------------------------------------------------------------------*/
  widgets: [

    { id: 'cpu', title: 'CPU', kind: 'gauge', section: 'host',
      path: 'host.cpu_percent', unit: '%', warn: 75, crit: 90, spark: true },

    { id: 'mem', title: 'Memoria', kind: 'gauge', section: 'host',
      path: 'host.mem_percent', unit: '%', warn: 80, crit: 92, spark: true,
      sub: { used: 'host.mem_used', total: 'host.mem_total' } },

    { id: 'disk', title: 'Disco', kind: 'gauge', section: 'host',
      path: 'host.disk_agg_percent', unit: '%', warn: 75, crit: 90, spark: false,
      sub: { used: 'host.disk_agg_used', total: 'host.disk_agg_total' } },

    { id: 'temp', title: 'Temp CPU', kind: 'gauge', section: 'host',
      path: 'sensors.cpu_temp', unit: '°', max: 90, warn: 70, crit: 85,
      spark: true }

  ]
};
