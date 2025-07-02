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
  shirtColor?: string; // Add this
  isConfirmed?: boolean; // Add this
}

interface GameSettings {
  maxPlayers: number;
  gameMode: string;
}

interface Game {
  id: string;
  name: string;
  players: Player[];
  status: 'waiting' | 'confirming-colors' | 'in-progress' | 'finished'; // Update this
  settings: GameSettings;
  confirmationPhase?: { // Add this
    currentTargetIndex: number;
    confirmations: { [playerId: string]: string }; // playerId -> detected color
    allConfirmed: boolean;
  };
}

interface GameCollection {
  [key: string]: Game;
}

// Set up Express and Socket.IO
const app = express();

// Express middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware for Express routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

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

  socket.on('startColorConfirmation', (gameId: string) => {
    try {
      const game = games[gameId];
      if (!game) {
        console.log(`❓ Player ${socket.id} tried to start confirmation in non-existent game ${gameId}`);
        return;
      }
      
      const player = game.players.find(p => p.id === socket.id);
      if (!player || !player.isHost) {
        console.log(`🚫 Non-host player ${socket.id} tried to start color confirmation ${gameId}`);
        socket.emit('error', 'Only the host can start color confirmation');
        return;
      }
      
      if (game.players.length < 2) {
        socket.emit('error', 'Need at least 2 players for color confirmation');
        return;
      }
      
      console.log(`🎨 Starting color confirmation phase for game ${gameId}`);
      game.status = 'confirming-colors';
      game.confirmationPhase = {
        currentTargetIndex: 0,
        confirmations: {},
        allConfirmed: false
      };
      
      // Reset all player confirmations
      game.players.forEach(p => {
        p.shirtColor = undefined;
        p.isConfirmed = false;
      });
      
      io.to(gameId).emit('colorConfirmationStarted', {
        gameState: game,
        currentTarget: game.players[0]
      });
      logGameState(gameId);
    } catch (error) {
      console.error('❌ Error starting color confirmation:', error);
      socket.emit('error', 'Failed to start color confirmation');
    }
  });

  socket.on('submitColorConfirmation', (data: { gameId: string; targetPlayerId: string; detectedColor: string }) => {
    try {
      const game = games[data.gameId];
      if (!game || game.status !== 'confirming-colors' || !game.confirmationPhase) {
        socket.emit('error', 'Game not in color confirmation phase');
        return;
      }
      
      const confirmingPlayer = game.players.find(p => p.id === socket.id);
      const targetPlayer = game.players.find(p => p.id === data.targetPlayerId);
      
      if (!confirmingPlayer || !targetPlayer) {
        socket.emit('error', 'Player not found');
        return;
      }
      
      if (confirmingPlayer.id === targetPlayer.id) {
        socket.emit('error', 'Cannot confirm your own shirt color');
        return;
      }
      
      // Store the confirmation
      const confirmationKey = `${socket.id}->${data.targetPlayerId}`;
      game.confirmationPhase.confirmations[confirmationKey] = data.detectedColor;
      
      console.log(`🎨 ${confirmingPlayer.name} confirmed ${targetPlayer.name}'s shirt as ${data.detectedColor}`);
      
      // Check if all other players have confirmed this target
      const otherPlayers = game.players.filter(p => p.id !== data.targetPlayerId);
      const confirmationsForTarget = otherPlayers.filter(p => 
        game.confirmationPhase!.confirmations[`${p.id}->${data.targetPlayerId}`]
      );
      
      if (confirmationsForTarget.length === otherPlayers.length) {
        // All players have confirmed this target, determine consensus
        const colorCounts: { [color: string]: number } = {};
        otherPlayers.forEach(p => {
          const color = game.confirmationPhase!.confirmations[`${p.id}->${data.targetPlayerId}`];
          colorCounts[color] = (colorCounts[color] || 0) + 1;
        });
        
        // Find the most common color
        const consensusColor = Object.entries(colorCounts)
          .reduce((a, b) => colorCounts[a[0]] > colorCounts[b[0]] ? a : b)[0];
        
        targetPlayer.shirtColor = consensusColor;
        targetPlayer.isConfirmed = true;
        
        console.log(`✅ Consensus reached for ${targetPlayer.name}: ${consensusColor}`);
        
        // Move to next player or finish
        game.confirmationPhase.currentTargetIndex++;
        
        if (game.confirmationPhase.currentTargetIndex >= game.players.length) {
          // All players confirmed
          game.confirmationPhase.allConfirmed = true;
          game.status = 'waiting'; // Ready to start actual game
          console.log(`🎉 All players' shirt colors confirmed for game ${data.gameId}`);
          
          io.to(data.gameId).emit('allColorsConfirmed', {
            gameState: game,
            playerColors: game.players.map(p => ({ 
              name: p.name, 
              color: p.shirtColor 
            }))
          });
        } else {
          // Move to next target
          const nextTarget = game.players[game.confirmationPhase.currentTargetIndex];
          io.to(data.gameId).emit('nextColorTarget', {
            gameState: game,
            currentTarget: nextTarget
          });
        }
      } else {
        // Still waiting for more confirmations
        io.to(data.gameId).emit('colorConfirmationUpdate', {
          gameState: game,
          confirmationsReceived: confirmationsForTarget.length,
          confirmationsNeeded: otherPlayers.length
        });
      }
      
      logGameState(data.gameId);
    } catch (error) {
      console.error('❌ Error submitting color confirmation:', error);
      socket.emit('error', 'Failed to submit color confirmation');
    }
  });

  socket.on('skipColorConfirmation', (gameId: string) => {
    try {
      const game = games[gameId];
      if (!game || game.status !== 'confirming-colors') {
        socket.emit('error', 'Game not in color confirmation phase');
        return;
      }
      
      const player = game.players.find(p => p.id === socket.id);
      if (!player || !player.isHost) {
        socket.emit('error', 'Only the host can skip color confirmation');
        return;
      }
      
      console.log(`⏭️ Host ${player.name} skipped color confirmation for game ${gameId}`);
      game.status = 'waiting';
      game.confirmationPhase = undefined;
      
      // Clear any partial confirmations
      game.players.forEach(p => {
        p.shirtColor = undefined;
        p.isConfirmed = false;
      });
      
      io.to(gameId).emit('colorConfirmationSkipped', { gameState: game });
      logGameState(gameId);
    } catch (error) {
      console.error('❌ Error skipping color confirmation:', error);
      socket.emit('error', 'Failed to skip color confirmation');
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔴 Client disconnected: ${socket.id}`);
    removePlayerFromGames(socket.id);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    games: Object.keys(games).length
  });
});

// API endpoint to get games list
app.get('/api/games', (req, res) => {
  const availableGames = Object.values(games)
    .filter(g => g.status === 'waiting');
  res.json(availableGames);
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 Backend server ready on http://localhost:${PORT}`);
  console.log(`🎮 Waiting for connections...\n`);
  console.log(`📊 Health check available at http://localhost:${PORT}/health`);
});