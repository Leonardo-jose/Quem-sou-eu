const { DatabaseSync } = require("node:sqlite");
const path = require("path");

// Só nomes usados em pelo menos este número de rodadas são oferecidos
// como sugestão ou sorteio. Isso filtra piadas e erros de digitação, que
// raramente se repetem. Com 1, o banco oferece tudo o que já foi usado.
const MIN_USOS_PARA_OFERECER = 2;

// O banco é um único arquivo, criado automaticamente na pasta do projeto
const db = new DatabaseSync(path.join(__dirname, "personagens.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS personagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    chave TEXT NOT NULL UNIQUE,
    vezes_usado INTEGER NOT NULL DEFAULT 1,
    criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

// "  Pelé " e "PELE" viram a mesma chave: "pele"
function gerarChave(nome) {
  return String(nome || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Os "?" são preenchidos pelo próprio banco, nunca por concatenação de texto.
const inserirOuSomar = db.prepare(`
  INSERT INTO personagens (nome, chave) VALUES (?, ?)
  ON CONFLICT(chave) DO UPDATE SET vezes_usado = vezes_usado + 1
`);

// Recebe a lista de nomes de UMA partida e registra cada nome uma vez só
function registrarUsos(nomes) {
  const jaVistos = new Set();

  for (const nome of nomes) {
    const chave = gerarChave(nome);
    if (!chave || jaVistos.has(chave)) continue;
    jaVistos.add(chave);
    const nomeLimpo = String(nome).trim().replace(/\s+/g, " "); // sem espaços duplicados
    inserirOuSomar.run(nomeLimpo, chave);
  }
}

// No LIKE, "%" e "_" são curingas. Se o jogador digitar "50%", sem este
// escape o "%" viraria "qualquer coisa" em vez de um caractere comum.
function escaparLike(texto) {
  return texto.replace(/[\\%_]/g, "\\$&");
}

const buscarPorTexto = db.prepare(`
  SELECT nome FROM personagens
  WHERE chave LIKE ? ESCAPE '\\' AND vezes_usado >= ?
  ORDER BY vezes_usado DESC, nome
  LIMIT ?
`);

// Sugestões enquanto o jogador digita: nomes que CONTÊM o texto digitado
function buscarSugestoes(texto, limite = 5) {
  const chave = gerarChave(texto);
  if (chave.length < 2) return [];

  return buscarPorTexto
    .all(`%${escaparLike(chave)}%`, MIN_USOS_PARA_OFERECER, limite)
    .map((linha) => linha.nome);
}

const sortearCandidatos = db.prepare(`
  SELECT nome, chave FROM personagens
  WHERE vezes_usado >= ?
  ORDER BY RANDOM()
  LIMIT 30
`);

// Devolve um nome aleatório do banco, evitando as chaves proibidas
// (ex: nomes que já estão em uso na sala). Devolve null se não houver nenhum.
function sortearDoBanco(chavesProibidas = new Set()) {
  const candidatos = sortearCandidatos.all(MIN_USOS_PARA_OFERECER);
  const escolhido = candidatos.find((c) => !chavesProibidas.has(c.chave));
  return escolhido ? escolhido.nome : null;
}

function listarTodos() {
  return db
    .prepare("SELECT nome, vezes_usado, criado_em FROM personagens ORDER BY vezes_usado DESC, nome")
    .all();
}

function totalDePersonagens() {
  return db.prepare("SELECT COUNT(*) AS total FROM personagens").get().total;
}

module.exports = {
  registrarUsos,
  buscarSugestoes,
  sortearDoBanco,
  listarTodos,
  totalDePersonagens,
  gerarChave,
};