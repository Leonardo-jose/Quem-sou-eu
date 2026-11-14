const { DatabaseSync } = require("node:sqlite");
const path = require("path");

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

function listarTodos() {
  return db
    .prepare("SELECT nome, vezes_usado, criado_em FROM personagens ORDER BY vezes_usado DESC, nome")
    .all();
}

function totalDePersonagens() {
  return db.prepare("SELECT COUNT(*) AS total FROM personagens").get().total;
}

module.exports = { registrarUsos, listarTodos, totalDePersonagens, gerarChave };