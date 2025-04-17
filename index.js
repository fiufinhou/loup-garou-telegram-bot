// Werewolf (Loup Garou) Telegram Bot
// Dependencies
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// Configuration
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const URL = process.env.APP_URL || 'https://your-render-app.onrender.com';

// Game state
const gameState = {
  players: [],
  roles: {},
  gameStarted: false,
  phase: 'waiting',
  votes: {},
  alivePlayers: [],
  killedPlayer: null,
  witchSaveUsed: false,
  witchKillUsed: false,
  nightActions: {
    wolfKill: null,
    witchSave: null,
    witchKill: null,
    seerCheck: null
  }
};

// Game constants
const GAME_ROLES = {
  WEREWOLF: 'Loup-Garou',
  SEER: 'Voyante',
  WITCH: 'Sorcière',
  HUNTER: 'Chasseur',
  VILLAGER: 'Simple Villageois'
};

const PHASES = {
  WAITING: 'waiting',
  NIGHT: 'night',
  DAY: 'day'
};

const allRoles = [
  GAME_ROLES.WEREWOLF,
  GAME_ROLES.SEER,
  GAME_ROLES.WITCH,
  GAME_ROLES.HUNTER,
  GAME_ROLES.VILLAGER
];

// Initialize Express and Telegram Bot
const app = express();
let bot;

// For Render.com deployment using webhooks
if (process.env.NODE_ENV === 'production') {
  bot = new TelegramBot(TOKEN);
  bot.setWebHook(`${URL}/bot${TOKEN}`);
  app.use(express.json());
  app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
} else {
  // For local development using polling
  bot = new TelegramBot(TOKEN, { polling: true });
}

// Keep alive endpoint
app.get('/', (req, res) => {
  res.send('Loup Garou Bot is running!');
});

// Game messages
const messages = {
  welcome: `
🎮 أهلاً بك في لعبة Loup Garou (الذئب المستذئب)!

قواعد اللعبة:
- كل لاعب له دور سري (Loup-Garou, Voyante...)
- الذئاب تقتل في الليل.
- العرافة تكشف دور لاعب.
- الساحرة تنقذ أو تقتل.
- في النهار: تصويت جماعي لطرد لاعب.

الأوامر:
/start - عرض القواعد
/join - الانضمام إلى اللعبة
/players - عرض اللاعبين
/startgame - بدء اللعبة
/vote @username - التصويت لطرد
/speak - إرسال رسالة للجميع
/reset - إعادة تعيين اللعبة
`,
  gameAlreadyStarted: '❌ اللعبة بدأت بالفعل!',
  notEnoughPlayers: '❌ يجب أن يكون عدد اللاعبين 5 أو أكثر.',
  noPlayers: 'لا يوجد لاعبين بعد.',
  nightPhaseStart: '🌙 بدأ الليل. الأدوار السرية تتحرك...',
  nightPhaseEnd: 'انتهت المرحلة الليلية. ☀️ ننتقل إلى النهار.',
  noOneKilled: 'لم يتم قتل أي شخص هذه الليلة.',
  votingPhase: 'أرسل /vote @username لطرد لاعب.',
  noOneVoted: '🔄 لم يتم تحديد أحد للطرد.'
};

// Game utility functions
function resetGame() {
  gameState.players = [];
  gameState.roles = {};
  gameState.gameStarted = false;
  gameState.phase = PHASES.WAITING;
  gameState.votes = {};
  gameState.alivePlayers = [];
  gameState.killedPlayer = null;
  gameState.witchSaveUsed = false;
  gameState.witchKillUsed = false;
  gameState.nightActions = {
    wolfKill: null,
    witchSave: null,
    witchKill: null,
    seerCheck: null
  };
}

function findPlayerByUsername(username) {
  // Remove @ if present
  if (username.startsWith('@')) {
    username = username.substring(1);
  }
  return gameState.players.find(p => p.username === username);
}

