const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Sem protótipo: códigos como "constructor" não encontram "salas" falsas
const salas = Object.create(null);

// Quanto tempo esperamos a pessoa voltar antes de removê-la da sala
// (para testar mais rápido, troque por 15 * 1000)
const TEMPO_DE_RECONEXAO_MS = 60 * 1000;

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("Alguém conectou! ID:", socket.id);

  socket.on("criar-sala", (nomeDoJogador) => {
    const codigo = gerarCodigoSala();
    const jogador = criarJogador(socket.id, nomeDoJogador);

    salas[codigo] = {
      jogadores: [jogador],
      donoId: socket.id,
      jogoIniciado: false,
    };

    socket.join(codigo);
    socket.data.codigo = codigo;

    socket.emit("sala-criada", codigo);
    // NOVO: o token vai SÓ para quem criou (socket.emit), nunca para a sala
    socket.emit("sessao-iniciada", { token: jogador.token, codigo });
    io.to(codigo).emit("lista-jogadores-atualizada", listaPublica(salas[codigo]));
    enviarProgressoDosNomes(salas[codigo], codigo);
  });

  socket.on("entrar-sala", (dados) => {
    const { codigo, nome } = dados || {};
    const sala = salas[codigo];

    if (!sala) {
      socket.emit("erro", "Sala não encontrada. Confira o código.");
      return;
    }

    if (sala.jogoIniciado) {
      socket.emit("erro", "Essa sala já começou o jogo.");
      return;
    }

    const jogador = criarJogador(socket.id, nome);
    sala.jogadores.push(jogador);
    socket.join(codigo);
    socket.data.codigo = codigo;

    socket.emit("sessao-iniciada", { token: jogador.token, codigo });
    io.to(codigo).emit("lista-jogadores-atualizada", listaPublica(sala));
    enviarProgressoDosNomes(sala, codigo);
  });

  // NOVO: uma conexão nova diz "eu sou o jogador do token X da sala Y"
  socket.on("reconectar", (dados) => {
    const { token, codigo } = dados || {};
    const sala = salas[codigo];
    const jogador = sala && sala.jogadores.find((j) => j.token === token);

    if (!jogador) {
      socket.emit("sessao-invalida");
      return;
    }

    // a pessoa voltou a tempo: cancela a remoção agendada
    clearTimeout(jogador.timerRemocao);
    jogador.timerRemocao = null;

    // troca o id antigo pelo da conexão nova
    const idAntigo = jogador.id;
    jogador.id = socket.id;
    jogador.conectado = true;
    if (sala.donoId === idAntigo) sala.donoId = socket.id;

    socket.join(codigo);
    socket.data.codigo = codigo;

    console.log(`${jogador.nome} reconectou na sala ${codigo}`);

    socket.emit("sala-recuperada", { codigo });
    io.to(codigo).emit("lista-jogadores-atualizada", listaPublica(sala));
    enviarProgressoDosNomes(sala, codigo);
    if (sala.jogoIniciado) enviarEstadoDoJogo(sala, codigo);
  });

  socket.on("enviar-nome", (texto) => {
    const codigo = socket.data.codigo;
    const sala = salas[codigo];
    if (!sala) return;

    const nome = String(texto || "").trim().slice(0, 40);
    if (!nome) {
      socket.emit("erro", "Escreva um nome antes de enviar.");
      return;
    }

    const jogador = sala.jogadores.find((j) => j.id === socket.id);
    if (!jogador) return;

    jogador.nomeEscolhido = nome;
    enviarProgressoDosNomes(sala, codigo);
  });

  socket.on("iniciar-jogo", () => {
    const codigo = socket.data.codigo;
    const sala = salas[codigo];
    if (!sala) return;

    if (socket.id !== sala.donoId) {
      socket.emit("erro", "Só o dono da sala pode iniciar o jogo.");
      return;
    }

    if (sala.jogadores.length < 2) {
      socket.emit("erro", "São necessários pelo menos 2 jogadores.");
      return;
    }

    const semNome = sala.jogadores.filter((j) => !j.nomeEscolhido);
    if (semNome.length > 0) {
      const nomes = semNome.map((j) => j.nome).join(", ");
      socket.emit("erro", `Ainda faltam nomes de: ${nomes}`);
      return;
    }

    distribuirNomes(sala);
    sala.jogoIniciado = true;
    enviarEstadoDoJogo(sala, codigo);
  });

  socket.on("revelar-jogador", (alvoId) => {
    const codigo = socket.data.codigo;
    const sala = salas[codigo];
    if (!sala || !sala.jogoIniciado) return;

    const alvo = sala.jogadores.find((j) => j.id === alvoId);
    if (!alvo) return;

    if (alvo.id === socket.id) {
      socket.emit("erro", "Você não pode revelar o seu próprio personagem.");
      return;
    }

    if (alvo.revelado) return;

    alvo.revelado = true;
    enviarEstadoDoJogo(sala, codigo);
  });

  socket.on("jogar-de-novo", () => {
    const codigo = socket.data.codigo;
    const sala = salas[codigo];
    if (!sala || !sala.jogoIniciado) return;

    if (socket.id !== sala.donoId) {
      socket.emit("erro", "Só o dono da sala pode reiniciar a rodada.");
      return;
    }

    sala.jogoIniciado = false;
    sala.jogadores.forEach((j) => {
      delete j.nomeEscolhido;
      delete j.identidade;
      delete j.revelado;
    });

    io.to(codigo).emit("voltou-ao-lobby");
    enviarProgressoDosNomes(sala, codigo);
  });

  // MUDOU: em vez de remover na hora, marca como desconectado e agenda a remoção
  socket.on("disconnect", () => {
    console.log("Alguém saiu:", socket.id);

    const codigo = socket.data.codigo;
    const sala = salas[codigo];
    if (!sala) return;

    // Se a pessoa já reconectou com outra conexão, este id antigo não está
    // mais na sala, e não achar ninguém aqui é o comportamento correto.
    const jogador = sala.jogadores.find((j) => j.id === socket.id);
    if (!jogador) return;

    jogador.conectado = false;
    console.log(`${jogador.nome} caiu; aguardando reconexão...`);

    io.to(codigo).emit("lista-jogadores-atualizada", listaPublica(sala));
    if (sala.jogoIniciado) enviarEstadoDoJogo(sala, codigo);

    jogador.timerRemocao = setTimeout(() => {
      removerJogador(codigo, jogador.token);
    }, TEMPO_DE_RECONEXAO_MS);
  });
});

