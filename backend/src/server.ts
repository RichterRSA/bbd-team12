import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

// Define types for our game system
interface Player {
  id: string;
  name: string;
  isHost: boolean;
  team: 'red' | 'blue';
  health: number;
}

interface GameSettings {
  maxPlayers: number;
  gameMode: string;
}

interface Game {
  id: string;
  name: string;
  players: Player[];
  status: 'waiting' | 'in-progress' | 'finished';
  settings: GameSettings;
}

interface GameCollection {
  [key: string]: Game;
}

// Set up Express and Socket.IO
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["*"],
    credentials: false
  },
});

// Store game states
const games: GameCollection = {};

// Helper Functions
function broadcastGameList(): void {
  const availableGames = Object.values(games)
    .filter(g => g.status === 'waiting');
  console.log(`📢 Broadcasting updated game list: ${availableGames.length} available games`);
  io.emit('gameList', availableGames);
}

function logGameState(gameId: string): void {
  const game = games[gameId];
  if (!game) {
    console.log(`❓ Game ${gameId} not found`);
    return;
  }
  
  const redTeam = game.players.filter(p => p.team === 'red');
  const blueTeam = game.players.filter(p => p.team === 'blue');
  
  console.log('\n📊 GAME STATE UPDATE ------------');
  console.log(`🎮 Game: ${game.name} (${gameId})`);
  console.log(`📋 Status: ${game.status}`);
  console.log(`👥 Players: ${game.players.length}/${game.settings.maxPlayers}`);
  console.log(`🔴 Red Team (${redTeam.length}): ${redTeam.map(p => `${p.name}${p.isHost ? '👑' : ''}`).join(', ')}`);
  console.log(`🔵 Blue Team (${blueTeam.length}): ${blueTeam.map(p => `${p.name}${p.isHost ? '👑' : ''}`).join(', ')}`);
  console.log('----------------------------------\n');
}

function removePlayerFromGames(socketId: string): void {
  for (const gameId in games) {
    const game = games[gameId];
    const player = game.players.find(p => p.id === socketId);
    
    if (player) {
      console.log(`👋 Player ${player.name} (${socketId}) disconnected from game ${gameId}`);
      
      const playerIndex = game.players.findIndex(p => p.id === socketId);
      game.players.splice(playerIndex, 1);
      
      // Handle empty games
      if (game.players.length === 0) {
        console.log(`🗑️ Deleting empty game ${gameId}`);
        delete games[gameId];
      } 
      // Reassign host if needed
      else if (!game.players.some(p => p.isHost)) {
        const newHost = game.players[0];
        newHost.isHost = true;
        console.log(`👑 Host left, new host assigned: ${newHost.name} in game ${gameId}`);
      }
      
      // Notify remaining players
      io.to(gameId).emit('gameStateUpdate', game);
      logGameState(gameId);
      broadcastGameList();
    }
  }
}

