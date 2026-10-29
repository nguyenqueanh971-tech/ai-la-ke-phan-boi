
const socket = io();

let myName = '';
let myColor = '#82c9f4';
let roomCode = '';
let myRole = 'crew';
let myTasks = [];
let players = [];
let selectedVote = null;

const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.remove('active');
  });
  $(id)?.classList.add('active');
}

function message(text) {
  alert(text);
}

function chooseColor(color, element) {
  myColor = color;
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.classList.remove('selected');
  });
  element.classList.add('selected');

  const character = $('character-preview');
  if (character) character.style.background = color;
}

function getPlayerInfo() {
  myName = $('player-name').value.trim();

  if (!myName) {
    message('Bạn hãy nhập tên nhân vật trước nhé!');
    return false;
  }

  return true;
}

function createRoom() {
  if (!getPlayerInfo()) return;

  socket.emit('room:create', {
    name: myName,
    color: myColor
  });
}

function joinRoom() {
  if (!getPlayerInfo()) return;

  const code = $('join-code').value.trim().toUpperCase();

  if (!code) {
    message('Bạn hãy nhập mã phòng!');
    return;
  }

  socket.emit('room:join', {
    code,
    name: myName,
    color: myColor
  });
}

function enterLobby(data) {
  roomCode = data.code;
  players = data.players || [];

  $('room-code').textContent = roomCode;
  showScreen('lobby-screen');
  renderPlayers();
}

function renderPlayers() {
  const list = $('player-list');
  if (!list) return;

  list.innerHTML = '';

  players.forEach(player => {
    const item = document.createElement('div');
    item.className = 'player-item';

    const dot = document.createElement('span');
    dot.style.display = 'inline-block';
    dot.style.width = '15px';
    dot.style.height = '15px';
    dot.style.borderRadius = '50%';
    dot.style.background = player.color || '#82c9f4';
    dot.style.marginRight = '9px';

    item.appendChild(dot);
    item.appendChild(document.createTextNode(player.name));

    list.appendChild(item);
  });
}

function startGame() {
  socket.emit('game:start', { code: roomCode });
}

function renderGamePlayers() {
  const map = $('map');
  if (!map) return;

  map.querySelectorAll('.game-character').forEach(el => el.remove());

  players.forEach(player => {
    const character = document.createElement('div');
    character.className = 'game-character';
    character.dataset.playerId = player.id;
    character.style.background = player.color || '#82c9f4';
    character.style.left = `${player.x || 50}px`;
    character.style.top = `${player.y || 50}px`;
    map.appendChild(character);
  });
}

function showGame(data) {
  players = data.players || players;
  showScreen('game-screen');
  renderGamePlayers();
}

function updateRole(data) {
  myRole = data.role;
  myTasks = data.tasks || [];

  const roleText = $('my-role');
  if (roleText) {
    roleText.textContent =
      myRole === 'impostor'
        ? '🕵️ Bạn là KẺ PHẢN BỘI!'
        : '😊 Bạn là thành viên phi hành đoàn!';
  }

  renderTasks();
}

function renderTasks() {
  const list = $('task-list');
  if (!list) return;

  list.innerHTML = '';

  myTasks.forEach((task, index) => {
    const item = document.createElement('li');
    item.textContent = task;
    list.appendChild(item);
  });
}

function completeTask() {
  if (myRole === 'impostor') {
    message('Kẻ phản bội không cần làm nhiệm vụ đâu! 😈');
    return;
  }

  socket.emit('task:complete', { code: roomCode });
}

function callMeeting() {
  socket.emit('meeting:call', { code: roomCode });
}

function moveCharacter(dx, dy) {
  const map = $('map');
  if (!map) return;

  const myCharacter = map.querySelector(
    `[data-player-id="${socket.id}"]`
  );

  if (!myCharacter) return;

  const maxX = map.clientWidth - 45;
  const maxY = map.clientHeight - 45;

  const x = Math.max(0, Math.min(maxX, myCharacter.offsetLeft + dx));
  const y = Math.max(0, Math.min(maxY, myCharacter.offsetTop + dy));

  socket.emit('player:move', { x, y });
}

document.addEventListener('keydown', event => {
  if (!$('game-screen')?.classList.contains('active')) return;

  const key = event.key.toLowerCase();

  if (key === 'arrowup' || key === 'w') moveCharacter(0, -12);
  if (key === 'arrowdown' || key === 's') moveCharacter(0, 12);
  if (key === 'arrowleft' || key === 'a') moveCharacter(-12, 0);
  if (key === 'arrowright' || key === 'd') moveCharacter(12, 0);
});

socket.on('room:created', enterLobby);
socket.on('room:joined', enterLobby);

socket.on('room:updated', data => {
  players = data.players || [];
  renderPlayers();
});

socket.on('game:started', showGame);
socket.on('game:private', updateRole);

socket.on('player:moved', data => {
  const player = players.find(p => p.id === data.id);
  if (player) {
    player.x = data.x;
    player.y = data.y;
  }

  const character = document.querySelector(
    `[data-player-id="${data.id}"]`
  );

  if (character) {
    character.style.left = `${data.x}px`;
    character.style.top = `${data.y}px`;
  }
});

socket.on('task:progress', data => {
  message(`Nhiệm vụ đã hoàn thành! 🎉 (${data.completed}/${data.total})`);
});

socket.on('meeting:started', () => {
  message('🚨 Cuộc họp khẩn cấp bắt đầu! Hãy tìm kẻ phản bội!');
});

socket.on('room:error', data => {
  message(data.message || 'Có lỗi xảy ra. Hãy thử lại nhé!');
});

socket.on('connect_error', () => {
  message('Không kết nối được máy chủ. Hãy thử tải lại trang.');
});