function assignRoles() {
  const shuffledPlayers = [...gameState.players].sort(() => 0.5 - Math.random());
  
  // Create role pool based on player count
  let rolePool = [...allRoles];
  
  // Add more roles based on player count
  const extraRoles = Math.max(0, gameState.players.length - rolePool.length);
  for (let i = 0; i < extraRoles; i++) {
    if (i % 3 === 0) {
      rolePool.push(GAME_ROLES.WEREWOLF); // Add more werewolves for larger groups
    } else {
      rolePool.push(GAME_ROLES.VILLAGER); // Fill with villagers
    }
  }
  
  // Ensure we have at least one of each key role
  const keyRoles = [GAME_ROLES.WEREWOLF, GAME_ROLES.SEER, GAME_ROLES.WITCH];
  keyRoles.forEach(role => {
    if (!rolePool.includes(role)) {
      rolePool.push(role);
    }
  });
  
  // Assign roles to players
  shuffledPlayers.forEach((player, index) => {
    gameState.roles[player.id] = rolePool[index % rolePool.length];
  });
}

function countVotes() {
  if (Object.keys(gameState.votes).length === 0) return null;
  
  const voteCounts = {};
  Object.values(gameState.votes).forEach(username => {
    voteCounts[username] = (voteCounts[username] || 0) + 1;
  });
  
  let maxVotes = 0;
  let mostVotedPlayer = null;
  
  Object.entries(voteCounts).forEach(([username, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      mostVotedPlayer = username;
    }
  });
  
  return mostVotedPlayer;
}

function checkWinner(chatId) {
  const aliveWerewolves = gameState.alivePlayers.filter(p => 
    gameState.roles[p.id] === GAME_ROLES.WEREWOLF
  ).length;
  
  const aliveVillagers = gameState.alivePlayers.length - aliveWerewolves;
  
  if (aliveWerewolves === 0) {
    bot.sendMessage(chatId, '🏆 القرويون فازوا! تم القضاء على جميع الذئاب.');
    resetGame();
    return true;
  }
  
  if (aliveWerewolves >= aliveVillagers) {
    bot.sendMessage(chatId, '🐺 الذئاب فازت! لقد تغلبوا على القرويين.');
    resetGame();
    return true;
  }
  
  return false;
}

function processNightActions(chatId) {
  const { wolfKill, witchSave, witchKill } = gameState.nightActions;
  
  // Process werewolf kill
  if (wolfKill) {
    gameState.killedPlayer = wolfKill;
  }
  
  // Process witch save
  if (witchSave && witchSave === gameState.killedPlayer) {
    gameState.killedPlayer = null;
  }
  
  // Process witch kill
  if (witchKill && witchKill !== gameState.killedPlayer) {
    if (gameState.killedPlayer === null) {
      gameState.killedPlayer = witchKill;
    } else {
      // Two deaths this night
      const killedPlayer = findPlayerByUsername(witchKill);
      if (killedPlayer) {
        gameState.alivePlayers = gameState.alivePlayers.filter(p => p.id !== killedPlayer.id);
        bot.sendMessage(chatId, `❌ اللاعب @${witchKill} تم تسميمه بواسطة الساحرة.`);
      }
    }
  }
  
  // Reset night actions
  gameState.nightActions = {
    wolfKill: null,
    witchSave: null,
    witchKill: null,
    seerCheck: null
  };
}