server.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});

function criarJogador(id, nome) {
  return {
    id,
    token: crypto.randomUUID(), // código longo e imprevisível
    nome,
    conectado: true,
    timerRemocao: null,
  };
}

// NOVO: o que pode sair pela rede. Sem token, sem identidade, sem nomeEscolhido.
function listaPublica(sala) {
  return sala.jogadores.map((j) => ({
    id: j.id,
    nome: j.nome,
    conectado: j.conectado,
  }));
}

// NOVO: a lógica que antes ficava dentro do disconnect
function removerJogador(codigo, token) {
  const sala = salas[codigo];
  if (!sala) return;

  const jogador = sala.jogadores.find((j) => j.token === token);
  if (!jogador || jogador.conectado) return; // voltou: não remove

  console.log(`${jogador.nome} não voltou a tempo e foi removido da sala ${codigo}`);
  sala.jogadores = sala.jogadores.filter((j) => j.token !== token);

  if (sala.jogadores.length === 0) {
    delete salas[codigo];
    console.log(`Sala ${codigo} removida (vazia)`);
    return;
  }

  if (sala.donoId === jogador.id) {
    // prefere quem está conectado agora
    const novoDono = sala.jogadores.find((j) => j.conectado) || sala.jogadores[0];
    sala.donoId = novoDono.id;
    io.to(codigo).emit("aviso", `${novoDono.nome} agora é o dono da sala.`);
  }

  io.to(codigo).emit("lista-jogadores-atualizada", listaPublica(sala));
  enviarProgressoDosNomes(sala, codigo);
  if (sala.jogoIniciado) enviarEstadoDoJogo(sala, codigo);
}

function gerarCodigoSala() {
  const caracteres = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let codigo;
  do {
    codigo = "";
    for (let i = 0; i < 4; i++) {
      codigo += caracteres[Math.floor(Math.random() * caracteres.length)];
    }
  } while (salas[codigo]);
  return codigo;
}

function distribuirNomes(sala) {
  const roda = embaralhar(sala.jogadores);
  const n = roda.length;

  roda.forEach((jogador, i) => {
    const proximo = roda[(i + 1) % n];
    jogador.identidade = proximo.nomeEscolhido;
    jogador.revelado = false;
  });
}

function enviarProgressoDosNomes(sala, codigo) {
  const enviados = sala.jogadores.filter((j) => j.nomeEscolhido).length;
  io.to(codigo).emit("progresso-nomes", { enviados, total: sala.jogadores.length });
}

function enviarEstadoDoJogo(sala, codigo) {
  sala.jogadores.forEach((jogadorAtual) => {
    const visaoDesseJogador = sala.jogadores.map((j) => ({
      id: j.id,
      nome: j.nome,
      identidade: (j.id === jogadorAtual.id && !j.revelado) ? null : j.identidade,
      souEu: j.id === jogadorAtual.id,
      revelado: !!j.revelado,
      conectado: j.conectado, // NOVO
    }));

    io.to(jogadorAtual.id).emit("estado-do-jogo", visaoDesseJogador);
  });
}

function embaralhar(array) {
  const copia = [...array];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}