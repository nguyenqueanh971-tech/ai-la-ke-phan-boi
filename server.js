
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 15;

function makeCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      color: player.color,
      x: player.x,
      y: player.y,
      alive: player.alive
    }))
  };
}

function updateRoom(room) {
  io.to(room.code).emit("room:update", publicRoom(room));
}

function findRoom(socketId) {
  return [...rooms.values()].find(room =>
    room.players.some(player => player.id === socketId)
  );
}

function startGame(room) {
  const shuffled = shuffle(room.players);
  const impostorCount = room.players.length >= 12 ? 3 :
    room.players.length >= 8 ? 2 : 1;

  shuffled.forEach((player, index) => {
    player.role = index < impostorCount ? "impostor" : "crewmate";
    player.tasksDone = 0;
  });

  room.phase = "playing";
  room.startedAt = Date.now();

  room.players.forEach(player => {
    io.to(player.id).emit("game:private", {
      role: player.role,
      tasks: player.role === "crewmate" ? [
        "Nối dây điện",
        "Sửa máy phát",
        "Tải dữ liệu",
        "Nạp năng lượng"
      ] : []
    });
  });

  updateRoom(room);
}

io.on("connection", socket => {
  socket.on("room:create", ({ name }) => {
    if (!name || !name.trim()) {
      return socket.emit("error:msg", "Bạn hãy nhập tên nhé!");
    }

    let code = makeCode();
    while (rooms.has(code)) code = makeCode();

    const room = {
      code,
      hostId: socket.id,
      phase: "lobby",
      players: [{
        id: socket.id,
        name: name.trim().slice(0, 18),
        color: "pink",
        x: 300,
        y: 250,
        alive: true
      }]
    };

    rooms.set(code, room);
    socket.join(code);
    socket.emit("room:joined", { code, host: true });
    updateRoom(room);
  });

  socket.on("room:join", ({ code, name, color }) => {
    const room = rooms.get(String(code || "").toUpperCase());

    if (!room) return socket.emit("error:msg", "Không tìm thấy phòng!");
    if (room.phase !== "lobby") return socket.emit("error:msg", "Ván chơi đã bắt đầu!");
    if (room.players.length >= MAX_PLAYERS) return socket.emit("error:msg", "Phòng đã đủ 15 người!");
    if (!name || !name.trim()) return socket.emit("error:msg", "Bạn hãy nhập tên!");

    if (room.players.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
      return socket.emit("error:msg", "Tên này đã có người sử dụng!");
    }

    room.players.push({
      id: socket.id,
      name: name.trim().slice(0, 18),
      color: color || "blue",
      x: 300 + Math.random() * 100,
      y: 250 + Math.random() * 100,
      alive: true
    });

    socket.join(room.code);
    socket.emit("room:joined", { code: room.code, host: false });
    updateRoom(room);
  });

  socket.on("game:start", () => {
    const room = findRoom(socket.id);
    if (!room || room.hostId !== socket.id) return;

    if (room.players.length < MIN_PLAYERS) {
      return socket.emit("error:msg", "Cần ít nhất 6 người để bắt đầu!");
    }

    if (room.phase !== "lobby") return;
    startGame(room);
  });

  socket.on("player:move", ({ x, y }) => {
    const room = findRoom(socket.id);
    if (!room || room.phase !== "playing") return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.alive) return;

    player.x = Math.max(30, Math.min(970, Number(x) || player.x));
    player.y = Math.max(30, Math.min(670, Number(y) || player.y));

    socket.to(room.code).emit("player:moved", {
      id: player.id,
      x: player.x,
      y: player.y
    });
  });

  socket.on("task:complete", () => {
    const room = findRoom(socket.id);
    if (!room || room.phase !== "playing") return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.role !== "crewmate") return;

    player.tasksDone++;
    socket.emit("task:progress", player.tasksDone);
  });

  socket.on("meeting:call", () => {
    const room = findRoom(socket.id);
    if (!room || room.phase !== "playing") return;

    room.phase = "meeting";
    io.to(room.code).emit("meeting:started");
    updateRoom(room);
  });

  socket.on("meeting:vote", ({ playerId }) => {
    const room = findRoom(socket.id);
    if (!room || room.phase !== "meeting") return;

    const voter = room.players.find(p => p.id === socket.id);
    const target = room.players.find(p => p.id === playerId);

    if (!voter || !voter.alive || !target || !target.alive) return;

    if (!room.votes) room.votes = {};
    room.votes[socket.id] = playerId;

    if (Object.keys(room.votes).length >= room.players.filter(p => p.alive).length) {
      const counts = {};
      Object.values(room.votes).forEach(id => {
        counts[id] = (counts[id] || 0) + 1;
      });

      const max = Math.max(...Object.values(counts));
      const leaders = Object.keys(counts).filter(id => counts[id] === max);

      if (leaders.length === 1) {
        const eliminated = room.players.find(p => p.id === leaders[0]);
        if (eliminated) eliminated.alive = false;
      }

      room.phase = "playing";
      room.votes = {};
      updateRoom(room);
    }
  });

  socket.on("disconnect", () => {
    const room = findRoom(socket.id);
    if (!room) return;

    if (room.phase === "lobby") {
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        rooms.delete(room.code);
      } else {
        if (room.hostId === socket.id) room.hostId = room.players[0].id;
        updateRoom(room);
      }
    }
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log("AI LA KE PHAN BOI is running on port " + PORT);
});