// Game phase functions
function startNightPhase(chatId) {
  gameState.phase = PHASES.NIGHT;
  gameState.killedPlayer = null;
  
  bot.sendMessage(chatId, messages.nightPhaseStart);
  
  // Send role-specific instructions
  gameState.alivePlayers.forEach(player => {
    const role = gameState.roles[player.id];
    
    if (role === GAME_ROLES.WEREWOLF) {
      const wolves = gameState.alivePlayers.filter(p => gameState.roles[p.id] === GAME_ROLES.WEREWOLF);
      const wolfNames = wolves.map(w => '@' + w.username).join(', ');
      
      bot.sendMessage(player.id, `🐺 أنت ذئب. الذئاب الآخرون: ${wolfNames}`);
      
      const villagers = gameState.alivePlayers
        .filter(p => gameState.roles[p.id] !== GAME_ROLES.WEREWOLF)
        .map(p => '@' + p.username)
        .join('\n');
      
      bot.sendMessage(player.id, `من تريد قتله الليلة؟ أرسل /kill @username\n\nالقرويون:\n${villagers}`);
    } 
    else if (role === GAME_ROLES.SEER) {
      const players = gameState.alivePlayers
        .filter(p => p.id !== player.id)
        .map(p => '@' + p.username)
        .join('\n');
      
      bot.sendMessage(player.id, `🔮 من تريد معرفة دوره؟ أرسل /vision @username\n\nاللاعبون:\n${players}`);
    } 
    else if (role === GAME_ROLES.WITCH) {
      bot.sendMessage(player.id, `🧪 انتظر حتى يتم إخبارك بمن سيُقتل...`);
      
      // Wait to see who werewolves choose
      setTimeout(() => {
        if (gameState.nightActions.wolfKill) {
          const target = findPlayerByUsername(gameState.nightActions.wolfKill);
          if (target) {
            bot.sendMessage(
              player.id, 
              `🧪 الذئاب اختاروا قتل @${target.username}. ${
                gameState.witchSaveUsed ? 'لقد استخدمت الإنقاذ مسبقًا.' : 'هل تريد إنقاذه؟ أرسل /heal @' + target.username
              }`
            );
          }
        } else {
          bot.sendMessage(player.id, '🧪 الذئاب لم يختاروا أحدًا بعد.');
        }
        
        if (!gameState.witchKillUsed) {
          const players = gameState.alivePlayers
            .filter(p => p.id !== player.id)
            .map(p => '@' + p.username)
            .join('\n');
          
          bot.sendMessage(player.id, `هل تريد تسميم أحد؟ أرسل /poison @username\n\nاللاعبون:\n${players}`);
        } else {
          bot.sendMessage(player.id, 'لقد استخدمت السم مسبقًا.');
        }
      }, 15000);
    }
  });
  
  // Move to day phase after timeout
  setTimeout(() => {
    processNightActions(chatId);
    bot.sendMessage(chatId, messages.nightPhaseEnd);
    startDayPhase(chatId);
  }, 60000);
}

function startDayPhase(chatId) {
  gameState.phase = PHASES.DAY;
  gameState.votes = {};
  
  if (gameState.killedPlayer) {
    const killedPlayerObj = findPlayerByUsername(gameState.killedPlayer);
    if (killedPlayerObj) {
      gameState.alivePlayers = gameState.alivePlayers.filter(p => p.id !== killedPlayerObj.id);
      bot.sendMessage(chatId, `❌ اللاعب @${gameState.killedPlayer} تم قتله خلال الليل.`);
      
      // Special hunter ability
      if (gameState.roles[killedPlayerObj.id] === GAME_ROLES.HUNTER) {
        bot.sendMessage(chatId, `🏹 @${killedPlayerObj.username} كان الصياد! يمكنه اختيار شخص ليموت معه.`);
        bot.sendMessage(killedPlayerObj.id, `يمكنك اختيار شخص ليموت معك. أرسل /shoot @username`);
      }
    }
  } else {
    bot.sendMessage(chatId, messages.noOneKilled);
  }
  
  if (checkWinner(chatId)) return;
  
  bot.sendMessage(chatId, messages.votingPhase);
  
  // Send list of alive players
  const alivePlayersText = gameState.alivePlayers
    .map(p => '@' + p.username)
    .join('\n');
  
  bot.sendMessage(chatId, `اللاعبون الأحياء:\n${alivePlayersText}`);
  
  // Move to night phase after timeout
  setTimeout(() => {
    const votedOut = countVotes();
    if (votedOut) {
      bot.sendMessage(chatId, `📢 تم طرد @${votedOut} بأغلبية الأصوات!`);
      
      const votedPlayer = findPlayerByUsername(votedOut);
      if (votedPlayer) {
        gameState.alivePlayers = gameState.alivePlayers.filter(p => p.id !== votedPlayer.id);
        bot.sendMessage(chatId, `🎭 كان @${votedOut} يلعب دور ${gameState.roles[votedPlayer.id]}`);
        
        // Special hunter ability
        if (gameState.roles[votedPlayer.id] === GAME_ROLES.HUNTER) {
          bot.sendMessage(chatId, `🏹 @${votedOut} هو الصياد! يمكنه اختيار شخص ليموت معه.`);
          bot.sendMessage(votedPlayer.id, `يمكنك اختيار شخص ليموت معك. أرسل /shoot @username`);
        }
      }
    } else {
      bot.sendMessage(chatId, messages.noOneVoted);
    }
    
    if (checkWinner(chatId)) return;
    
    startNightPhase(chatId);
  }, 45000);
}

// Bot commands
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, messages.welcome);
});

