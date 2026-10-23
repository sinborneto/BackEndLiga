# Consulta de preços — Liga Pokémon

API REST Node.js 22+, TypeScript, Express, Playwright/Chromium e Zod. Projeto independente, sem precisar executar código no DevTools.

## Executar

```powershell
cd C:\Users\sinval.neto\testeBuscaLiga
npm ci
npx playwright install chromium
Copy-Item .env.example .env
npm run dev
```

Para produção local: `npm run build` e `npm start`. Verificações: `npm test`, `npm run lint`. `GET /health` informa se o processo está respondendo (não testa o portal).

## Consultar

Os resultados individuais e os sucessos em lote incluem `card.imageUrl` (imagem principal publicada pelo portal) e `card.url` (página efetivamente consultada da carta). São `null` quando indisponíveis; imagens são restritas às origens HTTPS da Liga Pokémon e do repositório de imagens usado pelo portal. A imagem é da edição identificada na consulta.

```powershell
curl.exe "http://localhost:3000/api/cards/prices?card=Articuno%20%28132%2F128%29&edition=30C&number=132"
curl.exe "http://localhost:3000/api/cards/prices?card=Articuno%20%28132%2F128%29&quality=NM&finish=Foil&minStock=2&maxPrice=60&sort=price_asc"
```

Parâmetros: `card` obrigatório; `edition`, `number`, `quality`, `finish`, `language`, `state`, `minStock`, `minPrice`, `maxPrice` opcionais. `sort`: `price_asc` (padrão), `price_desc`, `stock_desc`. Desconhecidos ficam ao final em ambas as direções. Filtros numéricos excluem ofertas cujo valor é desconhecido. Estados usam siglas, atributos usam os rótulos da resposta.

O serviço usa links efetivamente encontrados no portal para navegar entre candidatos. Não inventa parâmetros de edição. Retorna 409 com candidatos quando não consegue selecionar ou confirmar a edição. Listas que incluem mais de um `idEdicao` ou número são rejeitadas, sem misturar ofertas. Algumas buscas podem exigir nome e numeração completos.

Resposta ilustrativa reduzida (não representa cotação atual):

```json
{
  "card": {"name":"Articuno","number":"132/128","edition":"30C"},
  "source":"Liga Pokémon",
  "totalOffers":1,
  "collectedAt":"2026-10-22T19:00:00.000Z",
  "offers":[{"offerId":33426078,"storeId":242400,"store":"Gladiators TCG","city":"Curitiba","state":"PR","price":39.9,"originalPrice":null,"stock":1,"quality":"NM","qualityCode":"2","finish":"Foil","finishCode":2,"language":null,"languageCode":"8","url":"https://www.ligapokemon.com.br/?view=mp%2Fshowcase%2Fhome&id=242400&tcg=33426078"}],
  "diagnostics":{"pricesDecoded":1,"pricesPending":0,"stocksDecoded":1,"stocksPending":0,"messages":[]}
}
```

`totalOffers` conta as ofertas após filtros; os contadores de diagnóstico descrevem a coleta completa antes dos filtros. `collectedAt` é o horário da coleta original, também em respostas do cache. Códigos originais são preservados como string ou número conforme o portal. Não há agrupamento por loja ou preço.

## Consulta em lote

`POST /api/cards/prices/batch` recebe JSON com 1 a 20 cartas, em strings, objetos ou formatos mistos. Preserva a ordem dos itens e retorna todas as ofertas de cada carta.

```json
{
  "cards": [
    "Articuno (132/128)",
    {"name":"Chandelure","number":"137/128","edition":"30C","filters":{"minStock":2,"maxPrice":60}}
  ],
  "filters":{"quality":"NM","finish":"Foil","language":"Português","maxPrice":100,"sort":"price_asc"}
}
```

```powershell
$body = @{ cards = @("Articuno (132/128)", "Chandelure (137/128)") } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/cards/prices/batch -ContentType application/json -Body $body
```

Objeto por carta: `name` obrigatório; `number`, `edition` e `filters` opcionais. Espaços extras são normalizados. Filtros globais e individuais: `quality`, `finish`, `language`, `state`, `minStock`, `minPrice`, `maxPrice`, `sort`. Os números do JSON devem ser numéricos. Cada propriedade individual sobrescreve somente a propriedade global correspondente; intervalos de preço são validados após a combinação.

