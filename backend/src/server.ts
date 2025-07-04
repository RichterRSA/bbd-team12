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
  points: number; // Add this
  lives: number; // Add this
  powerUps: { type: string; active: boolean }[]; // Add this
  weapon: { type: string; damage: number; cost: number } | null; // Add this
  status: 'alive' | 'dead'; // Add this
  shirtColor?: string;
  isConfirmed?: boolean;
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

function removePlayerFromGame(socketId: string, gameId: string): void {
  const game = games[gameId];
  if (!game) {
    console.log(`🚫 Game ${gameId} not found when trying to remove player with socket ID ${socketId}`);
    return;
  }
  
  const playerIndex = game.players.findIndex(p => p.id === socketId);
  if (playerIndex === -1) {
    console.log(`🚫 Player with socket ID ${socketId} not found in game ${gameId}`);
    return;
  }
  
  const player = game.players[playerIndex];
  console.log(`👋 Removing player ${player.name} (${socketId}) from game ${gameId}`);      // Notify other players about the disconnection before removing
      io.to(gameId).emit('playerDisconnected', {
        playerName: player.name,
        playerId: player.id
      });

      // Remove the player
      game.players.splice(playerIndex, 1);
  
  // Handle empty games
  if (game.players.length === 0) {
    console.log(`🗑️ Deleting empty game ${gameId}`);
    delete games[gameId];
    broadcastGameList();
  } 
  // Reassign host if needed
  else if (!game.players.some(p => p.isHost)) {
    const newHost = game.players[0];
    newHost.isHost = true;
    console.log(`👑 Host left, new host assigned: ${newHost.name} in game ${gameId}`);
    
    // Notify remaining players
    io.to(gameId).emit('gameStateUpdate', game);
    io.to(gameId).emit('notification', `${player.name} disconnected. ${newHost.name} is now the host.`);
  } else {
    // Just notify about player leaving and update game state
    io.to(gameId).emit('gameStateUpdate', game);
    io.to(gameId).emit('notification', `${player.name} disconnected.`);
  }
  
  if (typeof logGameState === 'function') {
    logGameState(gameId);
  } else {
    console.log(`📊 Game state for ${gameId} after player removal: ${game.players.length} players, status: ${game.status}`);
  }
}

// Update the original function to use the new one
function removePlayerFromGames(socketId: string): void {
  for (const gameId in games) {
    const game = games[gameId];
    const player = game.players.find(p => p.id === socketId);
    
    if (player) {
      console.log(`👋 Player ${player.name} (${socketId}) disconnected from game ${gameId} (status: ${game.status}) - removing immediately`);
      
      // Always remove the player immediately, regardless of game status
      removePlayerFromGame(socketId, gameId);
      
      // Notify other players about the disconnection
      io.to(gameId).emit('playerDisconnected', {
        playerName: player.name,
        playerId: player.id
      });
      io.to(gameId).emit('notification', `${player.name} disconnected and was removed from the game`);
    }
  }
  
  // Always broadcast updated game list after potential removals
  broadcastGameList();
}

// Format color to ensure it's in a consistent format (RGB string)
function formatColorValue(color: any): string {
  if (!color) return '';
  
  if (typeof color === 'object') {
    // If it's an RGB object
    if (color.r !== undefined && color.g !== undefined && color.b !== undefined) {
      return `rgb(${color.r},${color.g},${color.b})`;
    }
    
    // If it has a color property
    if (color.color) {
      return formatColorValue(color.color);
    }
    
    // Just stringify it
    try {
      return JSON.stringify(color);
    } catch (e) {
      return String(color);
    }
  }
  
  return String(color);
}

