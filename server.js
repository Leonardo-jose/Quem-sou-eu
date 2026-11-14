const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { buscarPessoasFamosas } = require("./personagens");

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
    };

    socket.join(codigo);
    socket.data.codigo = codigo;

    socket.emit("sala-criada", codigo);
    io.to(codigo).emit("lista-jogadores-atualizada", salas[codigo].jogadores);
  });

  socket.on("entrar-sala", ({ codigo, nome }) => {
    const sala = salas[codigo];

    if (!sala) {
      socket.emit("erro", "Sala não encontrada. Confira o código.");
      return;
    }

    sala.jogadores.push({ id: socket.id, nome: nome });
    socket.join(codigo);
    socket.data.codigo = codigo;

    io.to(codigo).emit("lista-jogadores-atualizada", sala.jogadores);
  });

  socket.on("iniciar-jogo", async () => {
    const codigo = socket.data.codigo;
    const sala = salas[codigo];
    if (!sala) return;

    if (socket.id !== sala.donoId) {
      socket.emit("erro", "Só o dono da sala pode iniciar o jogo.");
      return;
    }

    await sortearPersonagens(sala);
    enviarEstadoDoJogo(sala, codigo);
  });

  socket.on("disconnect", () => {
    console.log("Alguém saiu:", socket.id);
    io.emit("total-conectados", io.engine.clientsCount);

    const codigo = socket.data.codigo;
    const sala = salas[codigo];
    if (!sala) return;

    sala.jogadores = sala.jogadores.filter((jogador) => jogador.id !== socket.id);
    io.to(codigo).emit("lista-jogadores-atualizada", sala.jogadores);
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

async function sortearPersonagens(sala) {
  const quantidadeJogadores = sala.jogadores.length;
  const nomes = await buscarPessoasFamosas(quantidadeJogadores);
  const embaralhados = embaralhar(nomes);

  sala.jogadores.forEach((jogador, index) => {
    jogador.identidade = embaralhados[index];
  });
}

function enviarEstadoDoJogo(sala, codigo) {
  sala.jogadores.forEach((jogadorAtual) => {
    const visaoDesseJogador = sala.jogadores.map((j) => ({
      nome: j.nome,
      identidade: j.id === jogadorAtual.id ? null : j.identidade,
      souEu: j.id === jogadorAtual.id,
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