Resposta ilustrativa abreviada (a API inclui `offers`, `diagnostics`, `statistics`, `source` e `collectedAt` em cada sucesso):

```json
{
  "summary":{"requestedCards":2,"successfulCards":1,"failedCards":1,"totalOffers":81,"durationMs":8500},
  "results":[
    {"query":"Articuno (132/128)","status":"success","card":{"name":"Articuno","number":"132/128","edition":"30C"},"totalOffers":81},
    {"query":"Inexistente (999/999)","status":"error","error":{"code":"CARD_NOT_FOUND","message":"Carta não encontrada.","details":null}}
  ]
}
```

Lote válido retorna HTTP 200, inclusive se todas as cartas falharem. Cada item apresenta seu erro específico; uma falha não interrompe os demais itens. JSON inválido, filtros inválidos e limites excedidos retornam HTTP 400 antes da consulta.

`statistics` é calculado após os filtros: `minPrice`, `maxPrice`, `averagePrice` (duas casas), `medianPrice`, `totalStock`, `unknownStockOffers`, `storesCount`. Sem preços conhecidos, as quatro estatísticas de preço são `null`. Estoques conhecidos são somados; `unknownStockOffers` informa quantos são desconhecidos. Lojas são contadas por IDs distintos não nulos. Leilões permanecem na resposta sem converter lances em preço unitário.

Consultas equivalentes são deduplicadas por carta/número/edição (ignorando caixa e espaços extras); cada ocorrência recebe seus próprios filtros e resultado. O resumo conta ocorrências solicitadas, inclusive duplicatas, e soma suas ofertas. Diagnósticos descrevem a coleta completa antes dos filtros. O cache de 10 minutos é compartilhado com o endpoint individual; filtros não geram novas entradas e falhas não são armazenadas.

Configuração: `BATCH_CONCURRENCY=3` limita consultas de lote simultâneas no processo, inclusive entre lotes; `MAX_PAGES=3` limita páginas globalmente, incluindo consultas individuais. O menor limite prevalece no scraping em lote. `BATCH_MAX_CARDS=20` configura itens por lote. `CARD_TIMEOUT_MS=60000` limita cada coleta após a criação da página; no timeout o contexto é fechado e libera a vaga. Espera em fila e inicialização do navegador são separadas. `PAGE_TIMEOUT_MS=45000` limita navegações e esperas. Use inteiros positivos. `CACHE_TTL_MS=600000` mantém o TTL atual.

Verificações locais: `npm test`, `npm run build`, `npm run lint`. Integração HTTP manual: `npx tsx scripts/live-batch.ts`, que consulta Articuno e Chandelure e salva `artifacts/live-batch-result.json` com resultados e duração reais.

Validação do lote em 22/10/2026: **55 testes**, build e ESLint aprovados. Integração real via HTTP em **4.272 ms**: Articuno (132/128), 30C, com 81 ofertas / 81 preços / 81 estoques decodificados; Chandelure (137/128), 30C, com 80 ofertas / 80 preços / 80 estoques decodificados. Total: 161 ofertas, sem falhas ou pendências nessa coleta. Os totais são históricos e podem mudar.

O limite padrão atual do navegador é **três páginas**, conforme a configuração de lote acima.

## Decodificação validada

Prioriza `precoFinal`, depois `preco`, aceitando números e strings decimais estritas observadas no portal. O preço original só é exposto quando há preço final. Na ausência de valores numéricos, resolve as classes com `getComputedStyle` em elementos temporários: isso considera cascata, ordem das classes e regras com múltiplos seletores, inclusive ofertas fora do DOM.

O portal randomiza classes, posições e imagens. Há duas formas de validação:

- `sprite-profiles.json`: mapa de posições vinculado ao SHA-256 do sprite e geometria exata. Inicialmente vazio: o mapa do anexo não tem imagem validada associada.
- `glyph-fingerprints.json`: SHA-256 dos pixels RGBA exatos do recorte de cada glifo, incluindo dimensões. Calibrado visualmente no navegador nesta implementação. Permite reconhecer o mesmo glifo em sprites reorganizados. Não usa OCR, aproximação ou tolerância. Novos pixels, escala ou glifos retornam `null` e diagnóstico. PNGs são suportados; outros formatos não recebem correspondência por pixels.