bot.onText(/\/join/, (msg) => {
  if (gameState.gameStarted) {
    return bot.sendMessage(msg.chat.id, messages.gameAlreadyStarted);
  }
  
  const user = { 
    id: msg.from.id, 
    username: msg.from.username || msg.from.first_name 
  };
  
  if (!gameState.players.find(p => p.id === user.id)) {
    gameState.players.push(user);
    bot.sendMessage(msg.chat.id, `✅ @${user.username} انضم إلى اللعبة.`);
  } else {
    bot.sendMessage(msg.chat.id, `@${user.username} أنت منضم بالفعل.`);
  }
});

bot.onText(/\/players/, (msg) => {
  if (gameState.players.length === 0) {
    return bot.sendMessage(msg.chat.id, messages.noPlayers);
  }
  
  const list = gameState.players.map(p => '• @' + p.username).join('\n');
  bot.sendMessage(msg.chat.id, `👥 قائمة اللاعبين:\n${list}`);
});

bot.onText(/\/startgame/, (msg) => {
  if (gameState.gameStarted) {
    return bot.sendMessage(msg.chat.id, messages.gameAlreadyStarted);
  }
  
  if (gameState.players.length < 5) {
    return bot.sendMessage(msg.chat.id, messages.notEnoughPlayers);
  }
  
  gameState.gameStarted = true;
  gameState.alivePlayers = [...gameState.players];
  
  assignRoles();
  
  // Notify players of their roles
  gameState.players.forEach(player => {
    const role = gameState.roles[player.id];
    bot.sendMessage(player.id, `🎭 دورك هو: ${role}`);
    
    // Extra information for werewolves
    if (role === GAME_ROLES.WEREWOLF) {
      const wolves = gameState.players.filter(p => gameState.roles[p.id] === GAME_ROLES.WEREWOLF);
      const wolfNames = wolves.map(w => '@' + w.username).join(', ');
      bot.sendMessage(player.id, `🐺 أنت ذئب. الذئاب معك: ${wolfNames}`);
    }
  });
  
  bot.sendMessage(msg.chat.id, '🎮 بدأت اللعبة! ندخل في مرحلة الليل...');
  
  startNightPhase(msg.chat.id);
});

bot.onText(/\/vote (.+)/, (msg, match) => {
  if (!gameState.gameStarted || gameState.phase !== PHASES.DAY) {
    return bot.sendMessage(msg.from.id, 'لا يمكنك التصويت الآن.');
  }
  
  const voter = gameState.alivePlayers.find(p => p.id === msg.from.id);
  if (!voter) {
    return bot.sendMessage(msg.from.id, 'أنت لست من اللاعبين الأحياء.');
  }
  
  const targetUsername = match[1].replace('@', '');
  const target = gameState.alivePlayers.find(p => p.username === targetUsername);
  
  if (!target) {
    return bot.sendMessage(msg.from.id, 'هذا اللاعب غير موجود أو ميت.');
  }
  
  gameState.votes[voter.id] = targetUsername;
  bot.sendMessage(msg.from.id, `تم التصويت على @${targetUsername}`);
  bot.sendMessage(msg.chat.id, `🗳️ @${voter.username} صوّت!`);
});

bot.onText(/\/kill (.+)/, (msg, match) => {
  if (!gameState.gameStarted || gameState.phase !== PHASES.NIGHT) {
    return;
  }
  
  const player = gameState.alivePlayers.find(p => p.id === msg.from.id);
  if (!player || gameState.roles[player.id] !== GAME_ROLES.WEREWOLF) {
    return;
  }
  
  const targetUsername = match[1].replace('@', '');
  const target = gameState.alivePlayers.find(p => p.username === targetUsername);
  
  if (!target) {
    return bot.sendMessage(msg.from.id, 'هذا اللاعب غير موجود أو ميت.');
  }
  
  if (gameState.roles[target.id] === GAME_ROLES.WEREWOLF) {
    return bot.sendMessage(msg.from.id, 'لا يمكنك قتل ذئب آخر!');
  }
  
  gameState.nightActions.wolfKill = targetUsername;
  
  // Notify all werewolves
  const wolves = gameState.alivePlayers.filter(p => gameState.roles[p.id] === GAME_ROLES.WEREWOLF);
  wolves.forEach(wolf => {
    bot.sendMessage(wolf.id, `🐺 الذئاب اختاروا @${targetUsername} للقتل.`);
  });
});

