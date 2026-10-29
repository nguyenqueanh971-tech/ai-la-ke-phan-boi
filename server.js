
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 6;
const MAX_PLAYERS = 15;

app.use(express.static("public"));

const rooms = new Map();
const playerRooms = new Map();

function makeCode() {
  let code;

  do {
    code = crypto.randomBytes(3).toString("hex").toUpperCase();
  } while (rooms.has(code));

  return code;
}

function sendRoomUpdate(room) {
  io.to(room.code).emit("room:update", {
    code: room.code,
    phase: room.phase,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      color: player.color,
      x: player.x,
      y: player.y
    }))
  });
}

function removePlayer(socket) {
  const code = playerRooms.get(socket.id);
  if (!code) return;

  const room = rooms.get(code);
  playerRooms.delete(socket.id);

  if (!room) return;

  room.players = room.players.filter(
    player => player.id !== socket.id
  );

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  if (room.hostId === socket.id) {
    room.hostId = room.players[0].id;
  }

  sendRoomUpdate(room);
}

io.on("connection", socket => {
  console.log("Người chơi kết nối:", socket.id);

  socket.on("room:create", data => {
    if (playerRooms.has(socket.id)) {
      socket.emit("error:msg", "Bạn đang ở trong một phòng rồi!");
      return;
    }

    const code = makeCode();

    const room = {
      code,
      hostId: socket.id,
      phase: "lobby",
      players: [{
        id: socket.id,
        name: String(data.name || "Người chơi").slice(0, 16),
        color: data.color || "#82c9f4",
        x: 100,
        y: 100,
        tasksCompleted: 0,
        role: "crewmate"
      }]
    };

    rooms.set(code, room);
    playerRooms.set(socket.id, code);
    socket.join(code);

    socket.emit("room:joined", {
      code,
      host: true
    });

    sendRoomUpdate(room);
  });

  socket.on("room:join", data => {
    if (playerRooms.has(socket.id)) {
      socket.emit("error:msg", "Bạn đang ở trong một phòng rồi!");
      return;
    }

    const code = String(data.code || "").toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit("error:msg", "Không tìm thấy phòng này!");
      return;
    }

    if (room.phase !== "lobby") {
      socket.emit("error:msg", "Trận đấu đã bắt đầu!");
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit("error:msg", "Phòng đã đủ 15 người!");
      return;
    }

    room.players.push({
      id: socket.id,
      name: String(data.name || "Người chơi").slice(0, 16),
      color: data.color || "#82c9f4",
      x: 100 + Math.random() * 100,
      y: 100 + Math.random() * 100,
      tasksCompleted: 0,
      role: "crewmate"
    });

    playerRooms.set(socket.id, code);
    socket.join(code);

    socket.emit("room:joined", {
      code,
      host: false
    });

    sendRoomUpdate(room);
  });

  socket.on("game:start", () => {
    const code = playerRooms.get(socket.id);
    const room = rooms.get(code);

    if (!room || room.hostId !== socket.id) return;

    if (room.players.length < MIN_PLAYERS) {
      socket.emit(
        "error:msg",
        `Cần ít nhất ${MIN_PLAYERS} người để bắt đầu!`
      );
      return;
    }

    if (room.players.length > MAX_PLAYERS) return;

    room.phase = "playing";

    const shuffled = [...room.players].sort(
      () => Math.random() - 0.5
    );

    let impostorCount = 1;

    if (room.players.length >= 8) impostorCount = 2;
    if (room.players.length >= 12) impostorCount = 3;

    shuffled.forEach((player, index) => {
      player.role = index < impostorCount
        ? "impostor"
        : "crewmate";
    });

    room.players.forEach(player => {
      const tasks = [
        "🔋 Sạc năng lượng",
        "🪐 Kiểm tra bản đồ sao",
        "🧹 Dọn bụi thiên thạch",
        "📡 Sửa ăng-ten liên lạc"
      ];

      io.to(player.id).emit("game:private", {
        role: player.role,
        tasks: player.role === "impostor" ? [] : tasks
      });
    });

    io.to(code).emit("game:started", {
      players: room.players.map(player => ({
        id: player.id,
        name: player.name,
        color: player.color,
        x: player.x,
        y: player.y
      }))
    });

    sendRoomUpdate(room);
  });

  socket.on("player:move", data => {
    const code = playerRooms.get(socket.id);
    const room = rooms.get(code);

    if (!room || room.phase !== "playing") return;

    const player = room.players.find(
      item => item.id === socket.id
    );

    if (!player) return;

    player.x = Math.max(0, Math.min(1000, Number(data.x) || 0));
    player.y = Math.max(0, Math.min(1000, Number(data.y) || 0));

    socket.to(code).emit("player:moved", {
      id: socket.id,
      x: player.x,
      y: player.y
    });
  });

  socket.on("task:complete", () => {
    const code = playerRooms.get(socket.id);
    const room = rooms.get(code);

    if (!room || room.phase !== "playing") return;

    const player = room.players.find(
      item => item.id === socket.id
    );

    if (!player || player.role !== "crewmate") return;

    player.tasksCompleted++;

    socket.emit(
      "task:progress",
      player.tasksCompleted
    );
  });

  socket.on("meeting:call", () => {
    const code = playerRooms.get(socket.id);
    const room = rooms.get(code);

    if (!room || room.phase !== "playing") return;

    room.phase = "meeting";

    io.to(code).emit("meeting:started");
    sendRoomUpdate(room);
  });

  socket.on("disconnect", () => {
    console.log("Người chơi rời đi:", socket.id);
    removePlayer(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Game đang chạy tại cổng ${PORT}`);
});
