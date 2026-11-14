const { listarTodos, totalDePersonagens } = require("./banco");

console.log(`Total: ${totalDePersonagens()} personagens`);
console.table(listarTodos());