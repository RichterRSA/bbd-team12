"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { Camera, LogOut, Menu, Info } from 'lucide-react';
import Webcam from "react-webcam";
import * as poseDetection from '@tensorflow-models/pose-detection';
import { Socket } from 'socket.io-client';
import { isMobileDevice, requestCameraPermission } from '@/utils/deviceUtils';
import { GameState, Player } from './types';
import { getCrosshairTorsoColor, isPersonInCrosshair } from '@/utils/crosshairUtils';
import { rgbToHsv, colorDistance } from '@/utils/colorDetection';

interface GameViewProps {
  gameState: GameState;
  currentPlayer: Player | undefined;
  playerName: string;
  webcamRef: React.RefObject<Webcam | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hasCameraPermission: boolean | null;
  setHasCameraPermission: (permission: boolean) => void;
  currentPoses: poseDetection.Pose[];
  setShowConfirmation: (show: boolean) => void;
  showNotification: (message: string, type: 'success' | 'info' | 'error') => void;
  socket: Socket | null;
}

export const GameView: React.FC<GameViewProps> = ({
  gameState,
  currentPlayer,
  playerName,
  webcamRef,
  canvasRef,
  hasCameraPermission,
  setHasCameraPermission,
  currentPoses,
  setShowConfirmation,
  showNotification,
  socket,
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [playerHealth, setPlayerHealth] = useState(currentPlayer?.health || 100);
  const [playerScore, setPlayerScore] = useState(currentPlayer?.points || 0);
  const [lastShotTime, setLastShotTime] = useState(0);
  const SHOOT_COOLDOWN = 100; // 0.1 second cooldown between shots
  const [isShooting, setIsShooting] = useState(false);
  const [screenFlash, setScreenFlash] = useState<'none' | 'damage' | 'hit' | 'shoot'>('none');
  const [healthDelta, setHealthDelta] = useState<number | null>(null);
  const [scoreDelta, setScoreDelta] = useState<number | null>(null);
  const [respawnCountdown, setRespawnCountdown] = useState<number | null>(null);
  const [topPlayer, setTopPlayer] = useState<Player | null>(null);

  // Function to find the top scoring player
  const getTopPlayer = useCallback(() => {
    if (!gameState.players || gameState.players.length === 0) return null;
    return [...gameState.players].sort((a, b) => b.points - a.points)[0];
  }, [gameState.players]);

  useEffect(() => {
    setTopPlayer(getTopPlayer());
  }, [gameState.players, getTopPlayer]);

  // Update socket event listeners for player death and respawn
  useEffect(() => {
    if (!socket) return;

    socket.on('playerDeath', (data: { playerId: string; lives: number }) => {
      if (currentPlayer && data.playerId === currentPlayer.id) {
        if (data.lives > 0) {
          setRespawnCountdown(10);
          // Start countdown
          const interval = setInterval(() => {
            setRespawnCountdown(prev => {
              if (prev === null || prev <= 1) {
                clearInterval(interval);
                return null;
              }
              return prev - 1;
            });
          }, 1000);
        }
      }
    });

    socket.on('playerRespawn', (data: { playerId: string }) => {
      if (currentPlayer && data.playerId === currentPlayer.id) {
        setRespawnCountdown(null);
        showNotification('🔄 You have respawned!', 'success');
        // Strong vibration for respawn
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }
      }
    });

    return () => {
      socket.off('playerDeath');
      socket.off('playerRespawn');
    };
  }, [socket, currentPlayer, showNotification]);

  // Function to play the shooting sound
  const playShootSound = useCallback(() => {
    try {
      const audio = new Audio('/sounds/lasershot.wav');
      audio.volume = 0.5;
      audio.play().catch(err => {
        console.error('Failed to play shoot sound:', err);
        // Try alternative sound
        const altAudio = new Audio('/sounds/singleshot.mp3');
        altAudio.volume = 0.5;
        altAudio.play().catch(console.error);
      });
    } catch (error) {
      console.error('Error creating shoot sound:', error);
    }
  }, []);

  // Function to play hit sound
  const playHitSound = useCallback(() => {
    try {
      const audio = new Audio('/sounds/lasershot2.mp3');
      audio.volume = 0.7;
      audio.play().catch(err => {
        console.error('Failed to play hit sound:', err);
      });
    } catch (error) {
      console.error('Error creating hit sound:', error);
    }
  }, []);

  // Function to play damage taken sound
  const playDamageTakenSound = useCallback(() => {
    try {
      const audio = new Audio('/sounds/lasershot.wav');
      audio.volume = 0.8;
      audio.play().catch(err => {
        console.error('Failed to play damage sound:', err);
      });
    } catch (error) {
      console.error('Error creating damage sound:', error);
    }
  }, []);

  // Function to handle shooting
  const handleShoot = useCallback(() => {
    if (currentPlayer?.status === 'dead') {
      showNotification('💀 You are eliminated!', 'error');
      return;
    }

    const now = Date.now();
    if (now - lastShotTime < SHOOT_COOLDOWN) {
      showNotification('🕒 Laser cooling down...', 'info');
      return;
    }

    // Check if player is in a valid state to shoot
    if (!currentPlayer) {
      showNotification('⚠️ Player not found', 'error');
      return;
    }

    const state = getCrosshairState();
    
    // Always play sound and show animation when attempting to shoot
    setLastShotTime(now);
    playShootSound();
    setIsShooting(true);
    setScreenFlash('shoot');

    if (!state.isTargetDetected) {
      showNotification('❌ No target in crosshair', 'info');
      return;
    }

    if (state.debugInfo.playerMatches.length === 0) {
      showNotification('🎯 Missed! No player detected', 'info');
      return;
    }

    // Find the closest matching player
    const closestMatch = state.debugInfo.playerMatches.reduce((prev, current) => 
      prev.distance < current.distance ? prev : current
    );
    
    // Only deal damage if the match is close enough and it's an enemy player
    if (closestMatch.distance < 30) {
      if (closestMatch.player.team === currentPlayer.team) {
        showNotification('⚠️ Friendly fire is not allowed!', 'error');
        return;
      }
      
      if (closestMatch.player.status === 'dead') {
        showNotification('💀 Target is already eliminated!', 'info');
        return;
      }      // Emit the damage event to the server
      if (socket && gameState.id && closestMatch.player.id && currentPlayer) {
        socket.emit('playerDamage', {
          gameId: gameState.id,
          targetPlayerId: closestMatch.player.id,
          attackerId: currentPlayer.id
        });
        showNotification(`🎯 Shot fired at ${closestMatch.player.name}!`, 'success');
      }
    } else {
      showNotification('📏 Target too far or not clear enough', 'info');
    }
  }, [lastShotTime, socket, gameState?.id, currentPlayer, showNotification, playShootSound]);

  // Add shoot animation cleanup
  useEffect(() => {
    if (isShooting) {
      const timer = setTimeout(() => setIsShooting(false), 200);
      return () => clearTimeout(timer);
    }
  }, [isShooting]);

  // Add screen flash cleanup
  useEffect(() => {
    if (screenFlash !== 'none') {
      const timer = setTimeout(() => setScreenFlash('none'), 500);
      return () => clearTimeout(timer);
    }
  }, [screenFlash]);

  // Add health delta cleanup
  useEffect(() => {
    if (healthDelta !== null) {
      const timer = setTimeout(() => setHealthDelta(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [healthDelta]);

  // Add score delta cleanup
  useEffect(() => {
    if (scoreDelta !== null) {
      const timer = setTimeout(() => setScoreDelta(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [scoreDelta]);

  // Update the crosshair state logic to include shooting animation
  const getCrosshairState = useCallback(() => {
    if (!currentPoses || currentPoses.length === 0 || !webcamRef.current?.video) {
      return { 
        isTargetDetected: false, 
        color: "rgba(128, 128, 128, 0.6)",
        debugInfo: { detectedColor: null, playerMatches: [] },
        isShooting: false
      };
    }

    const video = webcamRef.current.video;

    // Check if any person is in the crosshair with high confidence
    const personInCrosshair = currentPoses.some(pose => {
      // Ensure we have enough keypoints for reliable detection
      const validKeypoints = pose.keypoints.filter(kp => kp.score && kp.score > 0.5);
      return validKeypoints.length >= 5 && isPersonInCrosshair(pose, video.videoWidth, video.videoHeight, 80);
    });

    if (!personInCrosshair) {
      return { 
        isTargetDetected: false, 
        color: "rgba(128, 128, 128, 0.6)",
        debugInfo: { detectedColor: null, playerMatches: [] },
        isShooting: false
      };
    }

    // Get the color of the person in crosshair
    const colorResult = getCrosshairTorsoColor(currentPoses, webcamRef, video.videoWidth, video.videoHeight, 60);
    
    if (!colorResult) {
      return { 
        isTargetDetected: true, 
        color: "rgba(255, 255, 0, 0.6)",
        debugInfo: { detectedColor: null, playerMatches: [] },
        isShooting: false
      };
    }

    // Analyze color matches with all players' shirt colors
    const playerMatches = gameState.players?.map(player => {
      // Use player's confirmed shirt color if available, otherwise use team color as fallback
      const playerColor = player.shirtColor || (player.team === 'red' ? 'rgb(220, 50, 50)' : 'rgb(50, 50, 220)');
      const match = isColorMatch(colorResult.color, playerColor);
      
      return {
        player,
        distance: colorDistance(
          parseRgb(colorResult.color) || { r: 0, g: 0, b: 0 },
          parseRgb(playerColor) || { r: 0, g: 0, b: 0 }
        ),
        match
      };
    }) || [];

    // Check if any player color matches
    const hasPlayerMatch = playerMatches.some(pm => pm.match);

    return {
      isTargetDetected: true,
      color: hasPlayerMatch ? "rgba(0, 255, 0, 0.6)" : "rgba(255, 255, 0, 0.6)", // Green if player detected, yellow if unknown person
      debugInfo: {
        detectedColor: colorResult.color,
        playerMatches
      },
      isShooting
    };
  }, [currentPoses, webcamRef, gameState.players, isShooting]);

  const parseRgb = (color: string) => {
    const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (match) {
      return {
        r: parseInt(match[1]),
        g: parseInt(match[2]),
        b: parseInt(match[3])
      };
    }
    return null;
  };

  // Function to determine if a color is close enough to be considered a match
  const isColorMatch = (colorA: string, colorB: string) => {
    const parseRgb = (color: string) => {
      const match = color.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (match) {
        return {
          r: parseInt(match[1]),
          g: parseInt(match[2]),
          b: parseInt(match[3])
        };
      }
      return null;
    };

    const rgbA = parseRgb(colorA);
    const rgbB = parseRgb(colorB);

    if (!rgbA || !rgbB) return false;

    // Calculate color difference
    const distance = colorDistance(rgbA, rgbB);
    return distance < 30; // Increased threshold for more lenient color matching
  };

  // Listen for game updates
  useEffect(() => {
    if (!socket) return;

    // Listen for health updates
    socket.on('playerHealthUpdate', (data: { playerId: string; health: number }) => {
      if (currentPlayer && data.playerId === currentPlayer.id) {
        console.log('Health update received:', data);
        const oldHealth = playerHealth;
        const newHealth = Math.max(0, data.health);
        setPlayerHealth(newHealth);
        
        // Show health change animation
        const delta = newHealth - oldHealth;
        if (delta !== 0) {
          setHealthDelta(delta);
          
          if (delta < 0) {
            // Taking damage
            setScreenFlash('damage');
            playDamageTakenSound();
            showNotification(`💥 -${Math.abs(delta)} HP`, 'error');
            
            // Trigger vibration on mobile
            if (navigator.vibrate) {
              navigator.vibrate([200, 100, 200]);
            }
          }
        }
        
        if (data.health <= 20 && data.health > 0) {
          showNotification('⚠️ Low health!', 'error');
        }
        if (data.health <= 0) {
          showNotification('💀 You have been eliminated!', 'error');
          setScreenFlash('damage');
        }
      }
    });

    // Listen for score updates
    socket.on('playerScoreUpdate', (data: { playerId: string; points: number }) => {
      if (currentPlayer && data.playerId === currentPlayer.id) {
        const oldScore = playerScore;
        const newScore = data.points;
        setPlayerScore(newScore);
        
        // Show score change animation
        const delta = newScore - oldScore;
        if (delta > 0) {
          setScoreDelta(delta);
          setScreenFlash('hit');
          playHitSound();
          showNotification(`🎯 +${delta} points!`, 'success');
        }
      }
    });

    // Listen for damage taken
    socket.on('playerDamaged', (data: { targetPlayerId: string; damage: number; attackerName: string }) => {
      if (currentPlayer && data.targetPlayerId === currentPlayer.id) {
        showNotification(`💥 Hit by ${data.attackerName}! (-${data.damage} HP)`, 'error');
        setScreenFlash('damage');
        playDamageTakenSound();
        
        // Strong vibration for being hit
        if (navigator.vibrate) {
          navigator.vibrate([300, 100, 300, 100, 300]);
        }
      }
    });

    // Listen for player elimination
    socket.on('playerEliminated', (data: { playerId: string; playerName: string; eliminatedBy?: string }) => {
      if (currentPlayer && data.playerId === currentPlayer.id) {
        // This player has been eliminated
        setScreenFlash('damage');
        setTimeout(() => setScreenFlash('none'), 1000);
        playDamageTakenSound();
        
        // Death vibration pattern
        if (navigator.vibrate) {
          navigator.vibrate([500, 200, 500, 200, 500]);
        }
        
        const eliminator = data.eliminatedBy ? ` by ${data.eliminatedBy}` : '';
        showNotification(`💀 YOU HAVE BEEN ELIMINATED${eliminator}!`, 'error');
      } else {
        // Another player was eliminated
        const eliminator = data.eliminatedBy ? ` by ${data.eliminatedBy}` : '';
        showNotification(`💀 ${data.playerName} eliminated${eliminator}`, 'info');
      }
    });

    return () => {
      socket.off('playerHealthUpdate');
      socket.off('playerScoreUpdate');
      socket.off('playerDamaged');
      socket.off('playerEliminated');
    };
  }, [socket, currentPlayer?.id, showNotification]);

  // Update player stats when current player changes
  useEffect(() => {
    if (currentPlayer) {
      setPlayerHealth(currentPlayer.health);
      setPlayerScore(currentPlayer.points);
    }
  }, [currentPlayer]);

  // Debug output for pose detection
  useEffect(() => {
    if (currentPoses.length > 0) {
      const video = webcamRef.current?.video;
      if (video) {
        const state = getCrosshairState();
        console.log('Pose detection state:', {
          posesDetected: currentPoses.length,
          isTargetDetected: state.isTargetDetected,
          playerMatches: state.debugInfo.playerMatches.length,
          closestMatchDistance: state.debugInfo.playerMatches[0]?.distance
        });
      }
    }
  }, [currentPoses, getCrosshairState]);

  // State for notifications
  const [notifications, setNotifications] = useState<Array<{ message: string; type: 'success' | 'error' | 'info' }>>([]);

  // Override the showNotification prop with our own implementation
  const handleNotification = useCallback((message: string, type: 'success' | 'error' | 'info') => {
    setNotifications(prev => [...prev, { message, type }]);
    // Remove notification after 3 seconds
    setTimeout(() => {
      setNotifications(prev => prev.slice(1));
    }, 3000);
  }, []);

  // Notification Container Component
  const NotificationContainer = () => {
    return (
      <div className="flex flex-col items-center space-y-2 max-w-md">
        {notifications.map((notification, index) => (
          <div
            key={index}
            className={`px-4 py-2 rounded-lg text-white text-center font-semibold shadow-lg animate-fade-in ${
              notification.type === 'success' ? 'bg-green-600/90' :
              notification.type === 'error' ? 'bg-red-600/90' :
              'bg-blue-600/90'
            }`}
          >
            {notification.message}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-black">
      {/* Death Screen Overlay */}
      {currentPlayer?.status === 'dead' && (
        <div className="fixed inset-0 bg-red-900/80 backdrop-blur-md flex items-center justify-center" style={{ zIndex: 1000 }}>
          <div className="text-center text-white p-8 space-y-6 max-w-2xl w-full">
            <h1 className="text-7xl font-bold animate-pulse mb-8">TAGGED!</h1>
            
            <div className="text-2xl space-y-4">
              <p>Your Final Score: <span className="text-yellow-400 font-bold">{currentPlayer.points}</span></p>
              
              {topPlayer && (
                <div className="mt-4">
                  <p className="text-xl opacity-80">Top Player</p>
                  <p className="text-3xl font-bold text-yellow-400">{topPlayer.name}</p>
                  <p className="text-2xl">Score: {topPlayer.points}</p>
                </div>
              )}

              {currentPlayer.lives > 0 ? (
                <div className="mt-8">
                  <p className="text-xl mb-2">Lives Remaining: {currentPlayer.lives}</p>
                  <p className="text-4xl font-bold text-green-400">
                    Respawning in {respawnCountdown ?? 10}s
                  </p>
                </div>
              ) : (
                <div className="mt-8">
                  <p className="text-3xl font-bold text-red-400">GAME OVER</p>
                  <p className="text-xl mt-2">No lives remaining</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="relative w-full h-full">
        {hasCameraPermission ? (
          <div className="relative w-full h-full" style={{ cursor: 'crosshair' }}>
            <Webcam
              ref={webcamRef}
              audio={false}
              className="w-full h-full object-cover"
              screenshotFormat="image/jpeg"
              videoConstraints={{
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                facingMode: isMobileDevice() ? { ideal: "environment" } : { ideal: "user" }
              }}
            />
            
            {/* Screen Flash Overlay */}
            <div className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
              screenFlash === 'damage' ? 'bg-red-500/40 opacity-100' :
              screenFlash === 'hit' ? 'bg-green-500/30 opacity-100' :
              screenFlash === 'shoot' ? 'bg-yellow-500/20 opacity-100' :
              'opacity-0'
            }`} />

            {/* Health/Score Delta Animations */}
            {healthDelta !== null && (
              <div className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
                              text-6xl font-bold pointer-events-none animate-bounce z-50 ${
                healthDelta < 0 ? 'text-red-500' : 'text-green-500'
              }`}>
                {healthDelta > 0 ? '+' : ''}{healthDelta}
              </div>
            )}
            
            {scoreDelta !== null && (
              <div className="absolute top-20 right-8 text-4xl font-bold text-yellow-400 pointer-events-none animate-pulse z-50">
                +{scoreDelta}
              </div>
            )}
            
            {/* Game UI Overlays */}
            <div className="absolute inset-0">
              {/* Player Info Overlay - Top Left */}
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm rounded-lg p-3 text-white pointer-events-none">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <span className="text-sm">{currentPlayer?.name || playerName}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div>
                      HP: <span className={`font-bold ${
                        playerHealth > 50 ? 'text-green-400' : 
                        playerHealth > 20 ? 'text-yellow-400' : 'text-red-400'
                      }}`}>{playerHealth}</span>
                    </div>
                    <div>
                      Score: <span className="font-bold text-blue-400">{playerScore}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Move Notifications to top-center */}
              <div className="absolute top-4 left-1/2 transform -translate-x-1/2" style={{ zIndex: 40 }}>
                <NotificationContainer />
              </div>

              {/* Shoot Button - Bottom Center */}
              <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2" style={{ zIndex: 50 }}>
                <button
                  onClick={handleShoot}
                  className={`px-8 py-4 bg-red-600 text-white rounded-full font-bold text-xl shadow-lg 
                    transition-all duration-200 ${isShooting ? 'scale-95 bg-red-700' : 'hover:bg-red-500'}
                    ${Date.now() - lastShotTime < SHOOT_COOLDOWN ? 'opacity-50 cursor-not-allowed' : ''}`}
                  disabled={Date.now() - lastShotTime < SHOOT_COOLDOWN}
                >
                  🎯 FIRE!
                </button>
              </div>

              {/* Game UI continues */}

              {/* Crosshair */}
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <div 
                  className={`w-32 h-32 border-4 rounded-full relative transition-all duration-200 ${
                    isShooting ? 'scale-90' : ''
                  }`}
                  style={{ 
                    borderColor: getCrosshairState().color, 
                    backgroundColor: getCrosshairState().color.replace('0.6', '0.1'),
                    transition: 'all 0.2s ease'
                  }}
                >
                  <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                    <div className="w-8 h-1" style={{ backgroundColor: getCrosshairState().color }}></div>
                    <div className="w-1 h-8 absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
                         style={{ backgroundColor: getCrosshairState().color }}></div>
                  </div>
                </div>
              </div>

              {/* Target Detection Indicator */}
              {(() => {
                const state = getCrosshairState();
                if (state.isTargetDetected && state.debugInfo.playerMatches.length > 0) {
                  // Find the player with the lowest color distance
                  const closestMatch = state.debugInfo.playerMatches.reduce((prev, current) => 
                    prev.distance < current.distance ? prev : current
                  );
                  
                  // Only show if the distance is within an acceptable range
                  if (closestMatch.distance < 30) {
                    return (
                      <div className="absolute top-20 left-1/2 transform -translate-x-1/2">
                        <div className="bg-green-500 text-black px-4 py-2 rounded-full text-sm font-bold animate-pulse">
                          Target Acquired: {closestMatch.player.name}
                        </div>
                      </div>
                    );
                  }
                }
                return null;
              })()}

              {/* Target UI elements end */}
            </div>
            
            {/* Pose detection overlay */}
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-60"
              style={{ mixBlendMode: 'screen' }}
            />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <div className="text-center">
              <Camera className="mx-auto mb-4 text-gray-400" size={64} />
              <h3 className="text-white text-xl mb-2">Camera Required</h3>
              <p className="text-gray-400 mb-4">Camera access is needed to play the game</p>
              <button
                onClick={async () => {
                  const hasPermission = await requestCameraPermission(showNotification);
                  setHasCameraPermission(hasPermission);
                  if (hasPermission) {
                    showNotification('Camera access granted! Game ready.', 'success');
                  } else {
                    showNotification('Camera access denied. Cannot continue game.', 'error');
                  }
                }}
                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-all duration-200 font-semibold"
              >
                📷 Enable Camera
              </button>
            </div>
          </div>
        )}

        {/* Menu Button */}
        <div className="absolute top-4 right-4 z-10">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="bg-black/60 backdrop-blur-sm text-white p-2 rounded-lg hover:bg-black/80 transition-all"
          >
            <Menu size={20} />
          </button>

          {/* Dropdown Menu */}
          {showMenu && (
            <div className="absolute top-full right-0 mt-2 w-48 bg-black/90 backdrop-blur-sm rounded-lg overflow-hidden border border-gray-800">
              <button
                onClick={() => {
                  setShowInstructions(true);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-3 text-left text-white hover:bg-gray-800 flex items-center gap-2"
              >
                <Info size={18} />
                How to Play
              </button>
              <button
                onClick={() => {
                  setShowConfirmation(true);
                  setShowMenu(false);
                }}
                className="w-full px-4 py-3 text-left text-red-400 hover:bg-gray-800 flex items-center gap-2"
              >
                <LogOut size={18} />
                Leave Game
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Instructions Modal */}
      {showInstructions && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
            <h4 className="font-semibold text-green-200 mb-4 text-lg">🎮 How to Play</h4>
            <ul className="text-sm text-green-100 space-y-2">
              <li className="flex items-start gap-2">
                <span>•</span>
                <span><strong>Aim:</strong> Point your camera at opponents wearing different colored shirts</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span><strong>Shoot:</strong> When a person appears in the crosshair, the system will auto-shoot</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span><strong>Avoid:</strong> Don't let opponents point their cameras at you!</span>
              </li>
              <li className="flex items-start gap-2">
                <span>•</span>
                <span><strong>Score:</strong> Hit opponents to gain points and reduce their health</span>
              </li>
            </ul>
            <button
              onClick={() => setShowInstructions(false)}
              className="mt-6 w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-all"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
