const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
const MIN_SITELINKS = 40; // ajuste este número: maior = só gente muito famosa
const TAMANHO_DO_POOL = 300;

const PERSONAGENS_RESERVA = [
    "Albert Einstein", "Beyoncé", "Pelé", "Cleópatra",
    "Michael Jackson", "Frida Kahlo", "Nelson Mandela", "Freddie Mercury",
];

let poolDePersonagens = [];
let poolAtualizadoEm = 0;
const UMA_HORA_EM_MS = 60 * 60 * 1000;

function montarConsultaSparql() {
  return `
    SELECT ?itemLabel WHERE {
      ?item wdt:P31 wd:Q5.
      ?item wikibase:sitelinks ?sitelinks.
      FILTER(?sitelinks > ${MIN_SITELINKS})
      SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
    }
    LIMIT ${TAMANHO_DO_POOL}
  `;
}

async function buscarPoolNoWikidata() {
  const consulta = montarConsultaSparql();
  const url = `${SPARQL_ENDPOINT}?query=${encodeURIComponent(consulta)}&format=json`;

  const resposta = await fetch(url, {
    headers: {
      "User-Agent": "JogoQuemSouEu/1.0 (projeto de estudo)",
      "Accept": "application/sparql-results+json",
    },
  });

  if (!resposta.ok) {
    throw new Error(`Consulta SPARQL falhou: HTTP ${resposta.status}`);
  }

  const dados = await resposta.json();
  return dados.results.bindings.map((linha) => linha.itemLabel.value);
}

async function garantirPoolAtualizado() {
  const passouUmaHora = Date.now() - poolAtualizadoEm > UMA_HORA_EM_MS;

  if (poolDePersonagens.length === 0 || passouUmaHora) {
    try {
      console.log("Atualizando pool de personagens via SPARQL...");
      poolDePersonagens = await buscarPoolNoWikidata();
      poolAtualizadoEm = Date.now();
      console.log(`Pool atualizado com ${poolDePersonagens.length} nomes.`);
    } catch (erro) {
      console.error("Falha ao buscar pool no Wikidata:", erro.message);
      if (poolDePersonagens.length === 0) {
        poolDePersonagens = [...PERSONAGENS_RESERVA];
      }
      // se já existia um pool de antes, mantemos ele mesmo desatualizado
    }
  }
}

function embaralhar(array) {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

async function buscarPessoasFamosas(quantidade) {
  await garantirPoolAtualizado();
  const embaralhados = embaralhar(poolDePersonagens);
  return embaralhados.slice(0, quantidade);
}

module.exports = { buscarPessoasFamosas };