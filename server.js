const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const salas = {}; // Objeto para armazenar as salas e seus jogadores

app.use(express.static("public"));

io.on("connection", (socket) => {
  console.log("Alguém conectou! ID:", socket.id);

  // Avisa TODO MUNDO (inclusive quem acabou de entrar) quantas pessoas estão conectadas
  io.emit("total-conectados", io.engine.clientsCount);

  socket.on("disconnect", () => {
    console.log("Alguém saiu:", socket.id);
    io.emit("total-conectados", io.engine.clientsCount);
  });
  socket.on("criar-sala", (nomeDoJogador) => {
  const codigo = gerarCodigoSala();

  salas[codigo] = {
    jogadores: [{ id: socket.id, nome: nomeDoJogador }],
  };

  socket.join(codigo);

  socket.emit("sala-criada", codigo);
  console.log(`Sala ${codigo} criada por ${nomeDoJogador}`);
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
  } while (salas[codigo]); // se já existe uma sala com esse código, sorteia de novo
  return codigo;
}