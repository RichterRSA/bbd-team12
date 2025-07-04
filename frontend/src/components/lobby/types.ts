export interface Player {
  id: string;
  name: string;
  isHost: boolean;
  team: 'red' | 'blue';
  health: number;
  shirtColor?: string;
  isConfirmed?: boolean;
  points: number;
  lives: number;
  status: 'alive' | 'dead';
  connectionStatus?: 'connected' | 'disconnected';
  weapon: {
    type: string;
    damage: number;
    cost?: number;
  } | null;
  powerUps: Array<{
    type: string;
    active: boolean;
  }>;
}

export interface GameSettings {
  maxPlayers: number;
  gameMode: string;
}

export interface GameState {
  id: string;
  name: string;
  players: Player[];
  status: 'waiting' | 'confirming-colors' | 'in-progress' | 'finished';
  settings: GameSettings;
  confirmationPhase?: {
    currentTargetIndex: number;
    confirmations: { [key: string]: string };
    allConfirmed: boolean;
  };
}