bot.onText(/\/vision (.+)/, (msg, match) => {
  if (!gameState.gameStarted || gameState.phase !== PHASES.NIGHT) {
    return;
  }
  
  const player = gameState.alivePlayers.find(p => p.id === msg.from.id);
  if (!player || gameState.roles[player.id] !== GAME_ROLES.SEER) {
    return;
  }
  
  const targetUsername = match[1].replace('@', '');
  const target = gameState.alivePlayers.find(p => p.username === targetUsername);
  
  if (!target) {
    return bot.sendMessage(msg.from.id, 'هذا اللاعب غير موجود أو ميت.');
  }
  
  const targetRole = gameState.roles[target.id];
  bot.sendMessage(msg.from.id, `🔮 دور @${targetUsername} هو: ${targetRole}`);
  gameState.nightActions.seerCheck = targetUsername;
});

bot.onText(/\/heal (.+)/, (msg, match) => {
  if (!gameState.gameStarted || gameState.phase !== PHASES.NIGHT) {
    return;
  }
  
  const player = gameState.alivePlayers.find(p => p.id === msg.from.id);
  if (!player || gameState.roles[player.id] !== GAME_ROLES.WITCH) {
    return;
  }
  
  if (gameState.witchSaveUsed) {
    return bot.sendMessage(msg.from.id, 'لقد استخدمت الإنقاذ مسبقًا.');
  }
  
  const targetUsername = match[1].replace('@', '');
  gameState.nightActions.witchSave = targetUsername;
  gameState.witchSaveUsed = true;
  bot.sendMessage(msg.from.id, `🧪 قمت بإنقاذ @${targetUsername}.`);
});

bot.onText(/\/poison (.+)/, (msg, match) => {
  if (!gameState.gameStarted || gameState.phase !== PHASES.NIGHT) {
    return;
  }
  
  const player = gameState.alivePlayers.find(p => p.id === msg.from.id);
  if (!player || gameState.roles[player.id] !== GAME_ROLES.WITCH) {
    return;
  }
  
  if (gameState.witchKillUsed) {
    return bot.sendMessage(msg.from.id, 'لقد استخدمت السم مسبقًا.');
  }
  
  const targetUsername = match[1].replace('@', '');
  const target = gameState.alivePlayers.find(p => p.username === targetUsername);
  
  if (!target) {
    return bot.sendMessage(msg.from.id, 'هذا اللاعب غير موجود أو ميت.');
  }
  
  gameState.nightActions.witchKill = targetUsername;
  gameState.witchKillUsed = true;
  bot.sendMessage(msg.from.id, `🧪 قمت بتسميم @${targetUsername}.`);
});

bot.onText(/\/shoot (.+)/, (msg, match) => {
  const player = gameState.players.find(p => p.id === msg.from.id);
  if (!player || gameState.roles[player.id] !== GAME_ROLES.HUNTER) {
    return;
  }
  
  if (gameState.alivePlayers.find(p => p.id === player.id)) {
    return bot.sendMessage(msg.from.id, 'يمكنك استخدام هذه القدرة فقط عند موتك.');
  }
  
  const targetUsername = match[1].replace('@', '');
  const target = gameState.alivePlayers.find(p => p.username === targetUsername);
  
  if (!target) {
    return bot.sendMessage(msg.from.id, 'هذا اللاعب غير موجود أو ميت.');
  }
  
  gameState.alivePlayers = gameState.alivePlayers.filter(p => p.id !== target.id);
  bot.sendMessage(msg.chat.id, `🏹 الصياد @${player.username} أطلق النار على @${targetUsername} قبل موته!`);
  
  // Check if this ended the game
  checkWinner(msg.chat.id);
});

bot.onText(/\/speak (.+)/, (msg, match) => {
  if (!gameState.gameStarted) return;
  
  const player = gameState.alivePlayers.find(p => p.id === msg.from.id);
  if (!player) {
    return bot.sendMessage(msg.from.id, 'فقط اللاعبون الأحياء يمكنهم التحدث.');
  }
  
  const message = match[1];
  bot.sendMessage(msg.chat.id, `💬 @${player.username} يقول: ${message}`);
});

bot.onText(/\/reset/, (msg) => {
  if (msg.chat.type === 'private') return;
  
  resetGame();
  bot.sendMessage(msg.chat.id, '🔄 تم إعادة تعيين اللعبة. يمكن للاعبين الانضمام من جديد عبر /join');
});

// Handle errors
bot.on('polling_error', (error) => {
  console.log('Polling error:', error);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// Export for testing
module.exports = { bot, resetGame, gameState };
