import React from 'react';

export default function Home() {
  const gameStats = {
    teams: [
      {
        name: "Red Team",
        score: 2, 
        teamHealth: 50, 
        players: [
          { name: "Player one", health: 90, tags: 5, tagged: 2}, 
          { name: "Player one", health: 90, tags: 4, tagged: 2}
        ],
      },
      {
        name: "Blue Team",
        score: 8, 
        teamHealth: 70, 
        players: [
          { name: "Player one", health: 60, tags: 5, tagged: 2}, 
          { name: "Player one", health: 90, tags: 8, tagged: 2}
        ],
      },
    ],
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-gray-950 to-slate-900 text-white relative overflow-hidden">
      {/* background layers */}
      <div className="fixed inset-0">
        {/* grid pattern */}
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: `
            linear-gradient(rgba(148,163,184,0.3) 1px, transparent 1px),
            linear-gradient(90deg, rgba(148,163,184,0.3) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px'
        }}></div>
        
        {/* Ambient glow effects */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-red-500/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/5 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[200px] bg-slate-500/3 rounded-full blur-3xl"></div>
      </div>

      <div className="relative z-10">
        {/* header */}
        <div className="border-b border-slate-800/50 bg-gradient-to-r from-slate-900/80 via-slate-800/60 to-slate-900/80 backdrop-blur-xl">
          <div className="px-8 py-6">
            <h1 className="text-3xl font-light text-center tracking-[0.2em] text-slate-100">
              SPECTATOR VIEW
            </h1>
          </div>
        </div>
        
        <div className="px-8 py-8">
          <div className="grid grid-cols-2 gap-8 max-w-7xl mx-auto">
            {gameStats.teams.map((team, index) => (
              <div 
                key={index} 
                className={`relative group transition-all duration-700 ${
                  team.name === "Red Team" ? 'hover:shadow-red-500/10' : 'hover:shadow-blue-500/10'
                }`}
              >
                {/* Card background*/}
                <div className={`absolute inset-0 rounded-2xl transition-all duration-700 ${
                  team.name === "Red Team" 
                    ? 'bg-gradient-to-br from-red-950/20 via-red-900/10 to-transparent' 
                    : 'bg-gradient-to-br from-blue-950/20 via-blue-900/10 to-transparent'
                }`}></div>
                
                <div className={`relative border rounded-2xl p-8 backdrop-blur-sm transition-all duration-700 ${
                  team.name === "Red Team" 
                    ? 'border-red-900/30 group-hover:border-red-800/50' 
                    : 'border-blue-900/30 group-hover:border-blue-800/50'
                }`}>
                  
                  {/* Team header*/}
                  <div className="flex justify-between items-start mb-8">
                    <div className="space-y-2">
                      <div className="flex items-center space-x-4">
                        <div className={`w-3 h-3 rounded-full transition-all duration-500 ${
                          team.name === "Red Team" 
                            ? 'bg-red-400 shadow-red-400/50 shadow-lg' 
                            : 'bg-blue-400 shadow-blue-400/50 shadow-lg'
                        }`}></div>
                        <h2 className={`text-2xl font-light tracking-wider ${
                          team.name === "Red Team" ? 'text-red-300' : 'text-blue-300'
                        }`}>
                          {team.name}
                        </h2>
                      </div>
                      {/* <div className="text-xs tracking-[0.2em] text-slate-500 uppercase ml-7">
                        Status: Active
                      </div> */}
                    </div>
                    <div className="text-right space-y-1">
                      <div className={`text-4xl font-extralight tabular-nums ${
                        team.name === "Red Team" ? 'text-red-200' : 'text-blue-200'
                      }`}>
                        {team.score}
                      </div>
                      <div className="text-xs tracking-[0.2em] text-slate-400 uppercase">
                        Points
                      </div>
                    </div>
                  </div>
                  
                  {/* Team health display */}
                  <div className="mb-8">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-sm font-light text-slate-300 tracking-wide">
                        Collective Health
                      </span>
                      <span className="text-sm tabular-nums text-slate-200">
                        {team.teamHealth} <span className="text-slate-400">HP</span>
                      </span>
                    </div>
                    <div className="relative">
                      <div className="w-full bg-slate-800/40 rounded-full h-2 overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-1000 ease-out ${
                            team.name === "Red Team" 
                              ? 'bg-gradient-to-r from-red-500 to-red-400' 
                              : 'bg-gradient-to-r from-blue-500 to-blue-400'
                          }`}
                          style={{width: `${team.teamHealth}%`}}
                        ></div>
                      </div>
                      <div className={`absolute inset-0 rounded-full ${
                        team.name === "Red Team" ? 'shadow-inner shadow-red-900/50' : 'shadow-inner shadow-blue-900/50'
                      }`}></div>
                    </div>
                  </div>
                  
                  {/* Player cards */}
                  <div className="space-y-4">
                    {team.players.map((player, idx) => (
                      <div
                        key={idx}
                        className="group/player bg-slate-900/20 border border-slate-800/30 rounded-xl p-5 transition-all duration-500 hover:bg-slate-800/30 hover:border-slate-700/50"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex items-center space-x-4">
                            <div className="space-y-1">
                              <div className="text-lg font-light text-slate-100">
                                {player.name}
                              </div>
                              <div className="flex items-center space-x-4 text-sm text-slate-400">
                                <span className="flex items-center space-x-1">
                                  <span className="text-emerald-400 tabular-nums">{player.tags}</span>
                                  <span className="text-slate-500">Tags</span>
                                </span>
                                <span className="text-slate-600">•</span>
                                <span className="flex items-center space-x-1">
                                  <span className="text-red-400 tabular-nums">{player.tagged}</span>
                                  <span className="text-slate-500">Eliminations</span>
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right space-y-2">
                            <div className="flex items-center justify-end space-x-2">
                              <span className="text-slate-400">❤️</span>
                              <span className="text-xl font-light tabular-nums text-slate-200">
                                {player.health}
                              </span>
                              <span className="text-sm text-slate-400">HP</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