// Socket.IO event handlers
io.on('connection', (socket: Socket) => {
  console.log(`🟢 New client connected: ${socket.id}`);
  
  // Send current game list to new client
  const availableGames = Object.values(games).filter(g => g.status === 'waiting');
  console.log(`📤 Sending game list to new client (${availableGames.length} games)`);
  socket.emit('gameList', availableGames);

  // Handle socket disconnection
  socket.on('disconnect', (reason: string) => {
    console.log(`🔴 Client disconnected: ${socket.id} (reason: ${reason})`);
    
    // Remove player from all games they might be in
    removePlayerFromGames(socket.id);
    
    // Log current game count after cleanup
    console.log(`📊 Games after disconnect cleanup: ${Object.keys(games).length}`);
  });

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
          health: 100,
          points: 0,
          lives: 3,
          powerUps: [],
          weapon: null,
          status: 'alive'
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
        health: 100,
        points: 0,
        lives: 3,
        powerUps: [],
        weapon: null,
        status: 'alive'
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

  socket.on('submitColorConfirmation', (data: { gameId: string; targetPlayerId: string; detectedColor: string | any }) => {
    try {
      const game = games[data.gameId];
      if (!game || game.status !== 'confirming-colors' || !game.confirmationPhase) {
        socket.emit('error', 'Game not in color confirmation phase');
        return;
      }
      
      // Format the color consistently
      data.detectedColor = formatColorValue(data.detectedColor);
      
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
        
        targetPlayer.shirtColor = formatColorValue(consensusColor);
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

  // Color confirmation cannot be skipped - removed skip functionality

  socket.on('requestGameState', (gameId: string) => {
    try {
      console.log(`📡 Player ${socket.id} requesting game state for game ${gameId}`);
      console.log(`🔍 Available games: ${Object.keys(games).join(', ')}`);
      
      if (!gameId) {
        console.log(`❌ Invalid gameId: ${gameId}`);
        socket.emit('error', 'Invalid game ID');
        return;
      }
      
      const game = games[gameId];
      if (!game) {
        console.log(`❌ Game ${gameId} not found. Available games:`, Object.keys(games));
        socket.emit('error', 'Game not found or may have ended');
        return;
      }
      
      // Check if this player is already in the game
      const existingPlayer = game.players.find(p => p.id === socket.id);
      if (!existingPlayer) {
        console.log(`❓ Player ${socket.id} not found in game ${gameId}. Players in game:`, game.players.map(p => `${p.name}(${p.id})`));
        socket.emit('error', 'You are not a player in this game.');
        return;
      }
      
      // Join the socket room and send current game state
      socket.join(gameId);
      console.log(`✅ Player ${existingPlayer.name} (${socket.id}) reconnected to game ${gameId}`);
      
      socket.emit('gameStateUpdate', game);
      
      // Notify player of successful reconnection
      socket.emit('notification', 'Successfully reconnected to the game');
      
      logGameState(gameId);
    } catch (error) {
      console.error('❌ Error requesting game state:', error);
      socket.emit('error', 'Failed to get game state');
    }
  });

  // Handle socket errors
  socket.on('error', (error) => {
    console.error(`🚨 Socket error for ${socket.id}:`, error);
    
    // Notify client about the error
    try {
      socket.emit('socketError', {
        message: 'A connection error occurred', 
        code: error.message || 'unknown_error'
      });
    } catch (e) {
      console.error('Failed to emit error notification:', e);
    }
  });
  
  // Handle ping from client (useful for connection testing)
  socket.on('ping', (callback) => {
    if (typeof callback === 'function') {
      callback({ time: Date.now(), status: 'ok' });
    } else {
      socket.emit('pong', { time: Date.now(), status: 'ok' });
    }
  });
  
  // Handle explicit connection test from client
  socket.on('testConnection', (data, callback) => {
    console.log(`🔄 Connection test from client ${socket.id}`);
    
    const response = {
      success: true,
      socketId: socket.id,
      timestamp: Date.now(),
      message: 'Connection is working properly'
    };
    
    if (typeof callback === 'function') {
      callback(response);
    } else {
      socket.emit('connectionTestResult', response);
    }
  });
  //Functions to handle player damage 
socket.on('playerDamage', (data: { gameId: string; targetPlayerId: string; attackerId?: string}) => {
    try {
        const game = games[data.gameId];
        if(!game || game.status !== 'in-progress'){
            return;
        }

        const targetPlayer = game.players.find(p => p.id === data.targetPlayerId);
        if(!targetPlayer){
            return;
        }

        // Find the attacker (the one who sent this damage event)
        const attackerId = data.attackerId || socket.id;
        const attacker = game.players.find(p => p.id === attackerId);
        
        // Check if either player is dead
        if (!attacker || attacker.status === 'dead') {
            return;
        }

        if (targetPlayer.status === 'dead') {
            socket.emit('notification', {
                message: '💀 Target is already eliminated!',
                type: 'error'
            });
            return;
        }

        // Check friendly fire
        if (targetPlayer.team === attacker.team) {
            socket.emit('notification', {
                message: '⚠️ Friendly fire is not allowed!',
                type: 'error'
            });
            return;
        }

        // Calculate damage (can be modified based on weapons/powerups later)
        const damage = 25;

        // Update target player's health
        targetPlayer.health = Math.max(0, targetPlayer.health - damage);

        // Emit damage event to all players
        io.to(game.id).emit('playerHealthUpdate', {
            playerId: targetPlayer.id,
            health: targetPlayer.health
        });

        // Check if player is killed
        if (targetPlayer.health <= 0) {
            targetPlayer.status = 'dead';
            targetPlayer.lives--;

            // Award points to attacker
            attacker.points += 100;
            io.to(game.id).emit('playerScoreUpdate', {
                playerId: attacker.id,
                points: attacker.points
            });

            // Notify about the kill
            io.to(game.id).emit('playerEliminated', {
                playerId: targetPlayer.id,
                playerName: targetPlayer.name,
                eliminatedBy: attacker.name
            });

            // Emit death event with remaining lives
            io.to(game.id).emit('playerDeath', {
                playerId: targetPlayer.id,
                lives: targetPlayer.lives
            });

            // If player has remaining lives, schedule respawn
            if (targetPlayer.lives > 0) {
                setTimeout(() => {
                    if (game.status === 'in-progress' && targetPlayer.lives > 0) {
                        // Respawn player
                        targetPlayer.status = 'alive';
                        targetPlayer.health = 100;
                        
                        // Notify about respawn
                        io.to(game.id).emit('playerRespawn', {
                            playerId: targetPlayer.id
                        });
                        
                        // Update health
                        io.to(game.id).emit('playerHealthUpdate', {
                            playerId: targetPlayer.id,
                            health: targetPlayer.health
                        });
                    }
                }, 10000); // 10 second respawn timer
            }
        }

        // Check if all players on a team are permanently eliminated (no lives left)
        const redTeam = game.players.filter(p => p.team === 'red');
        const blueTeam = game.players.filter(p => p.team === 'blue');
        
        const redTeamPermanentlyEliminated = redTeam.every(p => p.status === 'dead' && p.lives <= 0);
        const blueTeamPermanentlyEliminated = blueTeam.every(p => p.status === 'dead' && p.lives <= 0);
        
        if (redTeamPermanentlyEliminated || blueTeamPermanentlyEliminated) {
            // Get the winning team
            const winningTeam = redTeamPermanentlyEliminated ? 'blue' : 'red';
            
            // Find the top scoring player
            const topPlayer = game.players.reduce((highest, current) => 
                current.points > highest.points ? current : highest
            , game.players[0]);
            
            // Emit game won event to all players
            io.to(game.id).emit('gameWon', {
                winningTeam,
                topPlayer: {
                    name: topPlayer.name,
                    points: topPlayer.points
                }
            });
            
            // Update game status
            game.status = 'finished';
            broadcastGameList();
        }

        logGameState(game.id);
    } catch (error) {
        console.error('Error handling player damage:', error);
    }
});

}); // End of io.on('connection')


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