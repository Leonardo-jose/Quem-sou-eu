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
    };

    socket.join(codigo);
    socket.data.codigo = codigo; // NOVO: guarda a sala junto com esse socket

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
    socket.data.codigo = codigo; // NOVO: guarda a sala junto com esse socket

    io.to(codigo).emit("lista-jogadores-atualizada", sala.jogadores);
  });

  socket.on("disconnect", () => {
    console.log("Alguém saiu:", socket.id);
    io.emit("total-conectados", io.engine.clientsCount);

    const codigo = socket.data.codigo;
    const sala = salas[codigo];
    if (!sala) return; // esse socket nunca chegou a entrar numa sala

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