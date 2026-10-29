
const socket = io();

let myName = "";
let myColor = "pink";
let roomCode = "";
let isHost = false;
let myRole = "crewmate";
let players = [];

const $ = id => document.getElementById(id);

function showScreen(screenId) {
  ["home", "lobby", "game"].forEach(id => {
    $(id).classList.add("hidden");
  });
  $(screenId).classList.remove("hidden");
}

function notify(text) {
  alert(text);
}

// Chọn màu nhân vật
document.querySelectorAll("#colors button").forEach(button => {
  button.addEventListener("click", () => {
    myColor = button.dataset.color;

    document.querySelectorAll("#colors button").forEach(b =>
      b.classList.remove("selected")
    );

    button.classList.add("selected");

    const character = document.querySelector("#preview .character");
    if (character) {
      character.className = "character " + myColor;
    }
  });
});

// Lấy thông tin người chơi
function getPlayerInfo() {
  myName = $("playerName").value.trim();

  if (!myName) {
    notify("Bạn hãy nhập tên nhân vật nhé!");
    return false;
  }

  return true;
}

// Tạo phòng
$("createRoom").addEventListener("click", () => {
  if (!getPlayerInfo()) return;

  socket.emit("room:create", {
    name: myName,
    color: myColor
  });
});

// Tham gia phòng
$("joinRoom").addEventListener("click", () => {
  if (!getPlayerInfo()) return;

  const code = $("roomCode").value.trim().toUpperCase();

  if (!code) {
    notify("Bạn hãy nhập mã phòng!");
    return;
  }

  socket.emit("room:join", {
    code,
    name: myName,
    color: myColor
  });
});

// Khi vào phòng
socket.on("room:joined", data => {
  roomCode = data.code;
  isHost = data.host === true;

  $("codeDisplay").textContent = roomCode;
  $("startGame").classList.toggle("hidden", !isHost);

  showScreen("lobby");
});

// Cập nhật phòng
socket.on("room:update", data => {
  players = data.players || [];

  $("codeDisplay").textContent = data.code;

  const list = $("playerList");
  list.innerHTML = "";

  players.forEach(player => {
    const item = document.createElement("div");
    item.className = "player-item";
    item.textContent = "🧑 " + player.name;
    item.style.borderLeft = "8px solid " + player.color;
    list.appendChild(item);
  });

  $("waiting").textContent =
    `Đang có ${players.length}/15 người trong phòng`;

  if (data.phase === "playing" || data.phase === "meeting") {
    showScreen("game");
    renderCharacters();
  } else {
    showScreen("lobby");
  }
});

// Sao chép mã phòng
$("copyCode").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    notify("Đã sao chép mã phòng: " + roomCode);
  } catch {
    notify("Mã phòng của bạn: " + roomCode);
  }
});

// Bắt đầu game
$("startGame").addEventListener("click", () => {
  socket.emit("game:start");
});

// Hiển thị nhân vật
function renderCharacters() {
  const container = $("characters");
  container.innerHTML = "";

  players.forEach(player => {
    const character = document.createElement("div");
    character.className = "game-character";
    character.dataset.playerId = player.id;
    character.textContent = "•ᴗ•";
    character.style.background = player.color;
    character.style.left = (player.x || 100) + "px";
    character.style.top = (player.y || 100) + "px";
    container.appendChild(character);
  });
}

// Nhận vai trò bí mật
socket.on("game:private", data => {
  myRole = data.role;

  $("role").textContent =
    myRole === "impostor"
      ? "😈 Bạn là KẺ PHẢN BỘI!"
      : "😊 Bạn là thành viên phi hành đoàn!";

  $("taskCount").textContent =
    "Nhiệm vụ: " + (data.tasks || []).length;

  $("gameMessage").textContent =
    myRole === "impostor"
      ? "Hãy bí mật tìm cơ hội phá hoại! 😈"
      : "Hoàn thành nhiệm vụ và tìm kẻ phản bội!";
});

// Di chuyển nhân vật
function move(dx, dy) {
  const character = document.querySelector(
    `[data-player-id="${socket.id}"]`
  );

  if (!character) return;

  const map = $("gameMap");

  const x = Math.max(30, Math.min(
    map.clientWidth - 50,
    character.offsetLeft + dx
  ));

  const y = Math.max(30, Math.min(
    map.clientHeight - 50,
    character.offsetTop + dy
  ));

  character.style.left = x + "px";
  character.style.top = y + "px";

  socket.emit("player:move", { x, y });
}

// Bàn phím máy tính
document.addEventListener("keydown", event => {
  if ($("game").classList.contains("hidden")) return;

  const key = event.key.toLowerCase();

  if (key === "w" || key === "arrowup") move(0, -12);
  if (key === "s" || key === "arrowdown") move(0, 12);
  if (key === "a" || key === "arrowleft") move(-12, 0);
  if (key === "d" || key === "arrowright") move(12, 0);
});

// Nhận vị trí người chơi khác
socket.on("player:moved", data => {
  const character = document.querySelector(
    `[data-player-id="${data.id}"]`
  );

  if (character) {
    character.style.left = data.x + "px";
    character.style.top = data.y + "px";
  }
});

// Làm nhiệm vụ
$("taskButton").addEventListener("click", () => {
  if (myRole === "impostor") {
    notify("Bạn là kẻ phản bội, không cần làm nhiệm vụ! 😈");
    return;
  }

  socket.emit("task:complete");
});

// Cập nhật nhiệm vụ
socket.on("task:progress", count => {
  $("taskCount").textContent = "Nhiệm vụ: " + count;
  $("gameMessage").textContent = "🎉 Hoàn thành một nhiệm vụ!";
});

// Họp khẩn cấp
$("meetingButton").addEventListener("click", () => {
  socket.emit("meeting:call");
});

socket.on("meeting:started", () => {
  notify("🚨 HỌP KHẨN CẤP! Hãy thảo luận xem ai là kẻ phản bội!");
});

// Thông báo lỗi từ máy chủ
socket.on("error:msg", text => {
  notify(text);
});

socket.on("connect_error", () => {
  notify("Không thể kết nối máy chủ. Hãy tải lại trang nhé!");
});