// Socket.IO event handlers
io.on('connection', (socket: Socket) => {
  console.log(`🟢 New client connected: ${socket.id}`);
  
  // Send current game list to new client
  const availableGames = Object.values(games).filter(g => g.status === 'waiting');
  console.log(`📤 Sending game list to new client (${availableGames.length} games)`);
  socket.emit('gameList', availableGames);

  socket.on('requestGameList', () => {
    console.log(`🔄 Client ${socket.id} requested game list refresh`);
    const availableGames = Object.values(games).filter(g => g.status === 'waiting');
    socket.emit('gameList', availableGames);
  });

  socket.on('createGame', (data: { playerName: string; gameSettings: GameSettings }) => {
    try {
      console.log(`🎮 Creating game for ${data.playerName} (${socket.id})`);
      const gameId = 'game_' + Math.random().toString(36).substring(2, 9);
      const game: Game = {
        id: gameId,
        name: `${data.playerName}'s Game`,
        players: [{
          id: socket.id,
          name: data.playerName,
          isHost: true,
          team: 'red',
          health: 100
        }],
        status: 'waiting',
        settings: data.gameSettings,
      };
      
      games[gameId] = game;
      socket.join(gameId);
      console.log(`✅ Game created: ${gameId} by ${data.playerName} (${socket.id})`);
      console.log(`💾 Current games: ${Object.keys(games).length}`);
      
      socket.emit('gameCreated', { gameId, isHost: true, gameState: game });
      logGameState(gameId);
      broadcastGameList();
    } catch (error) {
      console.error('❌ Error creating game:', error);
      socket.emit('error', 'Failed to create game');
    }
  });

  socket.on('joinGame', (data: { gameId: string; playerName: string }) => {
    try {
      console.log(`🚪 ${data.playerName} (${socket.id}) trying to join game ${data.gameId}`);
      const game = games[data.gameId];
      
      if (!game) {
        console.log(`❌ Game not found: ${data.gameId}`);
        socket.emit('error', 'Game not found');
        return;
      }
      
      if (game.status !== 'waiting') {
        console.log(`❌ Game ${data.gameId} already started, can't join`);
        socket.emit('error', 'Game already started');
        return;
      }
      
      if (game.players.length >= game.settings.maxPlayers) {
        console.log(`❌ Game ${data.gameId} is full (${game.players.length}/${game.settings.maxPlayers})`);
        socket.emit('error', 'Game is full');
        return;
      }
      
      // Determine team balance (try to keep teams even)
      const redCount = game.players.filter(p => p.team === 'red').length;
      const blueCount = game.players.filter(p => p.team === 'blue').length;
      const team = redCount <= blueCount ? 'red' : 'blue';
      
      console.log(`⚖️ Assigning player to ${team} team (Red: ${redCount}, Blue: ${blueCount})`);
      
      const player: Player = {
        id: socket.id,
        name: data.playerName,
        isHost: false,
        team,
        health: 100
      };
      
      game.players.push(player);
      socket.join(data.gameId);
      console.log(`✅ ${data.playerName} joined game ${data.gameId} on ${team} team`);
      
      socket.emit('gameJoined', { gameId: data.gameId, isHost: false, gameState: game });
      io.to(data.gameId).emit('gameStateUpdate', game);
      logGameState(data.gameId);
      broadcastGameList();
    } catch (error) {
      console.error('❌ Error joining game:', error);
      socket.emit('error', 'Failed to join game');
    }
  });

  socket.on('leaveGame', (gameId: string) => {
    try {
      const game = games[gameId];
      if (!game) {
        console.log(`❓ Player ${socket.id} tried to leave non-existent game ${gameId}`);
        return;
      }
      
      const player = game.players.find(p => p.id === socket.id);
      if (!player) {
        console.log(`❓ Player ${socket.id} not found in game ${gameId}`);
        return;
      }
      
      console.log(`🚪 Player ${player.name} (${socket.id}) leaving game ${gameId}`);
      
      // Leave the socket.io room
      socket.leave(gameId);
      console.log(`🔌 Socket ${socket.id} left room ${gameId}`);
      
      // Remove player from game
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      game.players.splice(playerIndex, 1);
      
      if (game.players.length === 0) {
        console.log(`🗑️ Deleting empty game ${gameId}`);
        delete games[gameId];
        broadcastGameList();
        return;
      }
      
      // Reassign host if needed
      if (!game.players.some(p => p.isHost)) {
        const newHost = game.players[0];
        newHost.isHost = true;
        console.log(`👑 New host assigned: ${newHost.name} in game ${gameId}`);
      }
      
      io.to(gameId).emit('gameStateUpdate', game);
      logGameState(gameId);
      broadcastGameList();
    } catch (error) {
      console.error('❌ Error leaving game:', error);
    }
  });

  socket.on('switchTeam', (gameId: string) => {
    try {
      const game = games[gameId];
      if (!game) {
        console.log(`❓ Player ${socket.id} tried to switch team in non-existent game ${gameId}`);
        return;
      }
      
      const player = game.players.find(p => p.id === socket.id);
      if (!player) {
        console.log(`❓ Player ${socket.id} not found in game ${gameId}`);
        return;
      }
      
      const oldTeam = player.team;
      player.team = player.team === 'red' ? 'blue' : 'red';
      
      console.log(`🔄 Team switch: ${player.name} switched from ${oldTeam} to ${player.team} in game ${gameId}`);
      
      // Log team balance after switch
      const redCount = game.players.filter(p => p.team === 'red').length;
      const blueCount = game.players.filter(p => p.team === 'blue').length;
      console.log(`⚖️ New team balance - Red: ${redCount}, Blue: ${blueCount}`);
      
      // Update game state for all players
      io.to(gameId).emit('gameStateUpdate', game);
      logGameState(gameId);
    } catch (error) {
      console.error('❌ Error switching team:', error);
    }
  });

  socket.on('startGame', (gameId: string) => {
    try {
      const game = games[gameId];
      if (!game) {
        console.log(`❓ Player ${socket.id} tried to start non-existent game ${gameId}`);
        return;
      }
      
      const player = game.players.find(p => p.id === socket.id);
      if (!player || !player.isHost) {
        console.log(`🚫 Non-host player ${socket.id} tried to start game ${gameId}`);
        socket.emit('error', 'Only the host can start the game');
        return;
      }
      
      console.log(`🎬 Starting game ${gameId} by host ${player.name}`);
      game.status = 'in-progress';
      
      io.to(gameId).emit('gameStateUpdate', game);
      logGameState(gameId);
      broadcastGameList(); // Remove from available games list
    } catch (error) {
      console.error('❌ Error starting game:', error);
      socket.emit('error', 'Failed to start game');
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
    removePlayerFromGames(socket.id);
  });
});

const PORT = 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Backend server ready on http://localhost:${PORT}`);
  console.log(`🎮 Waiting for connections...\n`);
});