Para recalibrar: `npm run inspect` gera `artifacts/inspection.json` e `artifacts/glyphs.png`. Confira visualmente cada linha e seu fingerprint antes de editar os mapas. Nunca atribua um dígito apenas por posição ou pelo preço esperado. As assinaturas iniciais cobrem os glifos observados na referência; novos estilos podem precisar de calibração.

Estoque aceita múltiplos glifos separados por `;`, assim como preços; `V` é separador decimal apenas nos preços. Falhas nunca são convertidas em estoque zero.

## Recursos e falhas

Condições (`quality`): `1 → M`, `2 → NM`, `3 → SP`, `4 → MP`, `5 → HP`, `6 → D`; `0 → Não definida`. Mapeamento confirmado em 23/10/2026 nos seletores `#collection_quality` e `#bazar_quality` do portal, usando Pikachu (12/17) como referência para HP. O código bruto continua em `qualityCode` e códigos desconhecidos retornam `null`. O filtro `quality` aceita as siglas, sem diferenciar maiúsculas e minúsculas, tanto na consulta individual quanto no lote.

Chromium reutilizado; contexto isolado por coleta; três páginas simultâneas por padrão; fila limitada; cache de até 200 consultas; TTL 10 minutos; consultas concorrentes à mesma carta compartilham a coleta; filtros aplicados depois do cache. Rate limit: 30 requisições/minuto/IP. Não configure confiança em proxy sem conhecer a infraestrutura. SIGINT/SIGTERM encerram o servidor e o navegador.

Variáveis em `.env.example`: porta, TTL, limite de páginas, timeout de navegação/espera e caminho dos perfis. Use valores positivos. Execute a partir da raiz do projeto para carregar os arquivos JSON de calibração.

Erros: 400 parâmetros inválidos; 404 carta inexistente identificada no conteúdo; 409 ambiguidade/edição não confirmada; 502 falha HTTP ou integração; 503 bloqueio identificado; 504 timeout; 429 limite de requisições. A página é validada por identidade e estruturas, não apenas status HTTP. Na consulta real, a resposta de navegação inicial foi 403, mas o navegador carregou normalmente os dados; a API só aceita esse caso se as estruturas efetivamente inicializarem. Não usa stealth, resolução de CAPTCHA nem repetição para contornar bloqueios.

## Verificação realizada e limitações

Em 22/10/2026, consulta real de Articuno (132/128), 30C: **81 ofertas, 81 preços e 81 estoques decodificados**, zero pendências. Inclui lojas, cidade, UF e descontos. Dados brutos de uma captura estão em `tests/fixtures/articuno.json`; o número 81 é esperado somente nesse snapshot. `npx tsx scripts/live.ts` repete a consulta real e grava `artifacts/live-result.json` (depende da disponibilidade do portal).

Também validado ao vivo: `npx tsx scripts/live.ts "Pikachu (025/165)"` identifica edição MEW e recupera 124 registros: 122 ofertas de loja com preço/estoque decodificados e 2 leilões. Os leilões são preservados com loja, preço unitário e estoque desconhecidos; valores de lances não são convertidos em preço de loja. A calibração adicional validou os dez dígitos nos dois estilos de sprite. Os totais e disponibilidades podem mudar.

Testes locais cobrem extração no Chromium, sprites, múltiplos dígitos, permutação de classes, hash desconhecido, descontos, relacionamentos, códigos conhecidos/desconhecidos, filtros, ordenação, cache, validação HTTP, inexistência, candidatos e timeout. Não fazem chamadas externas.

Idiomas foram confirmados nos rótulos e ícones de `#compralista-language` (incluindo 2 Inglês, 8 Português e 11 Português / Inglês). Códigos não reconhecidos continuam `null`. Outros acabamentos e qualidades não são inferidos. Registros sem IDs completos são preservados com IDs/URL nulos. A busca depende da estrutura atual do portal e pode retornar erro quando a identidade não puder ser confirmada. A referência real foi validada; compatibilidade com todo o catálogo não é garantida.

Antes de produção, confirmar autorização, termos de uso e eventual integração oficial com a Liga Pokémon. Essa autorização não foi estabelecida por este projeto. Consulte os links institucionais no próprio portal: https://www.ligapokemon.com.br/.
