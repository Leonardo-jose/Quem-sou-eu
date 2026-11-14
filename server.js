const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const salas = {};

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("Alguém conectou! ID:", socket.id);

  io.emit("total-conectados", io.engine.clientsCount);

  socket.on("criar-sala", (nomeDoJogador) => {
    const codigo = gerarCodigoSala();

    salas[codigo] = {
      jogadores: [{ id: socket.id, nome: nomeDoJogador }],
      donoId: socket.id,
      jogoIniciado: false,
    };

    socket.join(codigo);
    socket.data.codigo = codigo;

    socket.emit("sala-criada", codigo);
    io.to(codigo).emit("lista-jogadores-atualizada", salas[codigo].jogadores);
    enviarProgressoDosNomes(salas[codigo], codigo);
  });

  socket.on("entrar-sala", ({ codigo, nome }) => {
    const sala = salas[codigo];

    if (!sala) {
      socket.emit("erro", "Sala não encontrada. Confira o código.");
      return;
    }

    if (sala.jogoIniciado) {
      socket.emit("erro", "Essa sala já começou o jogo.");
      return;
    }

    sala.jogadores.push({ id: socket.id, nome: nome });
    socket.join(codigo);
    socket.data.codigo = codigo;

    io.to(codigo).emit("lista-jogadores-atualizada", sala.jogadores);
    enviarProgressoDosNomes(sala, codigo);
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

  // NOVO: o dono reinicia a rodada na mesma sala
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

  socket.on("disconnect", () => {
    console.log("Alguém saiu:", socket.id);
    io.emit("total-conectados", io.engine.clientsCount);

    const codigo = socket.data.codigo;
    const sala = salas[codigo];
    if (!sala) return;

    sala.jogadores = sala.jogadores.filter((jogador) => jogador.id !== socket.id);

    // NOVO: sala vazia some da memória
    if (sala.jogadores.length === 0) {
      delete salas[codigo];
      console.log(`Sala ${codigo} removida (vazia)`);
      return;
    }

    // NOVO: se o dono saiu, o primeiro da lista assume
    if (sala.donoId === socket.id) {
      const novoDono = sala.jogadores[0];
      sala.donoId = novoDono.id;
      io.to(codigo).emit("aviso", `${novoDono.nome} agora é o dono da sala.`);
    }

    io.to(codigo).emit("lista-jogadores-atualizada", sala.jogadores);
    enviarProgressoDosNomes(sala, codigo);

    // NOVO: se estava no meio da partida, atualiza a tela de jogo dos outros
    if (sala.jogoIniciado) {
      enviarEstadoDoJogo(sala, codigo);
    }
  });
});

server.listen(3000, () => {
  console.log("Servidor rodando em http://localhost:3000");
});

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